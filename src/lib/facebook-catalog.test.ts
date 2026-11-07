// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import {
  buildFacebookCatalogCsv,
  catalogFeedRowCount,
  catalogItemPriceLabel,
  catalogItemRows,
  csvCell,
  normalizeCatalogItem,
  FACEBOOK_CATALOG_CSV_HEADERS,
  type FacebookCatalogItem,
} from "./facebook-catalog";

// Fixture mirroring the migration seed (supabase/migrations/
// 20261106234500_facebook_catalog.sql) — the 6 real Lisays Beauty
// products only. The 23 dummy store products must never appear here.
const STORE = "https://app-base-jet.vercel.app/shop";
function item(partial: Partial<FacebookCatalogItem> & { medusa_handle: string; title: string }): FacebookCatalogItem {
  return {
    id: `id-${partial.medusa_handle}`,
    description: "Test description.",
    link: `${STORE}/${partial.medusa_handle}`,
    image_link: "https://example.com/img.jpg",
    brand: "Lisays Beauty",
    condition: "new",
    currency: "USD",
    variants: [{ key: "default", label: "", price: 10, availability: "in_stock" }],
    included: true,
    is_test: false,
    ...partial,
  };
}
const SLIPPER_SIZES = ["36to37", "38to39", "40to41", "42to43", "44to45"];
const SLIPPER_COLORS = ["Pink", "Khaki", "White", "Green", "Gray", "Coffee"];
function slipperVariants() {
  return SLIPPER_SIZES.flatMap((s) =>
    SLIPPER_COLORS.map((c) => ({
      key: `${s.toLowerCase()}-${c.toLowerCase()}`,
      label: `${s} / ${c}`,
      price: 19.69,
      availability:
        ["36to37", "38to39"].includes(s) && ["Pink", "Khaki", "White", "Green"].includes(c)
          ? "out_of_stock"
          : "in_stock",
    })),
  );
}
const SEEDED: FacebookCatalogItem[] = [
  item({ medusa_handle: "african-women-wig-long-straight-hair-lace-hair-cover", title: "African Women Wig Long Straight Hair Lace Hair Cover", variants: [{ key: "default", label: "", price: 37.47, availability: "in_stock" }] }),
  item({ medusa_handle: "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl", title: "Cute Cartoon Cotton Slippers", variants: slipperVariants() }),
  item({
    medusa_handle: "eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil",
    title: "Eelhoe Ginger Hair Essential Oil",
    variants: [
      { key: "1pc", label: "1pc", price: 13.78, availability: "in_stock" },
      { key: "2pcs", label: "2pcs", price: 19.29, availability: "in_stock" },
      { key: "3pcs", label: "3pcs", price: 24.82, availability: "in_stock" },
      { key: "4pcs", label: "4pcs", price: 33.07, availability: "in_stock" },
    ],
  }),
  item({
    medusa_handle: "batana-oil-hair-care-essential-oil-batana-oil-hair-oil",
    title: "Batana Oil Hair Care Essential Oil Batana Oil Hair Oil",
    variants: [
      { key: "118ml", label: "Batana Essential Oil 118ml", price: 18.1, availability: "in_stock" },
      { key: "60ml", label: "Batana Essential Oil 60ml", price: 16.15, availability: "in_stock" },
      { key: "brown", label: "brown", price: 16.59, availability: "in_stock" },
      { key: "set1", label: "Set1", price: 21.67, availability: "in_stock" },
      { key: "set2", label: "Set2", price: 18.46, availability: "in_stock" },
      { key: "set3", label: "Set3", price: 24.89, availability: "in_stock" },
    ],
  }),
  item({
    medusa_handle: "wigs-real-hair-india-hair-ladies-water-wave-hair-hair",
    title: "Wigs real hair India hair ladies water wave hair hair",
    variants: [
      { key: "12-inch", label: "12 inch", price: 37.19, availability: "in_stock" },
      { key: "14-inch", label: "14 inch", price: 42.74, availability: "in_stock" },
      { key: "16-inch", label: "16 inch", price: 48.3, availability: "in_stock" },
      { key: "18-inch", label: "18 inch", price: 53.85, availability: "in_stock" },
      { key: "20-inch", label: "20 inch", price: 59.4, availability: "in_stock" },
      { key: "22-inch", label: "22 inch", price: 64.97, availability: "in_stock" },
      { key: "24-inch", label: "24 inch", price: 70.52, availability: "in_stock" },
      { key: "26-inch", label: "26 inch", price: 78.86, availability: "in_stock" },
    ],
  }),
  item({ medusa_handle: "women-shoes-female-casual-shoes", title: "Women Shoes Female Casual Shoes", variants: [{ key: "default", label: "", price: 33.58, availability: "in_stock" }], is_test: true }),
];

function parseCsv(csv: string): string[][] {
  // Minimal parser for the test (handles quoted cells with commas/quotes).
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"') {
        if (csv[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\r" && csv[i + 1] === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; i++; }
    else if (ch === "\n") { row.push(cell); cell = ""; rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

describe("Facebook catalog CSV builder", () => {
  test("header is exactly Facebook's required columns, in order", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED));
    expect(rows[0]).toEqual([...FACEBOOK_CATALOG_CSV_HEADERS]);
    expect(rows[0]).toEqual(["id", "title", "description", "link", "image_link", "price", "availability", "condition", "brand"]);
  });

  test("the 6 real products produce 50 feed rows (1 + 30 + 4 + 6 + 8 + 1)", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED));
    expect(rows.length - 1).toBe(50);
    expect(catalogFeedRowCount(SEEDED)).toBe(50);
  });

  test("per-variant prices are exact: Eelhoe, Batana, India wigs", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED));
    const byId = new Map(rows.slice(1).map((r) => [r[0], r]));
    expect(byId.get("eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil__1pc")?.[5]).toBe("13.78 USD");
    expect(byId.get("eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil__4pcs")?.[5]).toBe("33.07 USD");
    expect(byId.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil__60ml")?.[5]).toBe("16.15 USD");
    expect(byId.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil__118ml")?.[5]).toBe("18.10 USD");
    expect(byId.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil__set3")?.[5]).toBe("24.89 USD");
    expect(byId.get("wigs-real-hair-india-hair-ladies-water-wave-hair-hair__12-inch")?.[5]).toBe("37.19 USD");
    expect(byId.get("wigs-real-hair-india-hair-ladies-water-wave-hair-hair__26-inch")?.[5]).toBe("78.86 USD");
    expect(byId.get("african-women-wig-long-straight-hair-lace-hair-cover")?.[5]).toBe("37.47 USD");
    expect(byId.get("women-shoes-female-casual-shoes")?.[5]).toBe("33.58 USD");
  });

  test("variant titles carry the variant label; the flat-price products keep the plain title", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED));
    const byId = new Map(rows.slice(1).map((r) => [r[0], r]));
    expect(byId.get("eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil__2pcs")?.[1]).toBe("Eelhoe Ginger Hair Essential Oil — 2pcs");
    expect(byId.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil__60ml")?.[1]).toBe("Batana Oil Hair Care Essential Oil Batana Oil Hair Oil — Batana Essential Oil 60ml");
    expect(byId.get("african-women-wig-long-straight-hair-lace-hair-cover")?.[1]).toBe("African Women Wig Long Straight Hair Lace Hair Cover");
  });

  test("slippers: 30 rows, 8 out of stock (small sizes in Pink/Khaki/White/Green), 22 in stock, all $19.69", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED)).slice(1);
    const slippers = rows.filter((r) => r[0].startsWith("cute-cartoon-cotton-slippers"));
    expect(slippers).toHaveLength(30);
    const out = slippers.filter((r) => r[6] === "out_of_stock");
    const inStock = slippers.filter((r) => r[6] === "in_stock");
    expect(out).toHaveLength(8);
    expect(inStock).toHaveLength(22);
    expect(out.map((r) => r[0]).sort()).toEqual([
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__36to37-green",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__36to37-khaki",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__36to37-pink",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__36to37-white",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__38to39-green",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__38to39-khaki",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__38to39-pink",
      "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl__38to39-white",
    ]);
    expect(new Set(slippers.map((r) => r[5]))).toEqual(new Set(["19.69 USD"]));
  });

  test("every row is new, Lisays Beauty, and links to the storefront product page", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED)).slice(1);
    for (const r of rows) {
      expect(r[7]).toBe("new");
      expect(r[8]).toBe("Lisays Beauty");
      expect(r[3]).toMatch(/^https:\/\/app-base-jet\.vercel\.app\/shop\//);
      expect(r[4]).toMatch(/^https:\/\//);
    }
  });

  test("no dummy product can sneak in: every row id starts with one of the 6 real handles", () => {
    const realHandles = SEEDED.map((i) => i.medusa_handle);
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED)).slice(1);
    for (const r of rows) {
      expect(realHandles.some((h) => r[0] === h || r[0].startsWith(`${h}__`))).toBe(true);
    }
    const csv = buildFacebookCatalogCsv(SEEDED);
    expect(csv).not.toContain("Velvet Matte");
    expect(csv).not.toContain("Foundation");
    expect(csv).not.toContain("Gift Card");
    expect(csv).not.toContain("Lipstick");
  });

  test("an unchecked product emits no rows, and the row count follows", () => {
    const excluded = SEEDED.map((i) => (i.medusa_handle.startsWith("batana") ? { ...i, included: false } : i));
    const rows = parseCsv(buildFacebookCatalogCsv(excluded));
    expect(rows.length - 1).toBe(44);
    expect(catalogFeedRowCount(excluded)).toBe(44);
    expect(buildFacebookCatalogCsv(excluded)).not.toContain("batana-oil-hair-care");
    expect(catalogFeedRowCount(SEEDED.map((i) => ({ ...i, included: false })))).toBe(0);
    expect(parseCsv(buildFacebookCatalogCsv(SEEDED.map((i) => ({ ...i, included: false })))).length).toBe(1); // header only
  });

  test("the test sneaker stays in the feed (is_test flags it, it does not exclude it)", () => {
    const rows = parseCsv(buildFacebookCatalogCsv(SEEDED)).slice(1);
    expect(rows.some((r) => r[0] === "women-shoes-female-casual-shoes")).toBe(true);
  });

  test("CSV escaping: commas and quotes in text are quoted, quotes doubled", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("has, comma")).toBe('"has, comma"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    const tricky = item({ medusa_handle: "x", title: 'Test, "quoted" title', description: 'Line one, "quoted".' });
    const rows = catalogItemRows(tricky);
    expect(rows[0][1]).toBe('Test, "quoted" title');
    const csv = buildFacebookCatalogCsv([tricky]);
    expect(csv).toContain('"Test, ""quoted"" title"');
  });

  test("a variant with no usable price never ships as $0.00 — it is skipped", () => {
    const bad = item({ medusa_handle: "bad-price", title: "Bad Price", variants: [{ key: "default", label: "", price: NaN, availability: "in_stock" }] });
    expect(catalogItemRows(bad)).toHaveLength(0);
    const zero = item({ medusa_handle: "zero-price", title: "Zero Price", variants: [{ key: "default", label: "", price: 0, availability: "in_stock" }] });
    expect(catalogItemRows(zero)).toHaveLength(0);
  });
});

describe("catalogItemPriceLabel", () => {
  test("flat price shows one price; differing variants show a range", () => {
    expect(catalogItemPriceLabel(SEEDED[0])).toBe("$37.47");
    expect(catalogItemPriceLabel(SEEDED[2])).toBe("$13.78 – $33.07");
    expect(catalogItemPriceLabel(SEEDED[3])).toBe("$16.15 – $24.89");
    expect(catalogItemPriceLabel(SEEDED[4])).toBe("$37.19 – $78.86");
  });
});

describe("normalizeCatalogItem", () => {
  test("malformed variants become an empty list (and the builder then skips the item)", () => {
    const row = normalizeCatalogItem({ medusa_handle: "x", title: "X", variants: "not-an-array", included: true });
    expect(row.variants).toEqual([]);
    expect(catalogItemRows(row)).toHaveLength(0);
  });
  test("defaults fill in brand, condition, currency and included", () => {
    const row = normalizeCatalogItem({ medusa_handle: "x", title: "X", variants: [] });
    expect(row.brand).toBe("Lisays Beauty");
    expect(row.condition).toBe("new");
    expect(row.currency).toBe("USD");
    expect(row.included).toBe(true);
    expect(row.is_test).toBe(false);
  });
});
