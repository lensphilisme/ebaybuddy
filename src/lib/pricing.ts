/**
 * Single source of truth for draft pricing. Both draft-creation paths
 * (CJ research bulk send and the product detail page) must price the same
 * product the same way, from the user's own automation_rules row:
 *
 *   landed   = item cost + real shipping (freight quote, or a flagged estimate)
 *   profit   = max(landed * markup%, min_profit_usd)
 *   pre-fee  = landed + profit
 *   fee      = pre-fee * (ebay_fee_buffer% + payment_fee_buffer%)
 *   sell     = pre-fee + fee, rounded up to the .99-style ladder
 *
 * The two buffers ARE the fee rates the user configured (defaults 15% eBay
 * + 4% payment). Never hardcode a fee percentage in a page again.
 */

export type PricingRules = {
  markup_percent?: number | null;
  min_profit_usd?: number | null;
  ebay_fee_buffer_percent?: number | null;
  payment_fee_buffer_percent?: number | null;
  round_to?: number | null;
  max_listing_quantity?: number | null;
};

/** DB defaults from the automation_rules migration. */
export const PRICING_DEFAULTS: Required<PricingRules> = {
  markup_percent: 35,
  min_profit_usd: 5,
  ebay_fee_buffer_percent: 15,
  payment_fee_buffer_percent: 4,
  round_to: 0.99,
  max_listing_quantity: 5,
};

export type PricedDraft = {
  finalSell: number;
  profit: number;
  ebayFee: number;
  feeRate: number;
  landed: number;
  preFeePrice: number;
  quantity: number;
};

/**
 * Defensive money parser: CJ (and other providers) return prices as
 * numbers, numeric strings, strings with currency symbols/commas
 * ("$2.76", "1,234.56"), or empty/missing values. Number() chokes on all
 * but the first two and returns NaN — never let a NaN reach the UI.
 * Returns 0 when no usable number is present.
 */
export function parseMoney(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value == null) return 0;
  const cleaned = String(value).replace(/[^0-9.\-]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Round a money value to exactly 2 decimals (kills float artifacts). */
export function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Round up to the configured ladder (e.g. 0.99 -> $24.99 style). */
export function roundToLadder(price: number, roundTo: number): number {
  // round_to comes from the DB as a float32 (0.9900000095367432) — snap it
  // to 2 decimals first or the artifact leaks into the sell price.
  const r = roundMoney(Number(roundTo));
  if (!r || r <= 0 || r >= 1) return roundMoney(price);
  return roundMoney(Math.floor(price) + r);
}

export function priceFromRules(
  itemCost: number,
  shipping: number,
  rules: PricingRules | null | undefined,
  markupOverride?: number,
): PricedDraft {
  const markupPct = markupOverride ?? Number(rules?.markup_percent ?? PRICING_DEFAULTS.markup_percent);
  const minProfit = Number(rules?.min_profit_usd ?? PRICING_DEFAULTS.min_profit_usd);
  const feeRate =
    (Number(rules?.ebay_fee_buffer_percent ?? PRICING_DEFAULTS.ebay_fee_buffer_percent) +
      Number(rules?.payment_fee_buffer_percent ?? PRICING_DEFAULTS.payment_fee_buffer_percent)) /
    100;
  const roundTo = Number(rules?.round_to ?? PRICING_DEFAULTS.round_to);
  const landed = roundMoney(parseMoney(itemCost) + parseMoney(shipping));
  const profit = Math.max(landed * (markupPct / 100), minProfit);
  const preFeePrice = landed + profit;
  const ebayFee = preFeePrice * feeRate;
  const finalSell = roundToLadder(preFeePrice + ebayFee, roundTo);
  return {
    finalSell,
    profit: roundMoney(profit),
    ebayFee: roundMoney(ebayFee),
    feeRate,
    landed,
    preFeePrice: roundMoney(preFeePrice),
    quantity: Math.max(1, Math.floor(Number(rules?.max_listing_quantity ?? PRICING_DEFAULTS.max_listing_quantity))),
  };
}
