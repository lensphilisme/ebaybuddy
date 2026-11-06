import { ebayFetch as fetch, extractEbayErrorText, sanitizeSku } from "./http";
const EBAY_API_BASE = "https://api.ebay.com";
import { getItemAspectsForCategory } from "./taxonomy.server";
async function findOfferBySku(accessToken: string, sku: string): Promise<{ offerId: string; listing?: { listingId?: string }; status?: string } | null> {
  const res = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Accept-Language": "en-US" },
  });
  if (!res.ok) return null;
  const json = await res.json().catch(() => ({}));
  const list = json.offers || [];
  return list[0] || null;
}

async function extractOfferIdFromError(offerJson: any): Promise<string | null> {
  const errs = offerJson?.errors || [];
  for (const e of errs) {
    for (const p of e.parameters || []) {
      if (p.name === "offerId" && p.value) return String(p.value);
    }
  }
  return null;
}

function cleanText(value: unknown, fallback = "") {
  const normalize = (v: unknown) => String(v ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return normalize(value) || normalize(fallback);
}

function safeDescription(draft: any) {
  const bulletText = Array.isArray(draft.bullet_features) ? draft.bullet_features.join(". ") : "";
  const title = safeTitle(draft.title, draft.sku);
  return cleanText(draft.description, `${title}. ${bulletText}. New item. Review photos and selected option before checkout.`) || title;
}

function safeTitle(value: unknown, fallback: unknown) {
  return cleanText(value, cleanText(fallback, "eBay item")).slice(0, 80) || "eBay item";
}

function stripEmpty<T extends Record<string, any>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== "")) as T;
}

function flattenImageInput(input: unknown): unknown[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flattenImageInput);
  if (typeof input === "string") {
    const trimmed = input.trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try { return flattenImageInput(JSON.parse(trimmed)); } catch { /* keep as URL below */ }
    }
    const urls = trimmed.match(/https?:\/\/[^\s"'\\\])>,]+/gi);
    if (urls?.length) return urls;
    return [trimmed];
  }
  return [];
}

function normalizeImageUrls(...inputs: unknown[]) {
  const urls: string[] = [];
  for (const input of inputs) {
    for (const raw of flattenImageInput(input)) {
      const value = String(raw || "").trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&").replace(/^['"]|['"]$/g, "");
      if (!value || !/^https?:\/\//i.test(value)) continue;
      try {
        const parsed = new URL(value);
        if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".")) urls.push(parsed.toString());
      } catch { /* ignore invalid provider image values */ }
    }
  }
  return Array.from(new Set(urls)).slice(0, 12);
}

function shortenAspectValue(name: string, value: unknown) {
  let text = cleanText(value);
  if (/^features?$/i.test(name)) {
    text = text
      .replace(/\bContains\s+(?=\w)/gi, "")
      .replace(/\bAll Natural Ingredients\b/gi, "Natural Ingredients")
      .replace(/\s*,\s*/g, ", ");
  }
  if (text.length <= 65) return text;
  const cut = text.slice(0, 65).replace(/[\s,;:|/+-]+[^\s,;:|/+-]*$/g, "").replace(/[\s,;:|/+-]+$/g, "").trim();
  return cut || text.slice(0, 65).trim();
}

const LISTING_LOCATION_ASPECT_NAMES = new Set([
  "item location",
  "location",
  "inventory location",
  "merchant location",
  "merchantlocationkey",
  "warehouse",
  "warehouse location",
  "ship from",
  "ships from",
  "shipping location",
  "postal code",
  "zip code",
  "city",
  "state",
  "state or province",
]);

function isListingLocationAspect(name: string) {
  return LISTING_LOCATION_ASPECT_NAMES.has(cleanText(name).toLowerCase().replace(/[_-]+/g, " "));
}

function normalizeAspects(input: any, draft: any, extra: Record<string, unknown> = {}, excludeNames: string[] = []) {
  const extraKeys = new Set(Object.keys(extra || {}).map((k) => cleanText(k).toLowerCase()));
  const excluded = new Set(excludeNames.map((k) => cleanText(k).toLowerCase()).filter(Boolean));
  const raw = { ...(input || {}) };
  if (draft.brand) raw.Brand = draft.brand;
  if (draft.model) raw.Model = draft.model;
  if (!raw.Brand) raw.Brand = "Unbranded";
  if (!raw.Model) raw.Model = "Does Not Apply";
  if (!raw.MPN) raw.MPN = cleanText(draft.mpn, "Does Not Apply");
  if (!raw.Type) raw.Type = inferProductType(draft);
  Object.assign(raw, extra);
  const aspects: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = cleanText(key);
    if (!name || /^country$/i.test(name) || isListingLocationAspect(name)) continue;
    if (excluded.has(name.toLowerCase()) && !extraKeys.has(name.toLowerCase())) continue;
    const values = (Array.isArray(value) ? value : [value])
      .map((v) => shortenAspectValue(name, v))
      .filter(Boolean)
      .slice(0, 10);
    if (values.length) aspects[name] = Array.from(new Set(values));
  }
  return aspects;
}

function firstText(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text) return text;
  }
  return "";
}

function normalizeCountry(value: unknown, fallback = "CN") {
  return (cleanText(value, fallback).toUpperCase().match(/[A-Z]{2}/)?.[0] || fallback).slice(0, 2);
}

function cjWarehouseFromDraft(draft: any) {
  const profit = draft?.profit || {};
  const candidates = [
    profit.cj_warehouse,
    profit.warehouse,
    profit.inventory_location,
    profit.item_location,
    draft?.cj_warehouse,
    draft?.warehouse,
  ].filter(Boolean);
  const merged = Object.assign({}, ...candidates.filter((c) => typeof c === "object" && !Array.isArray(c)));
  const country = normalizeCountry(
    merged.countryCode || merged.country || merged.country_code || profit.start_country || profit.warehouse_country || profit.countryFrom || draft?.countryCode || draft?.countryFrom,
    "CN",
  );
  return {
    country,
    city: firstText(merged.city, merged.cityName, merged.cityEn, profit.warehouse_city),
    stateOrProvince: firstText(merged.stateOrProvince, merged.state, merged.province, merged.provinceName, profit.warehouse_state),
    postalCode: firstText(merged.postalCode, merged.zipCode, merged.zip, profit.warehouse_postal_code),
    name: firstText(merged.nameEn, merged.name, merged.areaEn, merged.valueEn, profit.warehouse_name),
    raw: merged,
  };
}

function inferProductType(draft: any) {
  const existing = cleanText(draft?.item_specifics?.Type || draft?.type || draft?.productType || draft?.category_name || draft?.categoryName);
  if (existing) return shortenAspectValue("Type", existing);
  const title = safeTitle(draft?.title, draft?.sku);
  const words = title
    .replace(/\b(new|for|with|and|the|a|an|portable|adjustable|hot|sale)\b/gi, " ")
    .split(/\s+/)
    .map((w) => cleanText(w))
    .filter((w) => w.length > 2)
    .slice(0, 4);
  return shortenAspectValue("Type", words.join(" ") || "General Product") || "General Product";
}

function priceNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const first = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return first ? Number(first[0]) : 0;
}

function locationForDraft(draft: any) {
  const warehouse = cjWarehouseFromDraft(draft);
  const country = warehouse.country;
  const cfg: Record<string, { postal: string; city: string; state?: string }> = {
    US: { postal: "32256", city: "Jacksonville", state: "FL" },
    CN: { postal: "518000", city: "Shenzhen", state: "GD" },
    GB: { postal: "SW1A 1AA", city: "London" },
    CA: { postal: "M5H 2N2", city: "Toronto", state: "ON" },
    AU: { postal: "2000", city: "Sydney", state: "NSW" },
    DE: { postal: "10115", city: "Berlin" },
    FR: { postal: "75001", city: "Paris" },
  };
  const c = cfg[country] || cfg.CN;
  const city = warehouse.city || c.city;
  const stateOrProvince = warehouse.stateOrProvince || c.state;
  const postalCode = warehouse.postalCode || c.postal;
  const keyParts = ["droplist", country, city, stateOrProvince].filter(Boolean).join("_").toLowerCase().replace(/[^a-z0-9_-]+/g, "_");
  return { key: keyParts.slice(0, 36), country, postalCode, city, stateOrProvince, name: warehouse.name || `CJ ${country} fulfillment` };
}

async function ensureInventoryLocation(accessToken: string, draft: any) {
  const loc = locationForDraft(draft);
  const body = {
    location: { address: stripEmpty({ country: loc.country, postalCode: loc.postalCode, city: loc.city, stateOrProvince: loc.stateOrProvince }) },
    name: loc.name,
    merchantLocationStatus: "ENABLED",
    locationTypes: ["WAREHOUSE"],
  };
  const res = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(loc.key)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text();
    if (!/already|duplicate|exist/i.test(text)) throw new Error(`eBay inventory location failed: ${text}`);
  }
  // The /enable call used to be fire-and-forget (.catch(() => undefined)).
  // Offers against a non-enabled location fail with a confusing 400, so a
  // failed enable must surface now instead of hiding until the offer call.
  const enableRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(loc.key)}/enable`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Accept-Language": "en-US" },
  });
  if (!enableRes.ok && enableRes.status !== 409) {
    const text = await enableRes.text();
    if (!/already|duplicate|exist|enabled/i.test(text)) {
      throw new Error(`eBay inventory location "${loc.key}" could not be enabled (${enableRes.status}): ${extractEbayErrorText(text) || text || "unknown error"}. Offers against a disabled location will fail — check the location in Seller Hub and retry.`);
    }
  }
  return loc.key;
}

/**
 * Preflight: block the push with a clear, specific error listing exactly
 * which required specifics are missing (Brand at minimum) instead of
 * letting eBay reject it mid-publish. Checked against the FINAL aspects
 * (after the category catalog filter), because the filter can strip a
 * brand value the category does not accept.
 *
 * Also blocks a push whose draft has no shipping quote (audit #23): the
 * price was built on $0 freight, so the listing would be underpriced by
 * the real shipping cost. The bulk-send path may create drafts without a
 * quote, but the push is the enforcement point.
 */
const PLACEHOLDER_BRANDS = new Set(["unbranded", "does not apply"]);

/**
 * Pure seam for the Brand catalog check (audit #57): when the category
 * catalog restricts Brand to an allowed list and the brand is a
 * placeholder ("Unbranded" / "Does Not Apply") that is not among the
 * allowed values, eBay rejects the push — block it here with a specific
 * error naming the category and the brand problem. Returns the error
 * message, or null when the brand passes. A catalog with no allowed
 * list lets "Unbranded" through as before.
 */
export function brandBlockedByCatalog(
  brand: unknown,
  catalog: Record<string, { required?: boolean; allowed?: string[]; maxLen?: number }> | null | undefined,
  categoryId?: string | null,
): string | null {
  const entry = Object.entries(catalog || {}).find(([name]) => name.toLowerCase() === "brand");
  const allowed = entry?.[1]?.allowed;
  if (!allowed?.length) return null;
  const b = String(brand || "").trim();
  if (!PLACEHOLDER_BRANDS.has(b.toLowerCase())) return null;
  if (allowed.some((v) => String(v).toLowerCase() === b.toLowerCase())) return null;
  return `Brand "${b || "missing"}" is not accepted for eBay category ${categoryId || "this category"} — the category only allows ${allowed.slice(0, 5).join(", ")}${allowed.length > 5 ? ", …" : ""}. Set a real brand (or pick a category that accepts "${b}") and retry.`;
}

function missingRequiredSpecifics(draft: any, aspects: Record<string, string[]>, imageUrls: string[], catalog?: Record<string, { required?: boolean; allowed?: string[]; maxLen?: number }>): string[] {
  const missing: string[] = [];
  if (!safeTitle(draft.title, draft.sku)) missing.push("Title");
  if (!(Number(draft.price) > 0)) missing.push("Price");
  if (!draft.category_id) missing.push("Category");
  if (!imageUrls.length) missing.push("Images (at least one valid http(s) image URL)");
  const brand = aspects.Brand?.[0] || aspects.brand?.[0];
  if (!brand) {
    const draftBrand = cleanText(draft.brand || draft.item_specifics?.Brand);
    missing.push(draftBrand ? `Brand (the category does not accept "${draftBrand}")` : "Brand");
  }
  // Shipping quote (audit #23): a $0/missing shipping means the price was
  // built on free freight — block the push, don't underprice the listing.
  const shipping = Number((draft.profit as any)?.shipping || 0);
  if (!(shipping > 0)) missing.push("Shipping quote (get a shipping quote first — the price needs real freight)");
  return missing;
}

function throwIfMissingSpecifics(draft: any, aspects: Record<string, string[]>, imageUrls: string[], catalog?: Record<string, { required?: boolean; allowed?: string[]; maxLen?: number }>) {
  const missing = missingRequiredSpecifics(draft, aspects, imageUrls, catalog);
  if (missing.length) {
    throw new Error(`Cannot publish "${safeTitle(draft.title, draft.sku)}": missing required eBay specifics: ${missing.join(", ")}. Fix the draft and try again.`);
  }
  // Brand catalog check (audit #57): a placeholder brand the category
  // does not allow must fail here with a specific error, not at eBay.
  // Check the final aspect first; if the filter stripped it, check the
  // draft's own brand so the error names the real problem.
  const brandError =
    brandBlockedByCatalog(aspects.Brand?.[0] || aspects.brand?.[0], catalog, draft.category_id) ||
    brandBlockedByCatalog(draft.brand || draft.item_specifics?.Brand, catalog, draft.category_id);
  if (brandError) throw new Error(`Cannot publish "${safeTitle(draft.title, draft.sku)}": ${brandError}`);
}

function filterAspectsByCategory(aspects: Record<string, string[]>, catalog: Record<string, { required: boolean; allowed?: string[]; maxLen?: number; applicableTo?: string[]; usage?: string; cardinality?: string }>, excludeNames: string[] = []) {
  const excluded = new Set(excludeNames.map((name) => cleanText(name).toLowerCase()).filter(Boolean));
  if (!Object.keys(catalog).length) {
    return Object.fromEntries(Object.entries(aspects).filter(([name]) => !excluded.has(cleanText(name).toLowerCase())));
  }
  const nameByLower: Record<string, string> = {};
  for (const k of Object.keys(catalog)) nameByLower[k.toLowerCase()] = k;
  const out: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(aspects)) {
    const canonical = nameByLower[name.toLowerCase()] || name;
    if (excluded.has(canonical.toLowerCase())) continue;
    const spec = catalog[canonical];
    if (spec?.applicableTo?.includes("PRODUCT") && !spec.applicableTo.includes("ITEM")) continue;
    if (!spec && !/^(brand|condition|mpn|model|type|features)$/i.test(canonical)) continue;
    const maxLen = spec?.maxLen ?? 65;
    let cleanValues = values
      .map((v) => String(v).replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, "").trim())
      .filter(Boolean)
      .map((v) => v.slice(0, maxLen));
    if (spec?.cardinality !== "MULTI") cleanValues = cleanValues.slice(0, 1);
    else cleanValues = cleanValues.slice(0, 30);
    if (spec?.allowed?.length) {
      const allowedLower = new Map(spec.allowed.map((v) => [v.toLowerCase(), v]));
      cleanValues = cleanValues.map((v) => allowedLower.get(v.toLowerCase()) || "").filter(Boolean);
      if (!cleanValues.length && spec.allowed.includes("Does Not Apply")) cleanValues = ["Does Not Apply"];
    }
    if (cleanValues.length) out[canonical] = Array.from(new Set(cleanValues));
  }
  for (const [name, spec] of Object.entries(catalog)) {
    if (excluded.has(name.toLowerCase())) continue;
    if (spec.applicableTo?.includes("PRODUCT") && !spec.applicableTo.includes("ITEM")) continue;
    if (!spec.required || out[name]) continue;
    if (spec.allowed?.includes("Does Not Apply")) out[name] = ["Does Not Apply"];
    else if (spec.allowed?.length) out[name] = [spec.allowed[0]];
    else out[name] = ["Does Not Apply"];
  }
  return out;
}

type DraftVariant = {
  vid?: string;
  sku?: string;
  variantSku?: string;
  variantKey?: string;
  variantNameEn?: string;
  variantImage?: string;
  image?: string;
  price?: number | string;
  variantSellPrice?: number | string;
  inventory?: number;
  quantity?: number;
};

function variantRowsFromDraft(draft: any): DraftVariant[] {
  const candidates = [draft?.variants, draft?.variant_group?.variants, draft?.profit?.variants, draft?.profit?.variant_group?.variants];
  for (const c of candidates) if (Array.isArray(c) && c.length > 1) return c;
  return [];
}

function variantAxes(draft: any, sample: DraftVariant) {
  const configured = draft?.profit?.variant_axes || draft?.variant_axes;
  if (Array.isArray(configured) && configured.length) return configured.map((a: unknown) => cleanText(a)).filter(Boolean);
  const keyHint = cleanText(draft?.profit?.product_key || draft?.productKeyEn || "");
  if (keyHint) return keyHint.split(/[-,/|>]+/).map((a) => cleanText(a)).filter(Boolean);
  const sampleParts = cleanText(sample.variantKey || sample.variantNameEn || "").split(/[-,/|]+/).filter(Boolean);
  if (sampleParts.length <= 1) return ["Option"];
  return sampleParts.map((_, i) => `Option ${i + 1}`);
}

const ITEM_SPECIFIC_AXIS_CONFLICTS = new Set(["type", "brand", "model", "mpn", "condition", "features", "feature", "country", "material"]);

function safeVariationAxes(draft: any, sample: DraftVariant, catalog: Record<string, { required: boolean; allowed?: string[]; maxLen?: number }>) {
  const seen = new Set<string>();
  const catalogLower = new Map(Object.keys(catalog || {}).map((name) => [name.toLowerCase(), catalog[name]]));
  return variantAxes(draft, sample).map((raw, i) => {
    const axis = cleanText(raw) || `Option ${i + 1}`;
    const lower = axis.toLowerCase();
    const conflictsWithRequiredSpecific = ITEM_SPECIFIC_AXIS_CONFLICTS.has(lower) || !!catalogLower.get(lower)?.required;
    let safe = conflictsWithRequiredSpecific ? (/colou?r/i.test(axis) ? "Color" : /size/i.test(axis) ? "Size" : i === 0 ? "Style" : `Option ${i + 1}`) : axis;
    while (seen.has(safe.toLowerCase())) safe = `${safe} ${i + 1}`;
    seen.add(safe.toLowerCase());
    return safe.slice(0, 40);
  });
}

function uniqueVariationOptions(variants: DraftVariant[], axes: string[]) {
  const seenCombos = new Set<string>();
  return variants.map((variant, index) => {
    const raw = variantOptions(variant, axes);
    const options: Record<string, string> = {};
    for (const axis of axes) {
      const value = shortenAspectValue(axis, raw[axis] || variant.variantKey || variant.variantNameEn || variant.variantSku || `Option ${index + 1}`);
      options[axis] = value || `Option ${index + 1}`;
    }
    let combo = axes.map((axis) => options[axis].toLowerCase()).join("|");
    if (seenCombos.has(combo)) {
      const suffix = cleanText(variant.vid || variant.variantSku || index + 1).replace(/[^A-Za-z0-9]/g, "").slice(-6) || String(index + 1);
      options[axes[0]] = shortenAspectValue(axes[0], `${options[axes[0]]} ${suffix}`) || options[axes[0]];
      combo = axes.map((axis) => options[axis].toLowerCase()).join("|");
    }
    seenCombos.add(combo);
    return options;
  });
}

function variantOptions(variant: DraftVariant, axes: string[]) {
  const label = cleanText(variant.variantKey || variant.variantNameEn || variant.sku || variant.variantSku || variant.vid || "Option");
  const parts = label.split(/[-,/|]+/).map((p) => cleanText(p)).filter(Boolean);
  const values = parts.length === axes.length ? parts : axes.length === 1 ? [label] : axes.map((_, i) => parts[i] || label);
  return Object.fromEntries(axes.map((axis, i) => [axis, values[i] || label]));
}

async function putInventoryItem(accessToken: string, sku: string, draft: any, imageUrls: string[], aspects: Record<string, string[]>) {
  if (imageUrls.length === 0) throw new Error(`eBay requires at least one valid http(s) image URL before publishing SKU ${sku}.`);
  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: Number(draft.quantity || 1) } },
    condition: draft.condition || "NEW",
    product: {
      title: safeTitle(draft.title, draft.sku),
      description: safeDescription(draft),
      aspects,
      imageUrls,
    },
  };
  const put = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(itemBody),
  });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`eBay inventory item failed for SKU ${sku}: ${extractEbayErrorText(text) || text || `HTTP ${put.status}`}`);
  }
}

async function createOrUpdateOffer(accessToken: string, offerBody: any) {
  let offerId: string | null = null;
  const createRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(offerBody),
  });
  const createJson = await createRes.json().catch(() => ({}));
  if (createRes.ok) {
    offerId = createJson.offerId;
  } else {
    // Surface eBay's full error text (longMessage first) — the bare
    // "eBay offer failed" hid the real cause in the Vercel logs.
    const createError = createJson.errors?.[0]?.longMessage || createJson.errors?.[0]?.message || createJson.message || JSON.stringify(createJson);
    const existingId = await extractOfferIdFromError(createJson);
    const found = existingId ? { offerId: existingId } : await findOfferBySku(accessToken, offerBody.sku);
    if (!found?.offerId) throw new Error(`eBay offer failed for SKU ${offerBody.sku}: ${createError}`);
    offerId = found.offerId;
    const updateRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
      body: JSON.stringify(offerBody),
    });
    if (!updateRes.ok) {
      const text = await updateRes.text();
      throw new Error(`eBay offer update failed for SKU ${offerBody.sku} (offer ${offerId}): ${extractEbayErrorText(text) || text || `HTTP ${updateRes.status}`}. Original create error: ${createError}`);
    }
  }
  return offerId!;
}

/** The Inventory API group key for a multi-variant draft. Deterministic from
 * the draft SKU so the group can be found again later (e.g. to end or
 * revise a variant listing) without storing an extra column. */
export function variantGroupKeyFor(sku: string | undefined, cjProductId: string | undefined) {
  return `${sku || cjProductId}-grp`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 50);
}

export type BestOfferRule = { best_offer_enabled?: boolean | null; best_offer_min_percent?: number | null };

/**
 * Best Offer fields for a new offer (sales feature #2). Pure seam, built
 * from the automation_rules row and the sell price:
 * - OFF (or no usable price) -> {} so the offer body omits Best Offer.
 * - ON -> bestOfferEnabled with auto-decline at sell x min% (offers below
 *   that are refused automatically) and auto-accept at the full sell
 *   price; offers in between wait for the seller to accept or decline.
 * Only NEW pushes get these fields; existing listings are never touched.
 */
export function bestOfferFields(rule: BestOfferRule | null | undefined, sellPrice: number): Record<string, unknown> {
  const enabled = rule?.best_offer_enabled ?? true;
  if (!enabled) return {};
  const price = Number(sellPrice) || 0;
  if (!(price > 0)) return {};
  const minPct = Math.max(1, Math.min(100, Number(rule?.best_offer_min_percent ?? 80)));
  return {
    bestOfferEnabled: true,
    bestOfferTerms: {
      autoAcceptPrice: { value: price.toFixed(2), currency: "USD" },
      autoDeclinePrice: { value: (price * minPct / 100).toFixed(2), currency: "USD" },
    },
  };
}

/** Writable offer fields for a price revise (PUT replaces the offer). */
const OFFER_PUT_FIELDS = [
  "sku", "marketplaceId", "format", "availableQuantity", "categoryId",
  "merchantLocationKey", "listingDescription", "listingPolicies",
  "pricingSummary", "bestOfferEnabled", "bestOfferTerms", "charity",
  "hideFromSearch", "includeCatalogProductDetails", "listingDuration",
  "listingStartDate", "lotSize", "secondaryCategoryId", "storeCategoryNames",
  "tax", "extendedProducerResponsibility",
] as const;

/**
 * Price-drop revise (sales feature #5): fetch the existing offer, PUT it
 * back with only the price changed (writable fields only, so a revise
 * never drops Best Offer or policies the offer already carries). Same
 * GET-then-PUT pattern as reviseEbayListingText for inventory items.
 */
export async function reviseOfferPrice(accessToken: string, offerId: string, newPrice: number): Promise<{ offerId: string; price: number }> {
  const price = Number(newPrice);
  if (!(price > 0)) throw new Error("A revised price must be greater than 0.");
  const getRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Accept-Language": "en-US" },
  });
  if (!getRes.ok) {
    const text = await getRes.text();
    throw new Error(`eBay offer lookup failed for price revise (${offerId}): ${extractEbayErrorText(text) || text || `HTTP ${getRes.status}`}`);
  }
  const existing: any = await getRes.json().catch(() => ({}));
  const body: Record<string, unknown> = {};
  for (const f of OFFER_PUT_FIELDS) if (existing[f] !== undefined) body[f] = existing[f];
  body.pricingSummary = {
    ...(existing.pricingSummary || {}),
    price: { value: price.toFixed(2), currency: existing.pricingSummary?.price?.currency || "USD" },
  };
  const put = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(body),
  });
  if (!put.ok) {
    const text = await put.text();
    throw new Error(`eBay offer price revise failed for offer ${offerId}: ${extractEbayErrorText(text) || text || `HTTP ${put.status}`}`);
  }
  return { offerId, price: roundMoney(price) };
}

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

async function publishVariantGroup(accessToken: string, draft: any, policies: any, merchantLocationKey: string, variants: DraftVariant[], aspectCatalog: Record<string, { required: boolean; allowed?: string[]; maxLen?: number }>, bestOffer?: BestOfferRule) {
  const axes = safeVariationAxes(draft, variants[0], aspectCatalog);
  const optionsByVariant = uniqueVariationOptions(variants, axes);
  const groupKey = variantGroupKeyFor(draft.sku, draft.cj_product_id);
  const baseImages = normalizeImageUrls(draft.images);
  const allImages = normalizeImageUrls(baseImages, variants.map((v) => v.variantImage || v.image));
  if (allImages.length === 0) throw new Error("eBay requires at least one valid http(s) image URL before publishing variants.");
  // Preflight on the group-level aspects before any variant PUT happens.
  const groupAspects = filterAspectsByCategory(normalizeAspects(draft.item_specifics, draft, {}, axes), aspectCatalog, axes);
  throwIfMissingSpecifics(draft, groupAspects, allImages, aspectCatalog);
  const variantSKUs: string[] = [];
  const variantOfferIds: string[] = [];
  const specifications = axes.map((axis) => ({ name: axis, values: Array.from(new Set(optionsByVariant.map((options) => options[axis]).filter(Boolean))).slice(0, 60) }));
  const imageAxis = axes.find((a) => /color|colour|style|pattern/i.test(a)) || axes[0];

  for (const [index, variant] of variants.entries()) {
    const sku = sanitizeSku(variant.variantSku || variant.sku || variant.vid || `${draft.sku}-${variantSKUs.length + 1}`);
    variantSKUs.push(sku);
    const optionAspects = optionsByVariant[index];
    const imageUrls = normalizeImageUrls(variant.variantImage, variant.image, baseImages, allImages);
    const aspects = filterAspectsByCategory(normalizeAspects(draft.item_specifics, draft, optionAspects, axes), aspectCatalog);
    // ensure variation-axis values are present per-variant even if catalog excluded them
    for (const [k, v] of Object.entries(optionAspects)) if (v) aspects[k] = [String(v).slice(0, 65)];
    await putInventoryItem(accessToken, sku, draft, imageUrls, aspects);
    const variantPrice = priceNumber(variant.price ?? variant.variantSellPrice) || priceNumber(draft.price);
    const variantOfferId = await createOrUpdateOffer(accessToken, stripEmpty({
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: Number(variant.quantity || variant.inventory || draft.quantity || 1),
      categoryId: draft.category_id,
      merchantLocationKey,
      listingDescription: safeDescription(draft),
      listingPolicies: policies,
      pricingSummary: { price: { value: String(Number(variantPrice || draft.price || 0).toFixed(2)), currency: "USD" } },
      ...bestOfferFields(bestOffer, variantPrice),
    }));
    // Keep every variant offer ID: the listing is one eBay item, but the
    // Inventory API manages it as one offer per variant SKU. The first one
    // is stored as ebay_offer_id so optimizer/revise have an identity.
    variantOfferIds.push(variantOfferId);
  }

  const groupBody = {
    title: safeTitle(draft.title, draft.sku),
    description: safeDescription(draft),
    aspects: groupAspects,
    imageUrls: allImages,
    variantSKUs,
    variesBy: { aspectsImageVariesBy: imageAxis ? [imageAxis] : undefined, specifications },
  };
  const groupRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(groupBody),
  });
  if (!groupRes.ok) {
    const text = await groupRes.text();
    throw new Error(`eBay variation group failed: ${extractEbayErrorText(text) || text || `HTTP ${groupRes.status}`}`);
  }

  const publish = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/publish_by_inventory_item_group`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
    body: JSON.stringify({ inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" }),
  });
  const publishJson = await publish.json().catch(() => ({}));
  if (!publish.ok) throw new Error(`eBay variation publish failed: ${publishJson.errors?.[0]?.longMessage || publishJson.errors?.[0]?.message || publishJson.message || JSON.stringify(publishJson)}`);
  return { offerId: variantOfferIds[0] || null, offerIds: variantOfferIds, listingId: publishJson.listingId, inventoryItemGroupKey: groupKey };
}

export async function publishInventoryItem(accessToken: string, draft: any, opts?: { bestOffer?: BestOfferRule }) {
  const policies = await fetchDefaultSellerPolicies(accessToken);
  const merchantLocationKey = await ensureInventoryLocation(accessToken, draft);
  const aspectCatalog = draft.category_id ? await getItemAspectsForCategory(accessToken, String(draft.category_id)) : {};
  const sku = sanitizeSku(draft.sku || `cj-${draft.cj_product_id}`);
  const variants = variantRowsFromDraft(draft);
  if (variants.length > 1) return publishVariantGroup(accessToken, draft, policies, merchantLocationKey, variants, aspectCatalog, opts?.bestOffer);

  const imageUrls = normalizeImageUrls(draft.images);
  const aspects = filterAspectsByCategory(normalizeAspects(draft.item_specifics, draft), aspectCatalog);
  // Block the push here with a specific error instead of letting eBay
  // reject it mid-publish (the Brand failure in the audit).
  throwIfMissingSpecifics(draft, aspects, imageUrls, aspectCatalog);
  await putInventoryItem(accessToken, sku, draft, imageUrls, aspects);

  const offerBody: any = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: Number(draft.quantity || 1),
    categoryId: draft.category_id,
    merchantLocationKey,
    listingDescription: safeDescription(draft),
    listingPolicies: policies,
    pricingSummary: { price: { value: String(Number(draft.price || 0).toFixed(2)), currency: "USD" } },
    // Best Offer (sales feature #2): only new pushes, never existing listings.
    ...bestOfferFields(opts?.bestOffer, Number(draft.price || 0)),
  };

  const offerId = await createOrUpdateOffer(accessToken, offerBody);

  const publish = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
  });
  const publishJson = await publish.json().catch(() => ({}));
  if (!publish.ok) {
    const alreadyPublished = (publishJson.errors || []).some((e: any) => /already.*published|listing.*already/i.test(e.longMessage || e.message || ""));
    if (alreadyPublished) {
      const existing = await findOfferBySku(accessToken, sku);
      return { offerId: offerId!, listingId: existing?.listing?.listingId || null };
    }
    throw new Error(`eBay publish failed: ${publishJson.errors?.[0]?.longMessage || publishJson.message || JSON.stringify(publishJson)}`);
  }
  return { offerId: offerId!, listingId: publishJson.listingId };
}

async function firstPolicy(accessToken: string, kind: "fulfillment" | "payment" | "return") {
  const res = await fetch(`${EBAY_API_BASE}/sell/account/v1/${kind}_policy?marketplace_id=EBAY_US`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = json?.errors?.[0]?.longMessage || json?.message || JSON.stringify(json);
    if (/Business Policy/i.test(detail)) {
      throw new Error("Your eBay account is not opted in to Business Policies. Visit https://www.bizpolicy.ebay.com/businesspolicy/manage to opt in, then create default payment, shipping and return policies before pushing listings.");
    }
    throw new Error(`eBay ${kind} policy lookup failed: ${detail}`);
  }
  const list = json[`${kind}Policies`] || [];
  return list.find((p: any) => p.categoryTypes?.some((c: any) => c.default)) || list[0];
}

async function fetchDefaultSellerPolicies(accessToken: string) {
  const [fulfillment, payment, returns] = await Promise.all([
    firstPolicy(accessToken, "fulfillment"),
    firstPolicy(accessToken, "payment"),
    firstPolicy(accessToken, "return"),
  ]);
  if (!fulfillment?.fulfillmentPolicyId || !payment?.paymentPolicyId || !returns?.returnPolicyId) {
    throw new Error("eBay Business Policies are required. Opt in at https://www.bizpolicy.ebay.com/businesspolicy/manage and create a default payment, shipping (fulfillment) and return policy, then retry.");
  }
  return {
    fulfillmentPolicyId: fulfillment.fulfillmentPolicyId,
    paymentPolicyId: payment.paymentPolicyId,
    returnPolicyId: returns.returnPolicyId,
  };
}
