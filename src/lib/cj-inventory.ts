// CJ warehouse inventory — client-safe pure helpers (no server imports).
//
// CJ's freightCalculate needs the country of ORIGIN. Quoting a US-warehouse
// product from CN returns an empty options list (code 200), which used to
// succeed silently and leave the Quote button dead. The origin comes from
// CJ's "Query Inventory by Product ID" endpoint: inventories[].countryCode
// lists the countries holding stock, and variantInventories[] breaks it
// down per variant.
// Docs: https://developers.cjdropshipping.cn/en/api/api2/api/product.html
// (3.3 Query inventory by product ID) and .../api/logistic.html (1.1
// freightCalculate: startCountryCode = "Country of origin").

import { parseMoney } from "./pricing";

export type CjInventory = {
  inventories?: { countryCode?: string; totalInventoryNum?: number }[];
  variantInventories?: {
    vid?: string;
    inventory?: { countryCode?: string; totalInventory?: number }[];
  }[];
};

/**
 * The warehouse country a freight quote must start from for this variant.
 * Prefers the variant's own stocked country that matches the destination
 * (domestic shipping), else the variant's first stocked country, else the
 * product-level stock, else CN (the old default).
 */
export function originCountryForVariant(
  inventory: CjInventory | null | undefined,
  vid: string | undefined,
  destCountryCode: string,
): string {
  const stocked = (list: { countryCode?: string; totalInventory?: number }[] | undefined) =>
    (list || [])
      .filter((i) => Number(i.totalInventory ?? 0) > 0 && i.countryCode)
      .map((i) => String(i.countryCode));
  const variant = (inventory?.variantInventories || []).find((v) => v.vid === vid);
  let candidates = stocked(variant?.inventory);
  if (!candidates.length) {
    candidates = (inventory?.inventories || [])
      .filter((i) => Number(i.totalInventoryNum ?? 0) > 0 && i.countryCode)
      .map((i) => String(i.countryCode));
  }
  if (!candidates.length) return "CN";
  const dest = (destCountryCode || "").toUpperCase();
  if (dest && candidates.includes(dest)) return dest;
  return candidates[0];
}

/**
 * CJ answers a freight quote with an empty list (code 200) when no carrier
 * serves the origin — that used to succeed silently and leave the Quote
 * button dead with Send to Drafts disabled. Turn it into a clear error
 * naming the warehouse, so the toast + inline message say what happened.
 */
export function requireFreightOptions<T>(options: T[] | null | undefined, originCountry: string): T[] {
  if (options && options.length) return options;
  throw new Error(
    `No shipping quote available for this item from the ${originCountry} warehouse — try a different variant or warehouse`,
  );
}

export type FreightOptionLike = {
  logisticName?: string;
  logisticPrice?: number | string | null;
  logisticAging?: string;
};

/**
 * A freight option's price as a number. CJ can return the price as null
 * or missing, and the product page used to turn that into 0 with
 * `?? 0` — a $0.00 "DHL" line that is not real freight.
 */
export function freightPrice(option: FreightOptionLike | null | undefined): number {
  return parseMoney(option?.logisticPrice ?? 0);
}

/**
 * Only freight options that actually carry a price, cheapest first.
 * A $0.00 option is NOT free shipping — it is a missing price (CJ
 * returns null/missing for carriers it cannot price), and treating it
 * as $0 silently understates the landed cost and inflates the shown
 * profit. The bulk-send path already filtered price <= 0; this makes
 * every other caller agree. An option with no price is "price
 * unavailable", never "$0.00 shipping".
 */
export function pricedFreightOptions<T extends FreightOptionLike>(options: T[] | null | undefined): T[] {
  return (options || [])
    .filter((o) => freightPrice(o) > 0)
    .sort((a, b) => freightPrice(a) - freightPrice(b));
}

/** Cheapest freight option that actually has a price, or null. */
export function cheapestPricedFreightOption<T extends FreightOptionLike>(options: T[] | null | undefined): T | null {
  return pricedFreightOptions(options)[0] || null;
}

/** True when the quote came back with options but none of them has a price. */
export function hasUnpricedFreightOnly(options: FreightOptionLike[] | null | undefined): boolean {
  return !!options?.length && pricedFreightOptions(options).length === 0;
}
