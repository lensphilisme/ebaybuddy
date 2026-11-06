// Bring-your-own AI provider for listing AI (added Nov 2026).
//
// The user (admin) picks a provider in Settings and pastes their own API
// key. The key is stored server-side only, in the integration_credentials
// row (provider "ai", label "default"), and is NEVER returned to the
// client — the status call only reports provider/model + masked key tail.
// All listing-AI callers go through callAiJson/callAiText here; when no
// provider is configured they return null and the caller uses its local
// fallback rules, exactly as before.
//
// Supported providers (all pay-as-you-go, all cheaper than ChatGPT Plus
// style usage; prices below are approximate Nov 2026 list prices):
// - deepseek: OpenAI-compatible, https://api.deepseek.com/v1
//   default model deepseek-v4-flash (~$0.14 in / $0.28 out per 1M tokens)
// - gemini: Google AI Studio, native generateContent API
//   default model gemini-2.5-flash (~$0.30 in / $2.50 out per 1M, free tier)
// - openai: OpenAI-compatible, https://api.openai.com/v1
//   default model gpt-4o-mini (~$0.15 in / $0.60 out per 1M)
// - custom: any OpenAI-compatible endpoint (base URL + model supplied)
//
// Env fallback (workspace-level, like CJ_API_KEY): AI_PROVIDER, AI_API_KEY,
// AI_MODEL, AI_BASE_URL. A per-user key in Settings always wins.

export type AiProviderId = "deepseek" | "gemini" | "openai" | "custom";

export type AiConfig = {
  provider: AiProviderId;
  model: string;
  apiKey: string;
  baseUrl: string;
};

export const AI_PROVIDERS: Record<AiProviderId, { label: string; defaultModel: string; baseUrl: string; keyUrl: string; hint: string }> = {
  deepseek: {
    label: "DeepSeek (cheapest)",
    defaultModel: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com/v1",
    keyUrl: "https://platform.deepseek.com/api_keys",
    hint: "About $0.14 in / $0.28 out per 1M tokens. Best value for listing work.",
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    keyUrl: "https://aistudio.google.com/apikey",
    hint: "About $0.30 in / $2.50 out per 1M tokens. Google AI Studio has a free tier.",
  },
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
    keyUrl: "https://platform.openai.com/api-keys",
    hint: "gpt-4o-mini is about $0.15 in / $0.60 out per 1M tokens.",
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    defaultModel: "",
    baseUrl: "",
    keyUrl: "",
    hint: "Any endpoint that speaks the OpenAI chat-completions format.",
  },
};

export const AI_PROVIDER_IDS = Object.keys(AI_PROVIDERS) as AiProviderId[];

export function isAiProviderId(value: unknown): value is AiProviderId {
  return typeof value === "string" && (AI_PROVIDER_IDS as string[]).includes(value);
}

export function defaultModelFor(provider: AiProviderId): string {
  return AI_PROVIDERS[provider].defaultModel;
}

/**
 * Row for a saved provider SELECTION (no key yet). is_active stays false
 * so nothing treats it as a connected provider, and the credentials carry
 * NO api_key — a selection must never overwrite a saved key. This is what
 * lets the UI name the selected provider ("DeepSeek · no key saved")
 * instead of claiming "Local only" while DeepSeek is selected.
 */
export function aiSelectionRow(userId: string, provider: AiProviderId, model: string) {
  return {
    user_id: userId,
    provider: "ai",
    label: "default",
    environment: "production",
    is_active: false,
    credentials: {
      auth_type: "api_key",
      managed: true,
      provider,
      model: model || defaultModelFor(provider),
    },
  };
}

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiProviderError";
  }
}

function cleanBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function normalizeAiConfig(input: { provider?: unknown; model?: unknown; apiKey?: unknown; baseUrl?: unknown }): AiConfig {
  const provider = isAiProviderId(input.provider) ? input.provider : "deepseek";
  const model = String(input.model || "").trim() || defaultModelFor(provider);
  const apiKey = String(input.apiKey || "").trim();
  if (!apiKey) throw new AiProviderError("Paste your API key for this provider.");
  if (apiKey.length > 500) throw new AiProviderError("That API key looks too long. Paste the key itself, not a URL or token file.");
  let baseUrl = AI_PROVIDERS[provider].baseUrl;
  if (provider === "custom") {
    baseUrl = cleanBaseUrl(String(input.baseUrl || ""));
    if (!/^https:\/\//.test(baseUrl)) throw new AiProviderError("A custom provider needs a full https:// base URL.");
  } else if (input.baseUrl) {
    baseUrl = cleanBaseUrl(String(input.baseUrl));
  }
  return { provider, model, apiKey, baseUrl };
}

/** Per-user config from the database; env fallback when no row exists. Never logs the key. */
export async function getUserAiConfig(supabase: any, userId: string): Promise<AiConfig | null> {
  const { data, error } = await supabase
    .from("integration_credentials")
    .select("credentials,is_active")
    .eq("user_id", userId)
    .eq("provider", "ai")
    .eq("label", "default")
    .maybeSingle();
  if (error) throw new AiProviderError("Could not read your AI provider settings.");
  const creds = data?.credentials || {};
  if (data?.is_active && typeof creds.api_key === "string" && creds.api_key) {
    return normalizeAiConfig({ provider: creds.provider, model: creds.model, apiKey: creds.api_key, baseUrl: creds.base_url });
  }
  const envKey = (process.env.AI_API_KEY || "").trim();
  if (!envKey) return null;
  return normalizeAiConfig({
    provider: process.env.AI_PROVIDER,
    model: process.env.AI_MODEL,
    apiKey: envKey,
    baseUrl: process.env.AI_BASE_URL,
  });
}

export async function getAiConfigStatus(supabase: any, userId: string): Promise<{ connected: boolean; provider?: AiProviderId; model?: string; keyLast4?: string; source?: "user" | "env" | null }> {
  const { data } = await supabase
    .from("integration_credentials")
    .select("credentials,is_active")
    .eq("user_id", userId)
    .eq("provider", "ai")
    .eq("label", "default")
    .maybeSingle();
  const creds = data?.credentials || {};
  if (data?.is_active && typeof creds.api_key === "string" && creds.api_key) {
    return {
      connected: true,
      provider: isAiProviderId(creds.provider) ? creds.provider : "deepseek",
      model: String(creds.model || defaultModelFor(isAiProviderId(creds.provider) ? creds.provider : "deepseek")),
      keyLast4: creds.api_key.slice(-4),
      source: "user",
    };
  }
  if ((process.env.AI_API_KEY || "").trim()) {
    return {
      connected: true,
      provider: isAiProviderId(process.env.AI_PROVIDER) ? (process.env.AI_PROVIDER as AiProviderId) : "deepseek",
      model: process.env.AI_MODEL || defaultModelFor(isAiProviderId(process.env.AI_PROVIDER) ? (process.env.AI_PROVIDER as AiProviderId) : "deepseek"),
      source: "env",
    };
  }
  // A provider can be SELECTED with no key saved yet (or a removed key) —
  // report the selection so the UI names the provider instead of claiming
  // "no AI provider connected" while DeepSeek is selected (audit #45/#50).
  if (isAiProviderId(creds.provider)) {
    return { connected: false, provider: creds.provider, model: String(creds.model || ""), source: "user" };
  }
  return { connected: false, source: null };
}

function friendlyProviderError(status: number, bodyText: string, provider: AiProviderId): string {
  const detail = (() => {
    try {
      const json = JSON.parse(bodyText);
      return String(json.error?.message || json.error?.status || json.message || "");
    } catch {
      return bodyText.slice(0, 200);
    }
  })();
  if (status === 401 || status === 403) return `The ${AI_PROVIDERS[provider].label} API key was rejected. Check the key in Settings — it must be an API key for that provider, not a login password.`;
  if (status === 404) return `The ${AI_PROVIDERS[provider].label} model was not found. Check the model name in Settings.`;
  if (status === 429) return `The ${AI_PROVIDERS[provider].label} provider is rate-limiting requests. Wait a moment and retry.`;
  return `The AI provider returned ${status}${detail ? `: ${detail}` : ""}.`;
}

async function callOpenAiCompatible(config: AiConfig, system: string, user: string, jsonMode: boolean): Promise<string> {
  const res = await fetch(`${cleanBaseUrl(config.baseUrl)}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new AiProviderError(friendlyProviderError(res.status, text, config.provider));
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiProviderError("The AI provider returned a response that could not be read.");
  }
  const content = json.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiProviderError("The AI provider returned an empty reply.");
  return content;
}

async function callGemini(config: AiConfig, system: string, user: string, jsonMode: boolean): Promise<string> {
  const res = await fetch(`${cleanBaseUrl(config.baseUrl)}/models/${encodeURIComponent(config.model)}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": config.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: {
        temperature: 0.2,
        ...(jsonMode ? { responseMimeType: "application/json" } : {}),
      },
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new AiProviderError(friendlyProviderError(res.status, text, config.provider));
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new AiProviderError("The AI provider returned a response that could not be read.");
  }
  const parts = json.candidates?.[0]?.content?.parts || [];
  const content = parts.map((p: any) => p.text || "").join("");
  if (!content.trim()) throw new AiProviderError("The AI provider returned an empty reply.");
  return content;
}

async function callProvider(config: AiConfig, system: string, user: string, jsonMode: boolean): Promise<string> {
  if (config.provider === "gemini") return callGemini(config, system, user, jsonMode);
  return callOpenAiCompatible(config, system, user, jsonMode);
}

function extractJson(text: string): Record<string, any> {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* fall through */
      }
    }
    throw new AiProviderError("The AI reply was not valid JSON.");
  }
}

/**
 * Ask the user's configured AI provider for a JSON object.
 * Returns null when no provider is configured (caller uses local rules).
 * Throws AiProviderError when a provider IS configured but the call fails —
 * callers catch that and fall back to local rules too, so a provider outage
 * never blocks listing work.
 */
export async function callAiJson(
  supabase: any,
  userId: string,
  input: { system: string; user: string },
): Promise<Record<string, any> | null> {
  const config = await getUserAiConfig(supabase, userId);
  if (!config) return null;
  const text = await callProvider(config, input.system, input.user, true);
  return extractJson(text);
}

/** Same as callAiJson but returns plain text (for title rewrites). */
export async function callAiText(
  supabase: any,
  userId: string,
  input: { system: string; user: string },
): Promise<string | null> {
  const config = await getUserAiConfig(supabase, userId);
  if (!config) return null;
  return (await callProvider(config, input.system, input.user, false)).trim();
}

/** Live-check a config before saving it: the provider must answer "ok". */
export async function validateAiConfig(config: AiConfig): Promise<void> {
  const reply = await callProvider(config, "You are a test endpoint. Reply with exactly: ok", "Reply with exactly: ok", false);
  if (!/ok/i.test(reply)) throw new AiProviderError("The provider answered, but not as expected. Check the model name in Settings.");
}

export function maskApiKey(apiKey: string): string {
  return `••••${apiKey.slice(-4)}`;
}
