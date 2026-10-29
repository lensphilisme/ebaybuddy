import { ebayFetch as fetch, classifyEbayError, EbayAuthError } from "./http";
const EBAY_API_BASE = "https://api.ebay.com";
import { withIntegrationLock } from "../integration-runtime.server";
import { readRuntime, writeRuntime } from "../integration-runtime.server";
export type EbayCredential = {
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  connected_at?: string;
  scope?: string;
};

const SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.marketing",
  "https://api.ebay.com/oauth/api_scope/sell.payment.dispute",
  // Needed for Event Notification subscriptions. Accounts connected before
  // this scope was added must reconnect once in Settings to grant it.
  "https://api.ebay.com/oauth/api_scope/sell.notification",
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
  if (!res.ok) throw classifyEbayError(res.status, `eBay OAuth error: ${json.error_description || json.error || res.statusText}`, res.headers.get("x-ebay-c-request-id") || undefined);
  return {
    refresh_token: json.refresh_token,
    access_token: json.access_token,
    expires_at: Date.now() + (Number(json.expires_in || 7200) - 120) * 1000,
    connected_at: new Date().toISOString(),
    scope: json.scope || SCOPES,
  };
}

export async function refreshEbayAccessToken(refreshToken: string): Promise<EbayCredential> {
  const res = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basicAuth()}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    // Omit scope to preserve grants of older accounts until they reconnect.
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
  });
  const json = await res.json();
  if (!res.ok) throw classifyEbayError(res.status, `eBay refresh error: ${json.error_description || json.error || res.statusText}`, res.headers.get("x-ebay-c-request-id") || undefined);
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
  if (!creds.refresh_token) throw new EbayAuthError("Connect your eBay seller account in Settings first.");
  return creds;
}

export async function getFreshEbayToken(supabase: any, userId: string) {
  const creds = await getUserEbayCredential(supabase, userId);
  if (creds.access_token && creds.expires_at && creds.expires_at > Date.now() + 300_000) return creds.access_token;
  return withIntegrationLock(`ebay-token:${userId}`, () => getFreshEbayTokenInner(supabase, userId));
}

async function getFreshEbayTokenInner(supabase: any, userId: string) {
  const creds = await getUserEbayCredential(supabase, userId);
  if (creds.access_token && creds.expires_at && creds.expires_at > Date.now() + 60_000) return creds.access_token;
  if (!creds.refresh_token) throw new EbayAuthError("Reconnect eBay in Settings.");
  const fresh = await refreshEbayAccessToken(creds.refresh_token);
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
  const saved = existing?.id ? await supabase.from("integration_credentials").update(row).eq("id", existing.id) : await supabase.from("integration_credentials").insert(row);
  if (saved.error || !fresh.access_token) throw new EbayAuthError("Could not renew your eBay connection.");
  return fresh.access_token;
}

export async function getEbayApplicationToken(): Promise<string> {
  return withIntegrationLock("ebay:application", async (db) => {
    const saved = await readRuntime(db, "ebay:application");
    if (saved.access_token && saved.expires_at > Date.now() + 300_000) return saved.access_token;
    const res = await fetch(`${EBAY_API_BASE}/identity/v1/oauth2/token`, {
      method: "POST", headers: { Authorization: `Basic ${basicAuth()}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
    }, { maxRetries: 0 });
    const json = await res.json();
    if (!res.ok || !json.access_token) throw classifyEbayError(res.status, "Could not authorize the eBay application.", res.headers.get("x-ebay-c-request-id") || undefined);
    await writeRuntime(db, "ebay:application", { access_token: json.access_token, expires_at: Date.now() + Number(json.expires_in) * 1000 });
    return json.access_token;
  });
}

