/**
 * ONE draft-creation function for both CJ paths (bugs 2 + 13):
 * the product detail page ("Send to Drafts") and the search page bulk
 * send. They used to build draft rows separately — the bulk copy forgot
 * description, item_specifics (Brand), cj_variant_id, variant prices and
 * images, and the profit block, so bulk drafts arrived empty.
 *
 * Both callers must pass the FULL CJ product detail (getCjProduct), never
 * a search-list row. Brand comes from the CJ product when present,
 * otherwise "Unbranded" — eBay requires Brand on every listing.
 */
import { priceFromRules, parseMoney, roundMoney, type PricingRules, PRICING_DEFAULTS } from "./pricing";
import { sanitizeSku } from "./ebay/http";
import type { CjProductDetail, CjVariant } from "./cj.server";

export function cleanImageList(...inputs: unknown[]) {
  const urls: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { visit(JSON.parse(trimmed)); return; } catch { /* use as raw below */ }
    }
    try {
      const u = new URL(trimmed.replace(/^['"]|['"]$/g, ""));
      if (u.protocol === "https:" || u.protocol === "http:") urls.push(u.toString());
    } catch { /* ignore */ }
  };
  inputs.forEach(visit);
  return Array.from(new Set(urls));
}

export function variantAxes(productKey?: string, firstVariant?: any, productProps?: string[]) {
  const keyAxes = String(productKey || "").split(/[-,/|>]+/).map((p) => p.trim()).filter(Boolean);
  if (keyAxes.length) return keyAxes;
  // CJ sometimes lists the option names as product properties instead of a
  // "Color-Size" style key — use those before falling back to generic labels.
  const propAxes = (productProps || []).map((p) => String(p || "").trim()).filter(Boolean);
  if (propAxes.length) return propAxes;
  const parts = String(firstVariant?.variantKey || firstVariant?.variantNameEn || "").split(/[-,/|]+/).filter(Boolean);
  return parts.length > 1 ? parts.map((_, i) => `Option ${i + 1}`) : ["Option"];
}

export function variantOptionMap(variant: any, axes: string[]) {
  const label = String(variant?.variantKey || variant?.variantNameEn || variant?.variantSku || variant?.vid || "Option").trim();
  const parts = label.split(/[-,/|]+/).map((p) => p.trim()).filter(Boolean);
  const values = parts.length === axes.length ? parts : axes.length === 1 ? [label] : axes.map((_, i) => parts[i] || label);
  return Object.fromEntries(axes.map((axis, i) => [axis, values[i] || label]));
}

/** CJ brand when the detail carries one, otherwise "Unbranded". */
export function draftBrand(detail: CjProductDetail & Record<string, any>): string {
  const raw = detail?.brand || detail?.brandName || detail?.productBrand || detail?.supplierName;
  const brand = String(raw || "").trim().slice(0, 65);
  return brand || "Unbranded";
}

export function variantsOf(detail: CjProductDetail & Record<string, any>): CjVariant[] {
  return detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
}

export function imagesOf(detail: CjProductDetail & Record<string, any>): string[] {
  if (!detail) return [];
  const all = new Set<string>();
  if (detail.bigImage) all.add(detail.bigImage);
  if (detail.productImage) all.add(detail.productImage);
  (Array.isArray(detail.productImageSet) ? detail.productImageSet : []).forEach((u) => u && all.add(u));
  (Array.isArray(detail.productImages) ? detail.productImages : []).forEach((u) => u && all.add(u));
  variantsOf(detail).forEach((v) => v.variantImage && all.add(v.variantImage));
  return cleanImageList(Array.from(all));
}

export type BuildCjDraftInput = {
  userId: string;
  detail: CjProductDetail & Record<string, any>;
  /** Cost of the primary (selected) variant. */
  itemCost: number;
  /** Real freight for the primary variant (0 when not quoted yet). */
  shipping: number;
  shippingNote?: string | null;
  carrier?: { logisticName?: string; logisticAging?: string } | null;
  rules: PricingRules | null;
  markupPct?: number;
  endCountry?: string;
  primaryVariant?: CjVariant | null;
};

export function buildCjDraftRow(input: BuildCjDraftInput) {
  const { userId, detail: p, itemCost, shipping, rules, markupPct } = input;
  const variants = variantsOf(p);
  const images = imagesOf(p);
  const primaryVariant = input.primaryVariant ?? variants[0] ?? null;
  const activeVid = primaryVariant?.vid || variants[0]?.vid || "";
  const axes = variantAxes(p.productKeyEn, variants[0], p.productProEnSet);
  const selectedOptions = primaryVariant ? variantOptionMap(primaryVariant, axes) : {};
  const brand = draftBrand(p);
  const priced = priceFromRules(itemCost, shipping, rules, markupPct);
  // The model's profit is the target; the ACTUAL profit is what the
  // ladder-rounded sell price leaves after landed cost + fees. Store the
  // actual one so the draft's profit figure reconciles with its price.
  const actualProfit = roundMoney(priced.finalSell - priced.landed - priced.ebayFee);
  const priceForVariant = (rawCost: unknown) => {
    const variantCost = parseMoney(rawCost) || itemCost;
    return priceFromRules(variantCost, shipping, rules, markupPct).finalSell;
  };
  const allVariantRows = variants.map((v) => ({
    vid: v.vid,
    variantSku: sanitizeSku(v.variantSku || v.vid),
    variantKey: v.variantKey || v.variantNameEn || v.variantSku || v.vid,
    variantNameEn: v.variantNameEn,
    variantImage: cleanImageList(v.variantImage)[0] || images[0] || null,
    variantSellPrice: parseMoney(v.variantSellPrice ?? p.sellPrice ?? 0),
    price: priceForVariant(v.variantSellPrice),
    inventory: Number(v.inventory || 1),
  }));
  const startCountry = p.countryCode || p.countryFrom || p.sourceFrom || "CN";
  return {
    user_id: userId,
    cj_product_id: p.pid,
    cj_variant_id: activeVid || null,
    sku: sanitizeSku(primaryVariant?.variantSku || p.productSku || p.pid),
    title: (p.productNameEn || "").slice(0, 80),
    price: priced.finalSell,
    quantity: priced.quantity,
    images: cleanImageList(primaryVariant?.variantImage, images).slice(0, 12),
    description: p.description ?? "",
    item_specifics: { Brand: brand, Condition: "New", ...selectedOptions },
    brand,
    status: "pending" as const,
    profit: {
      item_cost: parseMoney(itemCost),
      shipping: parseMoney(shipping),
      shipping_estimate: input.shippingNote ?? null,
      carrier: input.carrier?.logisticName ?? null,
      carrier_days: input.carrier?.logisticAging ?? null,
      ebay_fee_pct: priced.feeRate,
      ebay_fee: priced.ebayFee,
      desired_profit: priced.profit,
      markup_pct: markupPct ?? Number(rules?.markup_percent ?? PRICING_DEFAULTS.markup_percent),
      min_profit_usd: Number(rules?.min_profit_usd ?? PRICING_DEFAULTS.min_profit_usd),
      profit: actualProfit,
      end_country: input.endCountry ?? "US",
      start_country: startCountry,
      product_key: p.productKeyEn || null,
      variant_axes: axes,
      variant_group: allVariantRows.length > 1 ? { variants: allVariantRows } : null,
    },
  };
}
