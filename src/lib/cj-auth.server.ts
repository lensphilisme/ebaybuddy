import { readRuntime, withIntegrationLock, writeRuntime } from "./integration-runtime.server";

export type CjSession = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  refresh_expires_at?: number;
};

export class CjAuthError extends Error {
  constructor(message: string, public code?: string | number) {
    super(message);
    this.name = "CjAuthError";
  }
}

/**
 * CJ has two different secrets and they are NOT interchangeable:
 * - API key: what the user copies from CJ -> My CJ -> Authorization -> API.
 *   It is only ever sent to getAccessToken / refreshAccessToken, on the server.
 * - Access token: what CJ returns for that API key, valid ~180 days, cached
 *   server-side and renewed automatically. The user must never paste this.
 *
 * An access token is JWT-shaped (three dot-separated base64url segments,
 * usually starting with eyJ). A CJ API key is not. Use this only to give a
 * clear error before CJ rejects the value — never to reject a key on shape
 * alone, because CJ is the authority on whether a key is valid.
 */
export function isLikelyCjAccessToken(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  const parts = v.split(".");
  return parts.length === 3 && parts[0].startsWith("eyJ") && parts.every((p) => /^[A-Za-z0-9_-]+$/.test(p) && p.length >= 8);
}

export function parseCjSession(data: Record<string, unknown>): CjSession {
  if (typeof data.accessToken !== "string" || !data.accessToken) throw new CjAuthError("CJ did not issue an access token.");
  const expires = Date.parse(String(data.accessTokenExpiryDate || ""));
  if (!Number.isFinite(expires)) throw new CjAuthError("CJ did not return a valid token expiry.");
  return {
    access_token: data.accessToken,
    refresh_token: typeof data.refreshToken === "string" ? data.refreshToken : undefined,
    expires_at: expires,
    refresh_expires_at: Date.parse(String(data.refreshTokenExpiryDate || "")) || undefined,
  };
}

async function requestSession(body: { apiKey: string } | { refreshToken: string }): Promise<CjSession> {
  const path = "apiKey" in body ? "getAccessToken" : "refreshAccessToken";
  const response = await fetch(`https://developers.cjdropshipping.com/api2.0/v1/authentication/${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({})) as { code?: number; result?: boolean; message?: string; data?: Record<string, unknown> };
  if (!response.ok || json.result === false || json.code !== 200 || !json.data) {
    if (response.status === 429) throw new CjAuthError("CJ is limiting connection requests. Wait a moment and retry.", json.code);
    throw new CjAuthError(
      "CJ rejected this API key. Copy the API key (not an access token) from CJ → My CJ → Authorization → API, and make sure API access is enabled for that account.",
      json.code,
    );
  }
  return parseCjSession(json.data);
}

async function resolveSession(db: any, key: string, apiKey?: string, candidate = false): Promise<string> {
  const stored = await readRuntime(db, key);
  if (!candidate && stored.access_token && stored.expires_at > Date.now() + 300_000) return stored.access_token;
  const wait = Number(stored.last_auth_at || 0) + 1100 - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  await writeRuntime(db, key, { ...stored, last_auth_at: Date.now() });
  let session: CjSession;
  const effectiveKey = apiKey || stored.api_key;
  if (!candidate && stored.refresh_token && stored.refresh_expires_at > Date.now() + 300_000) {
    try { session = await requestSession({ refreshToken: stored.refresh_token }); }
    catch (error) {
      if (!effectiveKey) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1100));
      session = await requestSession({ apiKey: effectiveKey });
    }
  } else {
    if (!effectiveKey) throw new CjAuthError("Add your CJ API key in Settings to renew this connection.");
    session = await requestSession({ apiKey: effectiveKey });
  }
  await writeRuntime(db, key, { ...session, api_key: effectiveKey, last_auth_at: Date.now() });
  return session.access_token;
}

export async function saveUserCjApiKey(userId: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > 200) throw new CjAuthError("Enter your CJ API key, up to 200 characters.");
  if (isLikelyCjAccessToken(trimmed)) {
    throw new CjAuthError(
      "That looks like a CJ access token, not an API key. Access tokens are issued by CJ and renew automatically — paste only the API key from CJ → My CJ → Authorization → API.",
    );
  }
  await withIntegrationLock(`cj:${userId}`, (db) => resolveSession(db, `cj:${userId}`, trimmed, true));
}

/** Force a fresh exchange using the stored API key (used after CJ revokes a token mid-life, code 1600001). */
export async function refreshUserCjToken(supabase: any, userId: string): Promise<string> {
  const { data: row } = await supabase.from("integration_credentials").select("credentials,is_active").eq("user_id", userId).eq("provider", "cj").eq("label", "default").maybeSingle();
  if (row && !row.is_active) throw new CjAuthError("Reconnect CJ in Settings.");
  const storedKey = row?.credentials?.api_key;
  if (storedKey) return withIntegrationLock(`cj:${userId}`, (db) => resolveSession(db, `cj:${userId}`, storedKey, true));
  return withIntegrationLock(`cj:${userId}`, (db) => resolveSession(db, `cj:${userId}`, undefined, true));
}

export async function resolveUserCjToken(supabase: any, userId: string): Promise<string> {
  const { data: row, error } = await supabase.from("integration_credentials").select("credentials,is_active").eq("user_id", userId).eq("provider", "cj").eq("label", "default").maybeSingle();
  if (error) throw new CjAuthError("Could not read your CJ connection.");
  if (row) {
    if (!row.is_active) throw new CjAuthError("Reconnect CJ in Settings.");
    return withIntegrationLock(`cj:${userId}`, async (db) => {
      const stored = await readRuntime(db, `cj:${userId}`);
      if (stored.access_token && stored.expires_at > Date.now() + 300_000) return stored.access_token;
      const apiKey = stored.api_key || row.credentials?.api_key;
      if (!apiKey) throw new CjAuthError("Reconnect CJ in Settings with your API key (not an access token).");
      return resolveSession(db, `cj:${userId}`, apiKey);
    });
  }
  const apiKey = process.env.CJ_API_KEY;
  if (apiKey) return withIntegrationLock("cj:workspace", (db) => resolveSession(db, "cj:workspace", apiKey));
  throw new CjAuthError("Add your CJ API key in Settings first.");
}
