/**
 * Single source of truth for draft pricing. Both draft-creation paths
 * (CJ research bulk send and the product detail page) must price the same
 * product the same way, from the user's own automation_rules row:
 *
 *   landed   = item cost + real shipping (freight quote, or a flagged estimate)
 *   profit   = max(landed * markup%, min_profit_usd)          (the TARGET)
 *   sell     = (landed + profit) / (1 - feeRate), rounded up to the .99-style ladder
 *   fee      = sell * feeRate                                  (eBay charges
 *                                                              the fee on the
 *                                                              FINAL sell price,
 *                                                              not the pre-fee
 *                                                              subtotal)
 *   profit shown = sell - landed - fee   (>= target after ladder rounding)
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
  /** TARGET profit = max(landed * markup%, min_profit_usd). */
  profit: number;
  /** SHOWN profit = finalSell - landed - ebayFee (>= target after ladder rounding). */
  actualProfit: number;
  /** Fee on the FINAL sell price = finalSell * feeRate. */
  ebayFee: number;
  feeRate: number;
  landed: number;
  /** Pre-fee subtotal = landed + target profit. */
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

/**
 * Load-boundary normalizer for a money value coming back from the DB.
 * Apply this at EVERY query boundary that feeds a money input — the
 * drafts list (round 2) AND the automation_rules row (round 3, which
 * round 2 missed). The DB columns are NUMERIC now, so a fresh fetch
 * returns clean 2dp values; but a stale/cached fetch can still hand back
 * a float32 artifact (21.989999771118164), and the raw fetched value is
 * what sits in component state and in the input's underlying value —
 * formatting the display alone (moneyInputValue) cannot clean it. This
 * rounds it HERE, when the row enters client state, so the LOADED value
 * is 21.99, not just the formatted text. The next save writes it back
 * clean (roundMoney on save).
 */
export function loadedMoney(value: unknown): number {
  return roundMoney(Number(value ?? 0));
}

/**
 * Value for a 2-decimal money input when LOADING a stored price. The DB
 * can hand back float32 artifacts (21.989999771118164, 0.9900000095367432)
 * — this is the load boundary that turns them into "21.99" / "0.99" so
 * the artifact never sits in the input's value. Pair with roundMoney on
 * save; the pair only keeps the STORED value clean once the column itself
 * is NUMERIC (see supabase/migrations/20261106230000_money_numeric.sql).
 */
export function moneyInputValue(value: unknown): string {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "";
}

/**
 * Money load boundary for an automation_rules row (round 3): the money
 * fields (min_profit_usd, round_to) are the only ones whose raw fetched
 * value can carry a float32 artifact (0.9900000095367432) into state and
 * into the input's underlying value. Round them HERE, when the row enters
 * client state, so `rule` itself is clean — formatValue only formats the
 * display, it cannot clean the state the dirty-check and save read.
 * The load chain (fetched value -> this -> moneyInputValue -> input
 * string) must yield exactly "0.99" / "9.00".
 */
export function normalizeRuleMoney(row: any): any {
  if (!row) return row;
  return { ...row, min_profit_usd: loadedMoney(row.min_profit_usd), round_to: loadedMoney(row.round_to) };
}

/**
 * What the product-detail "+ Shipping" line shows (round 3). Before any
 * quote is run there is NO shipping figure — showing "$0.00" presents a
 * missing price as free freight. So: no quote yet -> "not quoted yet";
 * quote came back with no priced option -> "price unavailable"; quoted
 * -> the real "$X.XX". Never "$0.00" for an unquoted item.
 */
export function shippingDisplayValue(hasQuote: boolean, unpricedOnly: boolean, shipping: number): string {
  if (!hasQuote) return unpricedOnly ? "price unavailable" : "not quoted yet";
  // A quoted $0 is a missing price, never free freight — never show $0.00.
  if (!(Number(shipping) > 0)) return "price unavailable";
  return `$${(Number(shipping) || 0).toFixed(2)}`;
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
  // eBay charges its fee on the FINAL sell price, not the pre-fee subtotal
  // (audit #19): sell = (landed + profit) / (1 - feeRate), ladder-rounded
  // up. The fee shown is sell x feeRate and the profit shown is
  // sell - landed - fee, which is >= the target after ladder rounding.
  const finalSell = roundToLadder((landed + profit) / (1 - feeRate), roundTo);
  const ebayFee = roundMoney(finalSell * feeRate);
  const actualProfit = roundMoney(finalSell - landed - ebayFee);
  return {
    finalSell,
    profit: roundMoney(profit),
    actualProfit,
    ebayFee,
    feeRate,
    landed,
    preFeePrice: roundMoney(preFeePrice),
    quantity: Math.max(1, Math.floor(Number(rules?.max_listing_quantity ?? PRICING_DEFAULTS.max_listing_quantity))),
  };
}

/**
 * Pricing copy, built as template literals so the spacing is explicit in
 * the source (audit #24/#53: JSX `$` + expression joins rendered without
 * spaces). The product detail page renders these verbatim.
 */
export function floorBindsNote(minProfit: number, markupPct: number, markupProfit: number): string {
  return `Your $${minProfit.toFixed(2)} minimum profit applies instead — the ${markupPct}% markup would only give $${markupProfit.toFixed(2)}.`;
}

export function roundingNote(roundingGain: number, finalSell: number, actualProfit: number): string {
  return `Includes $${roundingGain.toFixed(2)} added by rounding the price up to $${finalSell.toFixed(2)} — sell price − landed cost − fees = $${actualProfit.toFixed(2)}.`;
}
