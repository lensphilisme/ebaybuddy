// Facebook catalog AUTO-SYNC from the Medusa store.
//
// The catalog feed serves the INCLUDED rows of
// public.facebook_catalog_items; this module pulls the store's product
// list from the Medusa Store API and mirrors it into that table. The
// safety rule is absolute: a product that is NEW to the table is always
// inserted with included=false (OFF) — it appears in the app's list so
// the user can see it, but it NEVER enters the Facebook feed until the
// user ticks it on. That covers the 23 dummy store products too: they
// arrive OFF like everything new, and only the user's tick can put a
// product in the feed. Existing rows get their title/description/link/
// image/variants refreshed from the store, but `included` and `is_test`
// are NEVER changed by a sync — the user's toggle choices and the
// sneaker's test flag survive every sync.
//
// Auth: the Medusa Store API needs the publishable key in the
// `x-publishable-api-key` header. The key is PUBLIC BY DESIGN (a
// publishable key), but it is NEVER hardcoded here — it is read from
// env as MEDUSA_PUBLISHABLE_KEY (server-side only). If it is missing,
// the sync returns a plain-language "add the key" result and changes
// nothing.
//
// This module is pure/testable: the Medusa fetch takes an injectable
// fetch implementation, and runCatalogSync takes an injectable db
// adapter, so tests use mock API responses and a fake db — never the
// live store (no key exists in this environment).

import type { FacebookCatalogVariant } from "./facebook-catalog";

/** Public Medusa backend (headless commerce API). Public URL, not a secret. */
export const MEDUSA_STORE_API_BASE = "https://lisays-medusa-backend.onrender.com";
/** Public storefront — product links in the feed point here. */
export const MEDUSA_STOREFRONT_BASE = "https://app-base-jet.vercel.app";
/** Env var (server-side only) holding the Medusa publishable key. */
export const MEDUSA_PUBLISHABLE_KEY_ENV = "MEDUSA_PUBLISHABLE_KEY";
export const MEDUSA_CATALOG_KEY_MISSING_MESSAGE =
  "Automatic sync is off — add MEDUSA_PUBLISHABLE_KEY in Vercel → Settings → Environment Variables, then come back here and press “Sync from store”.";

/** Medusa Store API product shape (GET /store/products). Prices are in minor units (cents); amounts are USD in this store. */
export type MedusaStorePrice = { amount?: number; currency_code?: string };
export type MedusaStoreVariant = {
  id?: string;
  title?: string;
  prices?: MedusaStorePrice[];
  calculated_price?: { calculated_amount?: number; currency_code?: string };
  inventory_quantity?: number;
  manage_inventory?: boolean;
};
export type MedusaStoreProduct = {
  id?: string;
  title?: string;
  handle?: string;
  description?: string;
  thumbnail?: string | null;
  images?: { url?: string }[];
  variants?: MedusaStoreVariant[];
  status?: string;
};

/** One row the sync writes into facebook_catalog_items (without included/is_test — those are never set by a sync). */
export type CatalogSyncRow = {
  medusa_handle: string;
  title: string;
  description: string;
  link: string;
  image_link: string;
  variants: FacebookCatalogVariant[];
};

export type CatalogSyncSkipped = { handle: string; title: string; reason: string };

export type CatalogSyncResult = {
  ok: boolean;
  keyMissing: boolean;
  message: string;
  fetched: number;
  added: number;
  updated: number;
  unchanged: number;
  skipped: CatalogSyncSkipped[];
};

/** Minimal db adapter the sync needs — the server function builds the real one from the Supabase client; tests pass a fake. */
export type CatalogSyncDb = {
  listExisting(): Promise<{ medusa_handle: string; included: boolean; is_test: boolean; title: string; description: string; link: string; image_link: string; variants: unknown }[]>;
  insertNew(rows: (CatalogSyncRow & { included: false; is_test: false })[]): Promise<void>;
  updateExisting(handle: string, patch: CatalogSyncRow): Promise<void>;
};

const MEDUSA_PAGE_SIZE = 100;
const MEDUSA_FETCH_TIMEOUT_MS = 90_000;

/** The publishable key, trimmed — "" when it is missing or blank. */
export function getMedusaPublishableKey(env: Record<string, string | undefined> = process.env): string {
  return (env[MEDUSA_PUBLISHABLE_KEY_ENV] || "").trim();
}

/** Strip HTML tags and collapse whitespace; cap at Facebook's 5000-char description limit. */
export function plainDescription(raw: string | undefined | null): string {
  const text = String(raw || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 5000 ? `${text.slice(0, 4999)}…` : text;
}

/** Slug for a variant key: lowercase, non-alphanumerics become dashes, collapsed. */
export function slugVariantTitle(title: string): string {
  const slug = String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "variant";
}

/** USD price of a Medusa variant, in dollars. Prices are minor units (cents). Prefers the USD entry in `prices`; falls back to `calculated_price` when it is USD. */
export function medusaVariantUsdPrice(variant: MedusaStoreVariant): number | null {
  const priced = (variant.prices || []).find((p) => typeof p?.currency_code === "string" && p.currency_code.toLowerCase() === "usd" && Number.isFinite(p.amount));
  if (priced && typeof priced.amount === "number" && priced.amount > 0) return priced.amount / 100;
  const calc = variant.calculated_price;
  if (calc && typeof calc.currency_code === "string" && calc.currency_code.toLowerCase() === "usd" && Number.isFinite(calc.calculated_amount) && (calc.calculated_amount as number) > 0) {
    return (calc.calculated_amount as number) / 100;
  }
  return null;
}

/** A variant is out of stock only when Medusa tracks inventory for it and the quantity is 0 or less; otherwise in stock. */
export function medusaVariantAvailability(variant: MedusaStoreVariant): "in_stock" | "out_of_stock" {
  return variant.manage_inventory === true && typeof variant.inventory_quantity === "number" && variant.inventory_quantity <= 0
    ? "out_of_stock"
    : "in_stock";
}

/**
 * Map one Medusa product to a catalog row. Returns null (with the skip
 * reason) when the product cannot go in the catalog: no handle, not
 * published, or no variant with a usable USD price. Variants that all
 * share one price AND one availability collapse to a single "default"
 * entry — that is how the seed stores flat-price products (African wig,
 * sneaker: one feed row each), while differing prices or availability
 * stay one row per variant (slippers: 30 rows, 8 out of stock).
 */
export function mapMedusaProductToCatalogRow(product: MedusaStoreProduct): { row: CatalogSyncRow | null; skipReason: string | null } {
  const handle = String(product.handle || "").trim();
  if (!handle) return { row: null, skipReason: "no handle" };
  if (product.status && product.status !== "published") return { row: null, skipReason: "not published" };
  const title = String(product.title || handle).trim();
  const priced = (product.variants || [])
    .map((v) => ({ variant: v, price: medusaVariantUsdPrice(v) }))
    .filter((x): x is { variant: MedusaStoreVariant; price: number } => x.price !== null);
  if (priced.length === 0) return { row: null, skipReason: "no USD price" };

  let variants: FacebookCatalogVariant[];
  const allSamePrice = priced.every((x) => x.price === priced[0].price);
  const allSameAvailability = priced.every((x) => medusaVariantAvailability(x.variant) === medusaVariantAvailability(priced[0].variant));
  if (priced.length === 1 || (allSamePrice && allSameAvailability)) {
    variants = [{ key: "default", label: "", price: priced[0].price, availability: medusaVariantAvailability(priced[0].variant) }];
  } else {
    const usedKeys = new Set<string>();
    variants = priced.map(({ variant, price }) => {
      let key = slugVariantTitle(variant.title || "variant");
      if (usedKeys.has(key)) {
        let n = 2;
        while (usedKeys.has(`${key}-${n}`)) n++;
        key = `${key}-${n}`;
      }
      usedKeys.add(key);
      return { key, label: String(variant.title || "").trim(), price, availability: medusaVariantAvailability(variant) };
    });
  }

  const image_link = String(product.thumbnail || product.images?.find((i) => i?.url)?.url || "").trim();
  return {
    row: {
      medusa_handle: handle,
      title,
      description: plainDescription(product.description),
      link: `${MEDUSA_STOREFRONT_BASE}/shop/${handle}`,
      image_link,
      variants,
    },
    skipReason: null,
  };
}

/** One region from the Medusa Store API (GET /store/regions). */
export type MedusaStoreRegion = { id?: string; currency_code?: string };

/**
 * Resolve the USD region id for price calculation. The Store API only
 * returns variant prices (calculated_price) for a region — without a
 * region_id it returns NO prices at all for this store, so every
 * product maps to "no USD price" and the sync skips everything
 * (verified live Nov 6, 2026: 0 of 301 variants had any price data
 * without region_id; all 301 had USD calculated_price with the US
 * region). The Lisays store has two regions (Europe/EUR, United
 * States/USD); the feed is USD, so the US region is the right one.
 * Falls back to the first region when there is no USD region, and to
 * null (no region_id — the old behavior) when the regions call fails.
 */
export async function fetchUsdRegionId(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MEDUSA_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetchImpl(`${MEDUSA_STORE_API_BASE}/store/regions`, {
        headers: { "x-publishable-api-key": apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) return null;
    const body: any = await res.json();
    const regions: MedusaStoreRegion[] = Array.isArray(body?.regions) ? body.regions : [];
    const usd = regions.find((r) => typeof r?.currency_code === "string" && r.currency_code.toLowerCase() === "usd" && r.id);
    if (usd?.id) return usd.id;
    const first = regions.find((r) => r?.id);
    return first?.id || null;
  } catch {
    return null;
  }
}

/**
 * Fetch ALL products from the Medusa Store API, following offset
 * pagination (limit 100 per page). Prices are region-calculated, so
 * the USD region id (from fetchUsdRegionId) is passed as region_id —
 * without it the API returns no prices at all for this store. Throws
 * a plain-language error when the store does not answer, the key is
 * rejected, or the response is not usable — the caller turns that
 * into a message and changes nothing.
 */
export async function fetchMedusaProducts(apiKey: string, fetchImpl: typeof fetch = fetch): Promise<MedusaStoreProduct[]> {
  const products: MedusaStoreProduct[] = [];
  const regionId = await fetchUsdRegionId(apiKey, fetchImpl);
  const regionQuery = regionId ? `&region_id=${encodeURIComponent(regionId)}` : "";
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const url = `${MEDUSA_STORE_API_BASE}/store/products?limit=${MEDUSA_PAGE_SIZE}&offset=${offset}${regionQuery}`;
    let res: Response;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), MEDUSA_FETCH_TIMEOUT_MS);
      try {
        res = await fetchImpl(url, { headers: { "x-publishable-api-key": apiKey, Accept: "application/json" }, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    } catch (e: any) {
      if (e?.name === "AbortError") throw new Error("The store took too long to answer (it may be waking up) — try again in a minute.");
      throw new Error("Could not reach your store — check your connection and try again.");
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error("The store rejected the publishable key — check MEDUSA_PUBLISHABLE_KEY in Vercel → Settings → Environment Variables.");
    }
    if (!res.ok) throw new Error(`Your store answered with an error (${res.status}) — try again in a minute.`);
    let body: any;
    try {
      body = await res.json();
    } catch {
      throw new Error("Your store answered, but the reply was not usable — try again in a minute.");
    }
    const page = Array.isArray(body?.products) ? body.products : [];
    products.push(...page);
    total = typeof body?.count === "number" ? body.count : products.length;
    if (page.length === 0) break;
    offset += page.length;
  }
  return products;
}

/** Normalize a stored variants value into the same shape the mapper produces, for key-merging on update. */
function storedVariants(row: { variants: unknown }): FacebookCatalogVariant[] {
  const raw = Array.isArray(row.variants) ? row.variants : [];
  return raw
    .filter((v: any) => v && typeof v === "object")
    .map((v: any) => ({
      key: typeof v.key === "string" && v.key ? v.key : "default",
      label: typeof v.label === "string" ? v.label : "",
      price: Number(v.price),
      availability: v.availability === "out_of_stock" ? "out_of_stock" : "in_stock",
    }));
}

/**
 * Reuse the stored variant keys for incoming variants with the same
 * label, so a sync never renames a feed row (Facebook tracks items by
 * their id, which is handle + variant key). New labels keep their
 * fresh slug keys. The single "default" entry keeps its key.
 */
export function mergeVariantKeys(existing: FacebookCatalogVariant[], incoming: FacebookCatalogVariant[]): FacebookCatalogVariant[] {
  if (incoming.length === 1 && incoming[0].key === "default") return incoming;
  const byLabel = new Map<string, string>();
  for (const v of existing) {
    const label = v.label.trim().toLowerCase();
    if (label && !byLabel.has(label)) byLabel.set(label, v.key);
  }
  const used = new Set<string>();
  return incoming.map((v) => {
    const match = byLabel.get(v.label.trim().toLowerCase());
    let key = match || v.key;
    if (used.has(key)) {
      let n = 2;
      while (used.has(`${key}-${n}`)) n++;
      key = `${key}-${n}`;
    }
    used.add(key);
    return { ...v, key };
  });
}

/**
 * Decide what a sync does with the fetched products, against the rows
 * already in the table. Pure — no I/O, fully unit-testable.
 * - new handle → insert, included=false (OFF, never in the feed until ticked)
 * - existing handle → update title/description/link/image/variants ONLY;
 *   the returned patch never carries `included` or `is_test`, so the
 *   user's toggle choices and the sneaker's test flag are preserved
 * - unmappable product → skipped, with the reason
 * - existing handle whose stored data already matches → unchanged (no write)
 */
export function planCatalogSync(
  existing: { medusa_handle: string; included: boolean; is_test: boolean; variants: unknown }[],
  fetched: MedusaStoreProduct[],
): { toInsert: (CatalogSyncRow & { included: false; is_test: false })[]; toUpdate: { handle: string; patch: CatalogSyncRow }[]; skipped: CatalogSyncSkipped[] } {
  const byHandle = new Map(existing.map((r) => [r.medusa_handle, r]));
  const toInsert: (CatalogSyncRow & { included: false; is_test: false })[] = [];
  const toUpdate: { handle: string; patch: CatalogSyncRow }[] = [];
  const skipped: CatalogSyncSkipped[] = [];

  for (const product of fetched) {
    const { row, skipReason } = mapMedusaProductToCatalogRow(product);
    const handle = String(product.handle || "").trim();
    if (!row) {
      skipped.push({ handle, title: String(product.title || handle || "Untitled product"), reason: skipReason || "could not be added" });
      continue;
    }
    const current = byHandle.get(handle);
    if (!current) {
      // NEW — always OFF. This is the safety rule: nothing new ever
      // enters the Facebook feed automatically, dummy products included.
      toInsert.push({ ...row, included: false, is_test: false });
      continue;
    }
    const patch: CatalogSyncRow = { ...row, variants: mergeVariantKeys(storedVariants(current), row.variants) };
    toUpdate.push({ handle, patch });
  }
  return { toInsert, toUpdate, skipped };
}

/**
 * Run one sync: fetch the store, plan against the table, apply inserts
 * (OFF) and updates (mirrored columns only). Returns a plain-language
 * summary. A missing key or a failed fetch changes NOTHING and returns
 * ok:false with the message. The db adapter is injected so tests can
 * use a fake; the server function passes the real Supabase client.
 */
export async function runCatalogSync(opts: {
  apiKey: string | undefined | null;
  fetchImpl?: typeof fetch;
  db: CatalogSyncDb;
}): Promise<CatalogSyncResult> {
  const fail = (message: string, keyMissing = false): CatalogSyncResult => ({
    ok: false,
    keyMissing,
    message,
    fetched: 0,
    added: 0,
    updated: 0,
    unchanged: 0,
    skipped: [],
  });
  const apiKey = (opts.apiKey || "").trim();
  if (!apiKey) return fail(MEDUSA_CATALOG_KEY_MISSING_MESSAGE, true);

  let products: MedusaStoreProduct[];
  try {
    products = await fetchMedusaProducts(apiKey, opts.fetchImpl);
  } catch (e: any) {
    return fail(e?.message || "Could not reach your store — try again in a minute.");
  }

  const existing = await opts.db.listExisting();
  const { toInsert, toUpdate, skipped } = planCatalogSync(existing, products);
  const byHandle = new Map(existing.map((r) => [r.medusa_handle, r]));
  let added = 0;
  if (toInsert.length > 0) {
    await opts.db.insertNew(toInsert);
    added = toInsert.length;
  }

  let updated = 0;
  let unchanged = 0;
  for (const { handle, patch } of toUpdate) {
    const current = byHandle.get(handle) as any;
    const same =
      current &&
      String(current.title || "") === patch.title &&
      String(current.description || "") === patch.description &&
      String(current.link || "") === patch.link &&
      String(current.image_link || "") === patch.image_link &&
      JSON.stringify(storedVariants(current)) === JSON.stringify(patch.variants);
    if (same) {
      unchanged++;
      continue;
    }
    try {
      await opts.db.updateExisting(handle, patch);
      updated++;
    } catch {
      skipped.push({ handle, title: patch.title, reason: "could not save — try again" });
    }
  }

  const parts: string[] = [`Checked ${products.length} product${products.length === 1 ? "" : "s"} from your store.`];
  if (added > 0) parts.push(`${added} new — switched off, tick them to add them to the feed.`);
  if (updated > 0) parts.push(`${updated} updated with the latest prices.`);
  if (unchanged > 0 && added === 0 && updated === 0) parts.push("Everything was already up to date.");
  if (skipped.length > 0) parts.push(`${skipped.length} skipped (${skipped.map((s) => s.title).slice(0, 3).join(", ")}${skipped.length > 3 ? ", …" : ""}).`);
  return {
    ok: true,
    keyMissing: false,
    message: parts.join(" "),
    fetched: products.length,
    added,
    updated,
    unchanged,
    skipped,
  };
}
