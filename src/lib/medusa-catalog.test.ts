// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import {
  buildFacebookCatalogCsv,
  catalogFeedRowCount,
  type FacebookCatalogItem,
} from "./facebook-catalog";
import {
  fetchMedusaProducts,
  getMedusaPublishableKey,
  mapMedusaProductToCatalogRow,
  mergeVariantKeys,
  planCatalogSync,
  runCatalogSync,
  MEDUSA_CATALOG_KEY_MISSING_MESSAGE,
  type CatalogSyncDb,
  type MedusaStoreProduct,
  type MedusaStoreVariant,
} from "./medusa-catalog";

// Mock Medusa Store API responses, mirroring the real Lisays Beauty
// catalog (~/workspace/medusa-catalog/catalog.md). Prices are minor
// units (cents), as Medusa returns them. No live fetch happens here —
// there is no key in this environment, and tests must never need one.
function variant(title: string, usdCents: number, opts: { qty?: number; manage?: boolean; eurCents?: number } = {}): MedusaStoreVariant {
  const prices: { amount: number; currency_code: string }[] = [{ amount: usdCents, currency_code: "usd" }];
  if (opts.eurCents !== undefined) prices.push({ amount: opts.eurCents, currency_code: "eur" });
  return {
    title,
    prices,
    inventory_quantity: opts.qty,
    manage_inventory: opts.manage,
  };
}
function product(partial: Partial<MedusaStoreProduct> & { handle: string; title: string }): MedusaStoreProduct {
  return { status: "published", variants: [], images: [], ...partial };
}
function mockFetchAll(all: MedusaStoreProduct[], opts: { pageSize?: number; status?: number; regions?: { id: string; currency_code: string }[] | null; regionsStatus?: number } = {}) {
  const seen: { url: string; headers: any }[] = [];
  const pageSize = opts.pageSize ?? 100;
  // Default regions mirror the real Lisays store: Europe (EUR) first,
  // United States (USD) second — the sync must pick the USD one.
  const regions = opts.regions === undefined
    ? [{ id: "reg_eu", currency_code: "eur" }, { id: "reg_us", currency_code: "usd" }]
    : opts.regions;
  const fetchImpl = (async (url: string, init: any) => {
    seen.push({ url, headers: init?.headers });
    if (url.includes("/store/regions")) {
      if (opts.regionsStatus && opts.regionsStatus !== 200) {
        return new Response("{}", { status: opts.regionsStatus, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ regions: regions ?? [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (opts.status && opts.status !== 200) {
      return new Response("{}", { status: opts.status, headers: { "Content-Type": "application/json" } });
    }
    const u = new URL(url);
    const offset = Number(u.searchParams.get("offset") || 0);
    const page = all.slice(offset, offset + pageSize);
    return new Response(JSON.stringify({ products: page, count: all.length, offset, limit: 100 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

const STORE = "https://app-base-jet.vercel.app/shop";
function storedRow(partial: any) {
  return {
    title: partial.title,
    description: "Test description.",
    link: `${STORE}/${partial.medusa_handle}`,
    image_link: "https://example.com/img.jpg",
    included: true,
    is_test: false,
    variants: [{ key: "default", label: "", price: 10, availability: "in_stock" }],
    ...partial,
  };
}
// The 6 seeded rows, compacted (same handles/flags as the migration).
function seededRows() {
  return [
    storedRow({ medusa_handle: "african-women-wig-long-straight-hair-lace-hair-cover", title: "African Women Wig Long Straight Hair Lace Hair Cover", variants: [{ key: "default", label: "", price: 37.47, availability: "in_stock" }] }),
    storedRow({ medusa_handle: "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl", title: "Cute Cartoon Cotton Slippers", variants: [{ key: "36to37-pink", label: "36to37 / Pink", price: 19.69, availability: "out_of_stock" }] }),
    storedRow({ medusa_handle: "eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil", title: "Eelhoe Ginger Hair Essential Oil", variants: [{ key: "1pc", label: "1pc", price: 13.78, availability: "in_stock" }] }),
    storedRow({
      medusa_handle: "batana-oil-hair-care-essential-oil-batana-oil-hair-oil",
      title: "Batana Oil Hair Care Essential Oil Batana Oil Hair Oil",
      variants: [
        { key: "118ml", label: "Batana Essential Oil 118ml", price: 18.1, availability: "in_stock" },
        { key: "60ml", label: "Batana Essential Oil 60ml", price: 16.15, availability: "in_stock" },
        { key: "brown", label: "brown", price: 16.59, availability: "in_stock" },
      ],
    }),
    storedRow({ medusa_handle: "wigs-real-hair-india-hair-ladies-water-wave-hair-hair", title: "Wigs real hair India hair ladies water wave hair hair", variants: [{ key: "12-inch", label: "12 inch", price: 37.19, availability: "in_stock" }] }),
    storedRow({ medusa_handle: "women-shoes-female-casual-shoes", title: "Women Shoes Female Casual Shoes", variants: [{ key: "default", label: "", price: 33.58, availability: "in_stock" }], is_test: true }),
  ];
}
function fakeDb(seed: any[]) {
  const rows = new Map(seed.map((r) => [r.medusa_handle, { ...r }]));
  const calls = { list: 0, insert: 0, update: 0 };
  const db = {
    listExisting: async () => {
      calls.list++;
      return [...rows.values()];
    },
    insertNew: async (newRows: any[]) => {
      calls.insert++;
      for (const r of newRows) rows.set(r.medusa_handle, { ...r });
    },
    updateExisting: async (handle: string, patch: any) => {
      calls.update++;
      const cur = rows.get(handle);
      if (cur) rows.set(handle, { ...cur, ...patch });
    },
  } as unknown as CatalogSyncDb;
  return { rows, calls, db };
}
function toFeedItems(rows: Map<string, any>): FacebookCatalogItem[] {
  return [...rows.values()].map((r) => ({
    medusa_handle: r.medusa_handle,
    title: r.title,
    description: r.description || "",
    link: r.link,
    image_link: r.image_link,
    brand: "Lisays Beauty",
    condition: "new",
    currency: "USD",
    variants: r.variants,
    included: r.included,
    is_test: r.is_test,
  }));
}

describe("mapMedusaProductToCatalogRow", () => {
  test("flat-price multi-variant product collapses to one default row (African wig: 10 sizes, all $37.47)", () => {
    const sizes = ["14", "16", "18", "20", "22", "24", "26", "28", "30", "32"];
    const p = product({
      handle: "african-women-wig-long-straight-hair-lace-hair-cover",
      title: "African Women Wig Long Straight Hair Lace Hair Cover",
      description: "Wig set ×1",
      thumbnail: "https://example.com/wig.jpg",
      variants: sizes.map((s) => variant(`${s} inch`, 3747)),
    });
    const { row, skipReason } = mapMedusaProductToCatalogRow(p);
    expect(skipReason).toBeNull();
    expect(row?.variants).toEqual([{ key: "default", label: "", price: 37.47, availability: "in_stock" }]);
    expect(row?.link).toBe("https://app-base-jet.vercel.app/shop/african-women-wig-long-straight-hair-lace-hair-cover");
  });

  test("differing prices stay one row per variant, USD picked over EUR, cents become dollars", () => {
    const p = product({
      handle: "batana-oil-hair-care-essential-oil-batana-oil-hair-oil",
      title: "Batana Oil",
      variants: [variant("Batana Essential Oil 118ml", 1810, { eurCents: 1700 }), variant("Batana Essential Oil 60ml", 1615), variant("brown", 1659)],
    });
    const { row } = mapMedusaProductToCatalogRow(p);
    expect(row?.variants).toEqual([
      { key: "batana-essential-oil-118ml", label: "Batana Essential Oil 118ml", price: 18.1, availability: "in_stock" },
      { key: "batana-essential-oil-60ml", label: "Batana Essential Oil 60ml", price: 16.15, availability: "in_stock" },
      { key: "brown", label: "brown", price: 16.59, availability: "in_stock" },
    ]);
  });

  test("out of stock only when Medusa tracks inventory and quantity is 0; untracked variants are in stock", () => {
    const p = product({
      handle: "slippers",
      title: "Slippers",
      variants: [
        variant("36to37 / Pink", 1969, { qty: 0, manage: true }),
        variant("40to41 / Gray", 1969, { qty: 5, manage: true }),
        variant("40to41 / Coffee", 1969, { manage: false }),
      ],
    });
    const { row } = mapMedusaProductToCatalogRow(p);
    expect(row?.variants.map((v) => v.availability)).toEqual(["out_of_stock", "in_stock", "in_stock"]);
  });

  test("HTML is stripped from descriptions and long text is capped at 5000 chars", () => {
    const p = product({ handle: "x", title: "X", description: "<p>Hello <b>world</b></p>", variants: [variant("Default", 1000)] });
    expect(mapMedusaProductToCatalogRow(p).row?.description).toBe("Hello world");
    const long = product({ handle: "y", title: "Y", description: "a".repeat(6000), variants: [variant("Default", 1000)] });
    expect(mapMedusaProductToCatalogRow(long).row?.description.length).toBeLessThanOrEqual(5000);
  });

  test("no handle, no USD price, and draft products are skipped with a reason", () => {
    expect(mapMedusaProductToCatalogRow(product({ handle: "", title: "No handle", variants: [variant("Default", 1000)] })).skipReason).toBe("no handle");
    const eurOnly = product({ handle: "eur-only", title: "EUR only", variants: [{ title: "Default", prices: [{ amount: 1000, currency_code: "eur" }] }] });
    expect(mapMedusaProductToCatalogRow(eurOnly).skipReason).toBe("no USD price");
    const noPrice = product({ handle: "free", title: "Free", variants: [{ title: "Default", prices: [] }] });
    expect(mapMedusaProductToCatalogRow(noPrice).skipReason).toBe("no USD price");
    const draft = product({ handle: "draft", title: "Draft", status: "draft", variants: [variant("Default", 1000)] });
    expect(mapMedusaProductToCatalogRow(draft).skipReason).toBe("not published");
  });
});

describe("mergeVariantKeys", () => {
  test("incoming variants reuse stored keys when the label matches, so feed row ids never change", () => {
    const stored = [
      { key: "118ml", label: "Batana Essential Oil 118ml", price: 18.1, availability: "in_stock" },
      { key: "60ml", label: "Batana Essential Oil 60ml", price: 16.15, availability: "in_stock" },
    ];
    const incoming = [
      { key: "batana-essential-oil-118ml", label: "Batana Essential Oil 118ml", price: 19.99, availability: "in_stock" },
      { key: "batana-essential-oil-60ml", label: "Batana Essential Oil 60ml", price: 16.15, availability: "in_stock" },
      { key: "set9", label: "Set9", price: 30, availability: "in_stock" },
    ];
    const merged = mergeVariantKeys(stored as any, incoming as any);
    expect(merged.map((v) => v.key)).toEqual(["118ml", "60ml", "set9"]);
    expect(merged[0].price).toBe(19.99);
  });
  test("a single default entry keeps its key", () => {
    expect(mergeVariantKeys([{ key: "default", label: "", price: 10, availability: "in_stock" }] as any, [{ key: "default", label: "", price: 12, availability: "in_stock" }] as any)).toEqual([
      { key: "default", label: "", price: 12, availability: "in_stock" },
    ]);
  });
});

describe("fetchMedusaProducts", () => {
  test("follows offset pagination and sends the key as a header, never in the URL", async () => {
    const all = [product({ handle: "a", title: "A" }), product({ handle: "b", title: "B" }), product({ handle: "c", title: "C" })];
    const { fetchImpl, seen } = mockFetchAll(all, { pageSize: 2 });
    const got = await fetchMedusaProducts("pk_test_key", fetchImpl);
    expect(got.map((p) => p.handle)).toEqual(["a", "b", "c"]);
    // First call resolves the region, then the two product pages.
    expect(seen).toHaveLength(3);
    expect(seen[0].url).toContain("/store/regions");
    const productCalls = seen.slice(1);
    expect(productCalls[0].url).toContain("/store/products?limit=100&offset=0");
    expect(productCalls[1].url).toContain("offset=2");
    for (const s of seen) {
      expect(s.headers["x-publishable-api-key"]).toBe("pk_test_key");
      expect(s.url).not.toContain("pk_test_key");
    }
  });

  test("passes the USD region id so the API returns prices (the real store returns NO prices without region_id)", async () => {
    const all = [product({ handle: "a", title: "A" })];
    const { fetchImpl, seen } = mockFetchAll(all);
    await fetchMedusaProducts("pk_test_key", fetchImpl);
    const productCalls = seen.filter((s) => s.url.includes("/store/products"));
    expect(productCalls).toHaveLength(1);
    // The mock regions are Europe (EUR) then United States (USD) — the
    // USD one must win, not the first region.
    expect(productCalls[0].url).toContain("region_id=reg_us");
  });

  test("no USD region → falls back to the first region; regions call failing → no region_id (old behavior)", async () => {
    const all = [product({ handle: "a", title: "A" })];
    const eurOnly = mockFetchAll(all, { regions: [{ id: "reg_eu", currency_code: "eur" }] });
    await fetchMedusaProducts("pk_test_key", eurOnly.fetchImpl);
    expect(eurOnly.seen.filter((s) => s.url.includes("/store/products"))[0].url).toContain("region_id=reg_eu");
    const regionsFail = mockFetchAll(all, { regionsStatus: 500 });
    await fetchMedusaProducts("pk_test_key", regionsFail.fetchImpl);
    const noRegionUrl = regionsFail.seen.filter((s) => s.url.includes("/store/products"))[0].url;
    expect(noRegionUrl).not.toContain("region_id");
  });

  test("the mapper reads the real API shape: calculated_price only, no prices array", async () => {
    // Mirrors the live /store/products response with region_id: variants
    // carry only calculated_price (USD, cents) — no `prices` array.
    const realShape = product({
      handle: "african-women-wig-long-straight-hair-lace-hair-cover",
      title: "African Women Wig Long Straight Hair Lace Hair Cover",
      variants: ["14 inch", "16 inch"].map((t) => ({
        title: t,
        calculated_price: { calculated_amount: 3747, currency_code: "usd" },
      })),
    });
    const { row, skipReason } = mapMedusaProductToCatalogRow(realShape);
    expect(skipReason).toBeNull();
    expect(row?.variants).toEqual([{ key: "default", label: "", price: 37.47, availability: "in_stock" }]);
  });

  test("a 401 becomes a plain-language key error", async () => {
    const { fetchImpl } = mockFetchAll([], { status: 401 });
    await expect(fetchMedusaProducts("pk_bad", fetchImpl)).rejects.toThrow("MEDUSA_PUBLISHABLE_KEY");
  });
});

describe("runCatalogSync", () => {
  const STORE_PRODUCTS: MedusaStoreProduct[] = [
    // Identical to the seeded row (same title, description, image, flat
    // $37.47 price) → the sync must count it unchanged, not rewrite it.
    product({ handle: "african-women-wig-long-straight-hair-lace-hair-cover", title: "African Women Wig Long Straight Hair Lace Hair Cover", description: "Test description.", thumbnail: "https://example.com/img.jpg", variants: [variant("14 inch", 3747)] }),
    product({ handle: "batana-oil-hair-care-essential-oil-batana-oil-hair-oil", title: "Batana Oil Hair Care Essential Oil Batana Oil Hair Oil", variants: [variant("Batana Essential Oil 118ml", 1999), variant("Batana Essential Oil 60ml", 1615), variant("brown", 1659)] }),
    product({ handle: "women-shoes-female-casual-shoes", title: "Women Shoes Female Casual Shoes", variants: [variant("Default", 3499)] }),
    product({ handle: "velvet-matte-foundation", title: "Velvet Matte Longwear Foundation", description: "Dummy cosmetics — does not exist.", variants: [variant("Default", 4200)] }),
    product({ handle: "silk-hair-bonnet", title: "Silk Hair Bonnet", description: "A brand-new real product.", variants: [variant("Default", 1299)] }),
    product({ handle: "eur-only", title: "EUR only", variants: [{ title: "Default", prices: [{ amount: 1000, currency_code: "eur" }] }] }),
  ];

  test("(a) new products arrive OFF and never enter the feed CSV — dummy products included", async () => {
    const { rows, calls, db } = fakeDb(seededRows());
    const before = catalogFeedRowCount(toFeedItems(rows));
    const { fetchImpl } = mockFetchAll(STORE_PRODUCTS);
    const result = await runCatalogSync({ apiKey: "pk_test", fetchImpl, db });
    expect(result.ok).toBe(true);
    expect(result.fetched).toBe(6);
    expect(result.added).toBe(2);
    expect(result.message).toContain("2 new");
    const foundation = rows.get("velvet-matte-foundation");
    const bonnet = rows.get("silk-hair-bonnet");
    expect(foundation?.included).toBe(false);
    expect(foundation?.is_test).toBe(false);
    expect(bonnet?.included).toBe(false);
    // (e) the feed CSV after the sync still contains only included rows.
    const csv = buildFacebookCatalogCsv(toFeedItems(rows));
    expect(catalogFeedRowCount(toFeedItems(rows))).toBe(before);
    expect(csv).not.toContain("Velvet Matte");
    expect(csv).not.toContain("Silk Hair Bonnet");
    expect(csv).not.toContain("velvet-matte-foundation");
    expect(csv).not.toContain("silk-hair-bonnet");
    expect(calls.insert).toBe(1);
  });

  test("(b) an existing included product keeps included=true and gets its price updated — the patch never carries included/is_test", async () => {
    const { rows, db } = fakeDb(seededRows());
    const { fetchImpl } = mockFetchAll(STORE_PRODUCTS);
    const plan = planCatalogSync([...rows.values()], STORE_PRODUCTS);
    const batanaPatch = plan.toUpdate.find((u) => u.handle === "batana-oil-hair-care-essential-oil-batana-oil-hair-oil");
    expect(batanaPatch).toBeDefined();
    expect("included" in (batanaPatch as any).patch).toBe(false);
    expect("is_test" in (batanaPatch as any).patch).toBe(false);
    expect(batanaPatch?.patch.variants.find((v) => v.key === "118ml")?.price).toBe(19.99);
    const result = await runCatalogSync({ apiKey: "pk_test", fetchImpl, db });
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect(rows.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil")?.included).toBe(true);
    expect(rows.get("batana-oil-hair-care-essential-oil-batana-oil-hair-oil")?.variants.find((v: any) => v.key === "118ml")?.price).toBe(19.99);
  });

  test("(c) the sneaker's is_test flag survives a sync that updates its price", async () => {
    const { rows, db } = fakeDb(seededRows());
    const { fetchImpl } = mockFetchAll(STORE_PRODUCTS);
    const result = await runCatalogSync({ apiKey: "pk_test", fetchImpl, db });
    expect(result.ok).toBe(true);
    const sneaker = rows.get("women-shoes-female-casual-shoes");
    expect(sneaker?.is_test).toBe(true);
    expect(sneaker?.included).toBe(true);
    expect(sneaker?.variants[0]?.price).toBe(34.99);
  });

  test("(d) a missing key returns the clear message and changes nothing — the db is never even read", async () => {
    const { rows, calls, db } = fakeDb(seededRows());
    const before = JSON.stringify([...rows.values()]);
    const result = await runCatalogSync({ apiKey: "", db });
    expect(result.ok).toBe(false);
    expect(result.keyMissing).toBe(true);
    expect(result.message).toBe(MEDUSA_CATALOG_KEY_MISSING_MESSAGE);
    expect(result.message).toContain("MEDUSA_PUBLISHABLE_KEY");
    expect(calls.list).toBe(0);
    expect(calls.insert).toBe(0);
    expect(calls.update).toBe(0);
    expect(JSON.stringify([...rows.values()])).toBe(before);
    const blank = await runCatalogSync({ apiKey: "   ", db });
    expect(blank.keyMissing).toBe(true);
    expect(getMedusaPublishableKey({})).toBe("");
    expect(getMedusaPublishableKey({ MEDUSA_PUBLISHABLE_KEY: "  " })).toBe("");
    expect(getMedusaPublishableKey({ MEDUSA_PUBLISHABLE_KEY: " pk_live " })).toBe("pk_live");
  });

  test("a rejected key changes nothing and says so plainly", async () => {
    const { rows, calls, db } = fakeDb(seededRows());
    const before = JSON.stringify([...rows.values()]);
    const { fetchImpl } = mockFetchAll([], { status: 401 });
    const result = await runCatalogSync({ apiKey: "pk_bad", fetchImpl, db });
    expect(result.ok).toBe(false);
    expect(result.keyMissing).toBe(false);
    expect(result.message).toContain("MEDUSA_PUBLISHABLE_KEY");
    expect(calls.list).toBe(0);
    expect(JSON.stringify([...rows.values()])).toBe(before);
  });

  test("products with no USD price are skipped with a reason; unchanged products are not rewritten", async () => {
    const { rows, calls, db } = fakeDb(seededRows());
    const { fetchImpl } = mockFetchAll(STORE_PRODUCTS);
    const result = await runCatalogSync({ apiKey: "pk_test", fetchImpl, db });
    expect(result.skipped.some((s) => s.handle === "eur-only" && s.reason === "no USD price")).toBe(true);
    // The African wig is identical in the mock (same price) → unchanged, not rewritten.
    expect(result.unchanged).toBeGreaterThanOrEqual(1);
    expect(calls.update).toBeLessThanOrEqual(3);
  });
});
