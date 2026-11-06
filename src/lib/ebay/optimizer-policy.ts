import { priceFromRules, roundMoney, type PricingRules } from "../pricing";

export function requireLiveOptimizer(rule: { live_listing_enabled?: boolean } | null | undefined, token: string | null) {
  if (!rule?.live_listing_enabled) throw new Error("Enable Live Push in Rules before applying optimizer changes.");
  if (!token) throw new Error("Reconnect eBay in Settings before applying changes.");
}

export function requireListingIdentity(itemId: unknown, resourceId: unknown) {
  if (!itemId || !resourceId) throw new Error("This listing is not managed by eBay Inventory. Re-sync before retrying; externally-created listings may be unavailable.");
}

export function hasFreshTraffic(checkedAt: unknown, now = Date.now()) {
  const checked = Date.parse(String(checkedAt || ""));
  return Number.isFinite(checked) && checked <= now && now - checked <= 86_400_000;
}

/**
 * CJ stock guard (sales feature #4): a CJ product is definitively OUT of
 * stock only when every variant reports a numeric inventory of 0. An
 * undefined inventory (or no variants at all) means "unknown" — never
 * block on unknown stock, only on a definite 0.
 */
export function cjStockIsZero(detail: any): boolean {
  const variants = detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
  const inventories = (Array.isArray(variants) ? variants : [])
    .map((v: any) => v?.inventory)
    .filter((n: unknown) => typeof n === "number");
  if (!inventories.length) return false;
  return inventories.every((n) => n === 0);
}

export type PriceDropRule = {
  optimizer_price_drop_enabled?: boolean | null;
  optimizer_price_drop_max_percent?: number | null;
  markup_percent?: number | null;
  min_profit_usd?: number | null;
  ebay_fee_buffer_percent?: number | null;
  payment_fee_buffer_percent?: number | null;
  round_to?: number | null;
};

/**
 * Price-drop ladder (sales feature #5): cut the price 5%, bounded below
 * by the min-profit floor (never below landed cost + min profit + fee)
 * and by the total cap (never more than max% below the original price).
 * Returns null when no drop is possible (already at the floor/cap) or
 * when the landed cost is unknown. Pure and testable.
 */
export function priceDropFor(
  listing: { price?: number | null; cj_landed_cost?: number | null },
  rules: PriceDropRule | null | undefined,
): { newPrice: number; floor: number; capPrice: number; original: number } | null {
  if (rules?.optimizer_price_drop_enabled === false) return null;
  const landed = Number(listing.cj_landed_cost);
  if (!(landed > 0)) return null;
  const current = Number(listing.price);
  if (!(current > 0)) return null;
  const maxPct = Number(rules?.optimizer_price_drop_max_percent ?? 20);
  // Floor: the min viable sell (landed + min profit + fee, ladder-rounded).
  const floor = priceFromRules(landed, 0, rules as PricingRules, 0).finalSell;
  // Original: the price the normal markup would have set.
  const original = priceFromRules(landed, 0, rules as PricingRules).finalSell;
  const capPrice = roundMoney(original * (1 - maxPct / 100));
  const newPrice = roundMoney(Math.max(current * 0.95, floor, capPrice));
  if (!(newPrice < current)) return null;
  return { newPrice, floor, capPrice, original };
}