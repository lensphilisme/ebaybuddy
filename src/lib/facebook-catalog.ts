// Facebook Shop catalog feed — CSV builder (pure, no I/O).
//
// Facebook Shops has no open product-push API for a third-party app, so
// the app serves the catalog as a scheduled feed: the public endpoint
// /api/facebook-catalog serves the INCLUDED rows of
// public.facebook_catalog_items as a Facebook catalog CSV, and Commerce
// Manager pulls it on a schedule (daily). Unchecking a product on the
// "Facebook Catalog" page drops it from the feed on the next fetch.
//
// Format: one row per variant entry. A product with a single "default"
// variant (flat price across all variants) emits one row; a product
// whose variants differ in price or availability emits one row per
// variant, so every price and every out-of-stock combination is correct.
// Required columns: id, title, description, link, image_link, price
// ("37.47 USD"), availability (in_stock / out_of_stock), condition
// (new), brand (Lisays Beauty).
//
// The data is seeded from the Medusa storefront
// (~/workspace/medusa-catalog/catalog.md) — only the 6 real products.
// The auto-sync adds new store products to the table switched OFF
// (dummies included), but the builder below only ever outputs INCLUDED
// rows, so a dummy product can never appear in the feed until a human
// ticks it on.

export const FACEBOOK_CATALOG_FEED_PATH = "/api/facebook-catalog";
export const FACEBOOK_CATALOG_BRAND = "Lisays Beauty";

/**
 * The 6 handles seeded by supabase/migrations/20261106234500_facebook_catalog.sql.
 * Anything in the table whose handle is NOT in this set arrived later via
 * the Medusa auto-sync — so the page can badge it "New from store — not
 * in feed" until the user ticks it on. (Sync inserts are always OFF, so
 * a non-seeded handle that is still unchecked is by definition new and
 * undecided; once the user ticks it on, the badge goes away with it.)
 */
export const SEEDED_CATALOG_HANDLES = new Set([
  "african-women-wig-long-straight-hair-lace-hair-cover",
  "cute-cartoon-cotton-slippers-thick-bottom-home-slippers-fashion-floor-bedroom-sl",
  "eelhoe-ginger-hair-essential-oil-eelhoe-ginger-hair-essential-oil",
  "batana-oil-hair-care-essential-oil-batana-oil-hair-oil",
  "wigs-real-hair-india-hair-ladies-water-wave-hair-hair",
  "women-shoes-female-casual-shoes",
]);

/** True when the product arrived via the Medusa auto-sync (not part of the original seed) and is still switched off. */
export function isNewFromStore(item: { medusa_handle: string; included: boolean }): boolean {
  return !item.included && !SEEDED_CATALOG_HANDLES.has(item.medusa_handle);
}
export const FACEBOOK_CATALOG_CSV_HEADERS = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "price",
  "availability",
  "condition",
  "brand",
  // Variant grouping: every row of one product shares its
  // item_group_id (the product handle), so Facebook shows the variants
  // as ONE product with a picker instead of one product per variant.
  // `size` / `color` are what the picker offers (wig length, oil pack,
  // slipper size + color). A single-variant product has its handle as
  // its group and empty size/color.
  "item_group_id",
  "size",
  "color",
] as const;

export type FacebookCatalogAvailability = "in_stock" | "out_of_stock";

export type FacebookCatalogVariant = {
  key: string;
  label: string;
  price: number;
  availability: FacebookCatalogAvailability;
};

export type FacebookCatalogItem = {
  id?: string;
  medusa_handle: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  brand: string;
  condition: string;
  currency: string;
  variants: FacebookCatalogVariant[];
  included: boolean;
  is_test: boolean;
};

/** Normalize a raw DB row (variants come back as untyped JSON) into a typed item. Defensive: a malformed variants value becomes one default row at $0, which the builder then skips for lack of a valid price — a bad row never ships as a $0.00 product. */
export function normalizeCatalogItem(row: any): FacebookCatalogItem {
  const rawVariants = Array.isArray(row?.variants) ? row.variants : [];
  const variants: FacebookCatalogVariant[] = rawVariants
    .filter((v: any) => v && typeof v === "object")
    .map((v: any) => ({
      key: typeof v.key === "string" && v.key ? v.key : "default",
      label: typeof v.label === "string" ? v.label : "",
      price: Number(v.price),
      availability: v.availability === "out_of_stock" ? "out_of_stock" : "in_stock",
    }));
  return {
    id: typeof row?.id === "string" ? row.id : undefined,
    medusa_handle: String(row?.medusa_handle || ""),
    title: String(row?.title || ""),
    description: String(row?.description || ""),
    link: String(row?.link || ""),
    image_link: String(row?.image_link || ""),
    brand: String(row?.brand || FACEBOOK_CATALOG_BRAND),
    condition: String(row?.condition || "new"),
    currency: String(row?.currency || "USD"),
    variants,
    included: row?.included !== false,
    is_test: row?.is_test === true,
  };
}

/** RFC 4180 cell: quote when the value holds a comma, quote, CR or LF; double any quotes. */
export function csvCell(value: string | number): string {
  const text = String(value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function formatPrice(price: number, currency: string): string {
  return `${Number(price).toFixed(2)} ${currency}`;
}

/** Facebook caps descriptions at 5000 characters; ours are far shorter, but never let a long one break the feed. */
function catalogDescription(description: string): string {
  const text = String(description || "").trim();
  return text.length > 5000 ? `${text.slice(0, 4999)}…` : text;
}

/** Color words a variant key/label can be, so a color-only variant (Batana "brown") lands in `color`, not `size`. */
const VARIANT_COLOR_WORDS = new Set([
  "black", "blonde", "blue", "brown", "clear", "coffee", "gold", "gray",
  "green", "grey", "khaki", "natural", "pink", "red", "silver", "white",
]);

/** Derive Facebook's `size` and `color` for one variant, so rows sharing an item_group_id show as one product with a picker. Rules: a "SIZE / COLOR" label splits (slippers: "40to41 / Gray"); a color-only key/label goes to color (Batana "brown"); otherwise the slug key, dashes → spaces, is the size (wigs "12 inch", Eelhoe "1pc", Batana "60ml"). The single "default" variant has neither. */
export function variantSizeAndColor(v: FacebookCatalogVariant): { size: string; color: string } {
  const label = String(v.label || "").trim();
  const slash = label.indexOf(" / ");
  if (slash >= 0) {
    return { size: label.slice(0, slash).trim(), color: label.slice(slash + 3).trim() };
  }
  const key = String(v.key || "").trim().toLowerCase();
  if (!key || key === "default") return { size: "", color: "" };
  if (VARIANT_COLOR_WORDS.has(key)) return { size: "", color: label || key };
  return { size: key.replace(/-/g, " ").trim(), color: "" };
}

/** Expand one catalog item into its feed rows (one per variant entry). Rows with no usable price are skipped, never shipped as $0.00. */
export function catalogItemRows(item: FacebookCatalogItem): string[][] {
  const variants = item.variants.length > 0 ? item.variants : [];
  return variants
    .filter((v) => Number.isFinite(v.price) && v.price > 0)
    .map((v) => {
      const isDefault = variants.length === 1 && v.key === "default";
      const { size, color } = variantSizeAndColor(v);
      return [
        isDefault ? item.medusa_handle : `${item.medusa_handle}__${v.key}`,
        isDefault || !v.label ? item.title : `${item.title} — ${v.label}`,
        catalogDescription(item.description),
        item.link,
        item.image_link,
        formatPrice(v.price, item.currency),
        v.availability,
        item.condition || "new",
        item.brand || FACEBOOK_CATALOG_BRAND,
        item.medusa_handle,
        size,
        color,
      ];
    });
}

/** Build the full feed CSV for the included items (excluded items emit no rows). Header + CRLF lines, trailing CRLF. */
export function buildFacebookCatalogCsv(items: FacebookCatalogItem[]): string {
  const rows = items.filter((i) => i.included).flatMap((i) => catalogItemRows(i));
  const lines = [[...FACEBOOK_CATALOG_CSV_HEADERS], ...rows].map((r) => r.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** How many feed rows the included items produce (shown on the selection page). */
export function catalogFeedRowCount(items: FacebookCatalogItem[]): number {
  return items.filter((i) => i.included).reduce((n, i) => n + catalogItemRows(i).length, 0);
}

/** Display price for a product on the selection page: "$37.47", or "$13.78 – $33.07" when variants differ. */
export function catalogItemPriceLabel(item: FacebookCatalogItem): string {
  const prices = item.variants.map((v) => v.price).filter((p) => Number.isFinite(p) && p > 0);
  if (prices.length === 0) return "—";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? `$${min.toFixed(2)}` : `$${min.toFixed(2)} – $${max.toFixed(2)}`;
}
