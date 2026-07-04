const EBAY_API_BASE = process.env.EBAY_API_BASE || "https://api.ebay.com";
const EBAY_TRADING_ENDPOINT = "https://api.ebay.com/ws/api.dll";

export type EbayCredential = {
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  connected_at?: string;
};

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing.readonly",
].join(" ");

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function basicAuth() {
  return Buffer.from(`${required("EBAY_CLIENT_ID")}:${required("EBAY_CLIENT_SECRET")}`).toString("base64");
}

export function ebayConsentUrl(state: string) {
  const q = new URLSearchParams({
    client_id: required("EBAY_CLIENT_ID"),
    redirect_uri: required("EBAY_RUNAME"),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `https://auth.ebay.com/oauth2/authorize?${q}`;
}

export async function exchangeEbayCode(code: string): Promise<EbayCredential> {
  const res = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: required("EBAY_RUNAME") }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`eBay OAuth error: ${json.error_description || json.error || res.statusText}`);
  return {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expires_at: Date.now() + (Number(json.expires_in || 7200) - 120) * 1000,
    connected_at: new Date().toISOString(),
  };
}

export async function refreshEbayAccessToken(refreshToken: string): Promise<EbayCredential> {
  const res = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: SCOPES }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`eBay refresh error: ${json.error_description || json.error || res.statusText}`);
  return { access_token: json.access_token, expires_at: Date.now() + (Number(json.expires_in || 7200) - 120) * 1000 };
}

export async function getUserEbayCredential(supabase: any, userId: string): Promise<EbayCredential> {
  const { data } = await supabase
    .from("integration_credentials")
    .select("credentials")
    .eq("user_id", userId)
    .eq("provider", "ebay")
    .eq("label", "default")
    .maybeSingle();
  const creds = (data?.credentials || {}) as EbayCredential;
  if (!creds.refresh_token && process.env.EBAY_USER_REFRESH_TOKEN) creds.refresh_token = process.env.EBAY_USER_REFRESH_TOKEN;
  if (!creds.refresh_token) throw new Error("Connect your eBay account in Settings first.");
  return creds;
}

export async function getFreshEbayToken(supabase: any, userId: string) {
  const creds = await getUserEbayCredential(supabase, userId);
  if (creds.access_token && creds.expires_at && creds.expires_at > Date.now()) return creds.access_token;
  const fresh = await refreshEbayAccessToken(creds.refresh_token!);
  const row = {
    user_id: userId,
    provider: "ebay",
    label: "default",
    environment: "production",
    is_active: true,
    last_validated_at: new Date().toISOString(),
    credentials: { ...creds, ...fresh },
  };
  const { data: existing } = await supabase.from("integration_credentials").select("id").eq("user_id", userId).eq("provider", "ebay").eq("label", "default").maybeSingle();
  if (existing?.id) await supabase.from("integration_credentials").update(row).eq("id", existing.id);
  else await supabase.from("integration_credentials").insert(row);
  return fresh.access_token!;
}

function tag(xml: string, name: string) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim() || "";
}

export type EbayActiveListing = {
  itemId: string;
  title: string;
  sku: string;
  price: number;
  currency: string;
  quantity: number;
  quantitySold: number;
  watchCount: number;
  imageUrl?: string;
  listedAt?: string;
  url: string;
};

export async function fetchActiveEbayListings(accessToken: string, pageNumber = 1, entriesPerPage = 100) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <ErrorLanguage>en_US</ErrorLanguage><WarningLevel>High</WarningLevel>
    <ActiveList><Include>true</Include><Pagination><EntriesPerPage>${entriesPerPage}</EntriesPerPage><PageNumber>${pageNumber}</PageNumber></Pagination></ActiveList>
    <DetailLevel>ReturnAll</DetailLevel>
  </GetMyeBaySellingRequest>`;
  const res = await fetch(EBAY_TRADING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml",
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": "0",
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1451",
      "X-EBAY-API-IAF-TOKEN": accessToken,
    },
    body: xml,
  });
  const text = await res.text();
  if (!res.ok || /<Ack>(Failure|PartialFailure)<\/Ack>/i.test(text)) throw new Error(`eBay listings error: ${tag(text, "LongMessage") || res.statusText}`);
  const total = Number(tag(text, "TotalNumberOfEntries") || 0);
  const items = [...text.matchAll(/<Item>([\s\S]*?)<\/Item>/g)].map((m): EbayActiveListing => {
    const node = m[1];
    return {
      itemId: tag(node, "ItemID"),
      title: tag(node, "Title"),
      sku: tag(node, "SKU") || tag(node, "ItemID"),
      price: Number(tag(node, "CurrentPrice") || tag(node, "BuyItNowPrice") || 0),
      currency: node.match(/currencyID="([^"]+)"/)?.[1] || "USD",
      quantity: Number(tag(node, "Quantity") || 0),
      quantitySold: Number(tag(node, "QuantitySold") || 0),
      watchCount: Number(tag(node, "WatchCount") || 0),
      imageUrl: tag(node, "PictureURL") || undefined,
      listedAt: tag(node, "StartTime") || undefined,
      url: tag(node, "ViewItemURL") || `https://www.ebay.com/itm/${tag(node, "ItemID")}`,
    };
  });
  return { total, items };
}

export async function getCategorySuggestions(accessToken: string, q: string, marketplaceId = "EBAY_US") {
  const treeRes = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const tree = await treeRes.json();
  if (!treeRes.ok) throw new Error(`eBay category tree error: ${tree.message || treeRes.statusText}`);
  const res = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`eBay category suggestion error: ${json.message || res.statusText}`);
  return (json.categorySuggestions || []).map((s: any) => ({
    categoryId: s.category?.categoryId,
    categoryName: s.category?.categoryName,
    path: (s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName).concat(s.category?.categoryName).filter(Boolean).join(" > "),
  }));
}

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
  return String(value ?? fallback)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
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
    const trimmed = input.trim();
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try { return flattenImageInput(JSON.parse(trimmed)); } catch { /* keep as URL below */ }
    }
    return [trimmed];
  }
  return [];
}

function normalizeImageUrls(...inputs: unknown[]) {
  const urls: string[] = [];
  for (const input of inputs) {
    for (const raw of flattenImageInput(input)) {
      const value = String(raw || "").trim().replace(/^['"]|['"]$/g, "");
      if (!value || value.startsWith("[") || value.includes('"')) continue;
      try {
        const parsed = new URL(value);
        if ((parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".")) urls.push(parsed.toString());
      } catch { /* ignore invalid provider image values */ }
    }
  }
  return Array.from(new Set(urls)).slice(0, 12);
}

function normalizeAspects(input: any, draft: any, extra: Record<string, unknown> = {}) {
  const raw = { ...(input || {}), ...extra };
  if (draft.brand) raw.Brand = draft.brand;
  if (draft.model) raw.Model = draft.model;
  if (!raw.Brand) raw.Brand = "Unbranded";
  const aspects: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    const name = cleanText(key);
    if (!name || /^country$/i.test(name)) continue;
    const values = (Array.isArray(value) ? value : [value])
      .map((v) => cleanText(v))
      .filter(Boolean)
      .slice(0, 10);
    if (values.length) aspects[name] = Array.from(new Set(values));
  }
  return aspects;
}

function priceNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const first = String(value ?? "").match(/\d+(?:\.\d+)?/);
  return first ? Number(first[0]) : 0;
}

function locationForDraft(draft: any) {
  const country = cleanText(draft?.profit?.start_country || draft?.profit?.warehouse_country || "US").toUpperCase().slice(0, 2) || "US";
  const postalByCountry: Record<string, string> = { US: "10001", CN: "518000", GB: "SW1A 1AA", CA: "M5H 2N2", AU: "2000", DE: "10115", FR: "75001" };
  return {
    key: `droplist_${country.toLowerCase()}`.slice(0, 36),
    country,
    postalCode: postalByCountry[country] || "10001",
  };
}

async function ensureInventoryLocation(accessToken: string, draft: any) {
  const loc = locationForDraft(draft);
  const body = {
    location: { address: { country: loc.country, postalCode: loc.postalCode } },
    name: `DropList ${loc.country} fulfillment`,
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
  await fetch(`${EBAY_API_BASE}/sell/inventory/v1/location/${encodeURIComponent(loc.key)}/enable`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Accept-Language": "en-US" },
  }).catch(() => undefined);
  return loc.key;
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

function variantOptions(variant: DraftVariant, axes: string[]) {
  const label = cleanText(variant.variantKey || variant.variantNameEn || variant.sku || variant.variantSku || variant.vid || "Option");
  const parts = label.split(/[-,/|]+/).map((p) => cleanText(p)).filter(Boolean);
  const values = parts.length === axes.length ? parts : axes.length === 1 ? [label] : axes.map((_, i) => parts[i] || label);
  return Object.fromEntries(axes.map((axis, i) => [axis, values[i] || label]));
}

async function putInventoryItem(accessToken: string, sku: string, draft: any, imageUrls: string[], aspects: Record<string, string[]>) {
  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: Number(draft.quantity || 1) } },
    condition: draft.condition || "NEW",
    product: {
      title: safeTitle(draft.title, draft.sku),
      description: cleanText(draft.description, draft.title) || safeTitle(draft.title, draft.sku),
      aspects,
      imageUrls,
    },
  };
  const put = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(itemBody),
  });
  if (!put.ok) throw new Error(`eBay inventory item failed: ${await put.text()}`);
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
    const existingId = await extractOfferIdFromError(createJson);
    const found = existingId ? { offerId: existingId } : await findOfferBySku(accessToken, offerBody.sku);
    if (!found?.offerId) throw new Error(`eBay offer failed: ${createJson.errors?.[0]?.longMessage || createJson.errors?.[0]?.message || createJson.message || JSON.stringify(createJson)}`);
    offerId = found.offerId;
    const updateRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
      body: JSON.stringify(offerBody),
    });
    if (!updateRes.ok) throw new Error(`eBay offer update failed: ${await updateRes.text()}`);
  }
  return offerId!;
}

async function publishVariantGroup(accessToken: string, draft: any, policies: any, merchantLocationKey: string, variants: DraftVariant[]) {
  const axes = variantAxes(draft, variants[0]);
  const groupKey = `${draft.sku || draft.cj_product_id}-grp`.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 50);
  const baseImages = normalizeImageUrls(draft.images);
  const variantSKUs: string[] = [];
  const specifications = axes.map((axis) => ({ name: axis, values: Array.from(new Set(variants.map((v) => variantOptions(v, axes)[axis]).filter(Boolean))) }));
  const imageAxis = axes.find((a) => /color|colour|style|pattern/i.test(a)) || axes[0];

  for (const variant of variants) {
    const sku = cleanText(variant.variantSku || variant.sku || variant.vid || `${draft.sku}-${variantSKUs.length + 1}`).replace(/\s+/g, "-").slice(0, 50);
    variantSKUs.push(sku);
    const optionAspects = variantOptions(variant, axes);
    const imageUrls = normalizeImageUrls(variant.variantImage, variant.image, baseImages);
    await putInventoryItem(accessToken, sku, draft, imageUrls, normalizeAspects(draft.item_specifics, draft, optionAspects));
    const variantPrice = priceNumber(variant.price ?? variant.variantSellPrice) || priceNumber(draft.price);
    await createOrUpdateOffer(accessToken, stripEmpty({
      sku,
      marketplaceId: "EBAY_US",
      format: "FIXED_PRICE",
      availableQuantity: Number(variant.quantity || variant.inventory || draft.quantity || 1),
      categoryId: draft.category_id,
      merchantLocationKey,
      listingDescription: cleanText(draft.description, draft.title),
      listingPolicies: policies,
      pricingSummary: { price: { value: String(Number(variantPrice || draft.price || 0).toFixed(2)), currency: "USD" } },
    }));
  }

  const groupBody = {
    title: safeTitle(draft.title, draft.sku),
    description: cleanText(draft.description, draft.title),
    aspects: normalizeAspects(draft.item_specifics, draft),
    imageUrls: normalizeImageUrls(baseImages, variants.map((v) => v.variantImage || v.image)),
    variantSKUs,
    variesBy: { aspectsImageVariesBy: imageAxis ? [imageAxis] : undefined, specifications },
  };
  const groupRes = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US", "Accept-Language": "en-US" },
    body: JSON.stringify(groupBody),
  });
  if (!groupRes.ok) throw new Error(`eBay variation group failed: ${await groupRes.text()}`);

  const publish = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/publish_by_inventory_item_group`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
    body: JSON.stringify({ inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" }),
  });
  const publishJson = await publish.json().catch(() => ({}));
  if (!publish.ok) throw new Error(`eBay variation publish failed: ${publishJson.errors?.[0]?.longMessage || publishJson.errors?.[0]?.message || publishJson.message || JSON.stringify(publishJson)}`);
  return { offerId: null, listingId: publishJson.listingId, inventoryItemGroupKey: groupKey };
}

export async function publishInventoryItem(accessToken: string, draft: any) {
  const policies = await fetchDefaultSellerPolicies(accessToken);
  const merchantLocationKey = await ensureInventoryLocation(accessToken, draft);
  const sku = draft.sku || `cj-${draft.cj_product_id}`;
  const variants = variantRowsFromDraft(draft);
  if (variants.length > 1) return publishVariantGroup(accessToken, draft, policies, merchantLocationKey, variants);

  const imageUrls = normalizeImageUrls(draft.images);
  if (imageUrls.length === 0) throw new Error("eBay requires at least one valid http(s) image URL before publishing.");
  await putInventoryItem(accessToken, sku, draft, imageUrls, normalizeAspects(draft.item_specifics, draft));

  const offerBody: any = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: Number(draft.quantity || 1),
    categoryId: draft.category_id,
    merchantLocationKey,
    listingDescription: cleanText(draft.description, draft.title),
    listingPolicies: policies,
    pricingSummary: { price: { value: String(Number(draft.price || 0).toFixed(2)), currency: "USD" } },
  };

  const offerId = await createOrUpdateOffer(accessToken, offerBody);

  const publish = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Accept-Language": "en-US" },
  });
  const publishJson = await publish.json().catch(() => ({}));
  if (!publish.ok) {
    // If already published, look up the listingId from the offer record and treat as success.
    const alreadyPublished = (publishJson.errors || []).some((e: any) => /already.*published|listing.*already/i.test(e.longMessage || e.message || ""));
    if (alreadyPublished) {
      const existing = await findOfferBySku(accessToken, sku);
      return { offerId: offerId!, listingId: existing?.listing?.listingId || null };
    }
    throw new Error(`eBay publish failed: ${publishJson.errors?.[0]?.longMessage || publishJson.message || JSON.stringify(publishJson)}`);
  }
  return { offerId: offerId!, listingId: publishJson.listingId };
}

// Fetch the full first-two levels of the eBay category tree for a marketplace.
// Used by the AI deep-category picker as a fallback when normal suggestions are wrong.
export async function getEbayCategoryTreeShallow(accessToken: string, marketplaceId = "EBAY_US") {
  const treeRes = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const treeMeta = await treeRes.json();
  if (!treeRes.ok) throw new Error(`eBay category tree error: ${treeMeta.message || treeRes.statusText}`);
  const full = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${treeMeta.categoryTreeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const fullJson = await full.json();
  if (!full.ok) throw new Error(`eBay tree fetch error: ${fullJson.message || full.statusText}`);
  const rows: { categoryId: string; path: string; leaf: boolean }[] = [];
  const walk = (node: any, path: string[], depth: number) => {
    const name = node?.category?.categoryName;
    const id = node?.category?.categoryId;
    const nextPath = name ? [...path, name] : path;
    const leaf = !!node?.leafCategoryTreeNode;
    if (id && depth >= 1) rows.push({ categoryId: id, path: nextPath.join(" > "), leaf });
    if (node?.childCategoryTreeNodes && depth < 3) {
      for (const c of node.childCategoryTreeNodes) walk(c, nextPath, depth + 1);
    }
  };
  walk(fullJson.rootCategoryNode, [], 0);
  return { treeId: treeMeta.categoryTreeId, categories: rows };
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