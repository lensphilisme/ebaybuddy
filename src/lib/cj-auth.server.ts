import { readRuntime, withIntegrationLock, writeRuntime } from "./integration-runtime.server";

export type CjSession = {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  refresh_expires_at?: number;
};

export function parseCjSession(data: Record<string, unknown>): CjSession {
  if (typeof data.accessToken !== "string" || !data.accessToken) throw new Error("CJ did not issue an access token.");
  const expires = Date.parse(String(data.accessTokenExpiryDate || ""));
  if (!Number.isFinite(expires)) throw new Error("CJ did not return a valid token expiry.");
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
  const json = await response.json() as { code?: number; result?: boolean; data?: Record<string, unknown> };
  if (!response.ok || json.result === false || json.code !== 200 || !json.data) {
    if (response.status === 429) throw new Error("CJ is limiting connection requests. Wait a moment and retry.");
    throw new Error("CJ rejected the connection. Copy your API key (not an access token) from CJ → My CJ → Authorization → API.");
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
    if (!effectiveKey) throw new Error("Add your CJ API key in Settings to renew this connection.");
    session = await requestSession({ apiKey: effectiveKey });
  }
  await writeRuntime(db, key, { ...session, api_key: effectiveKey, last_auth_at: Date.now() });
  return session.access_token;
}

export async function saveUserCjApiKey(userId: string, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim();
  if (!trimmed || trimmed.length > 200) throw new Error("Enter your CJ API key, up to 200 characters.");
  await withIntegrationLock(`cj:${userId}`, (db) => resolveSession(db, `cj:${userId}`, trimmed, true));
}

export async function resolveUserCjToken(supabase: any, userId: string): Promise<string> {
  const { data: row, error } = await supabase.from("integration_credentials").select("credentials,is_active").eq("user_id", userId).eq("provider", "cj").eq("label", "default").maybeSingle();
  if (error) throw new Error("Could not read your CJ connection.");
  if (row) {
    if (!row.is_active) throw new Error("Reconnect CJ in Settings.");
    return withIntegrationLock(`cj:${userId}`, async (db) => {
      const stored = await readRuntime(db, `cj:${userId}`);
      if (!stored.access_token && row.credentials?.api_key) return resolveSession(db, `cj:${userId}`, row.credentials.api_key);
      // Preserve old per-user tokens without ever renewing them using another account's key.
      if (!stored.access_token && row.credentials?.access_token) return row.credentials.access_token;
      return resolveSession(db, `cj:${userId}`);
    });
  }
  const apiKey = process.env.CJ_API_KEY;
  if (apiKey) return withIntegrationLock("cj:workspace", (db) => resolveSession(db, "cj:workspace", apiKey));
  if (process.env.CJ_ACCESS_TOKEN) return process.env.CJ_ACCESS_TOKEN;
  throw new Error("Add your CJ API key in Settings first.");
}