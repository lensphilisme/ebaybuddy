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
  await supabase.from("integration_credentials").upsert({
    user_id: userId,
    provider: "ebay",
    label: "default",
    environment: "production",
    is_active: true,
    last_validated_at: new Date().toISOString(),
    credentials: { ...creds, ...fresh },
  }, { onConflict: "user_id,provider,label" });
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
  url: string;
};

export async function fetchActiveEbayListings(accessToken: string, pageNumber = 1, entriesPerPage = 100) {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
  <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
    <RequesterCredentials><eBayAuthToken>${accessToken}</eBayAuthToken></RequesterCredentials>
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

export async function publishInventoryItem(accessToken: string, draft: any) {
  const sku = draft.sku || `cj-${draft.cj_product_id}`;
  const aspects = Object.fromEntries(Object.entries(draft.item_specifics || {}).map(([k, v]) => [k, Array.isArray(v) ? v : [String(v)]]));
  const itemBody = {
    availability: { shipToLocationAvailability: { quantity: Number(draft.quantity || 1) } },
    condition: draft.condition || "NEW",
    product: {
      title: String(draft.title || "").slice(0, 80),
      description: draft.description || draft.title,
      aspects,
      imageUrls: Array.isArray(draft.images) ? draft.images : [],
    },
  };
  const put = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US" },
    body: JSON.stringify(itemBody),
  });
  if (!put.ok) throw new Error(`eBay inventory item failed: ${await put.text()}`);

  const offerBody = {
    sku,
    marketplaceId: "EBAY_US",
    format: "FIXED_PRICE",
    availableQuantity: Number(draft.quantity || 1),
    categoryId: draft.category_id,
    listingDescription: draft.description || draft.title,
    listingPolicies: {},
    pricingSummary: { price: { value: String(Number(draft.price || 0).toFixed(2)), currency: "USD" } },
  };
  const offer = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "Content-Language": "en-US" },
    body: JSON.stringify(offerBody),
  });
  const offerJson = await offer.json().catch(() => ({}));
  if (!offer.ok) throw new Error(`eBay offer failed: ${offerJson.message || JSON.stringify(offerJson)}`);
  const offerId = offerJson.offerId;
  const publish = await fetch(`${EBAY_API_BASE}/sell/inventory/v1/offer/${offerId}/publish`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
  });
  const publishJson = await publish.json().catch(() => ({}));
  if (!publish.ok) throw new Error(`eBay publish failed: ${publishJson.message || JSON.stringify(publishJson)}`);
  return { offerId, listingId: publishJson.listingId };
}