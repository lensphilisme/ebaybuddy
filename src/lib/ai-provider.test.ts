// @ts-nocheck -- run with `bun test`
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  normalizeAiConfig,
  callAiJson,
  callAiText,
  validateAiConfig,
  getAiConfigStatus,
  aiSelectionRow,
  AiProviderError,
} from "./ai-provider.server";

const originalFetch = globalThis.fetch;

function mockFetch(handler: (url: string, init: any) => Response) {
  globalThis.fetch = (async (url: any, init: any) => handler(String(url), init)) as any;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function userSupabase(config: any) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: config ? { is_active: true, credentials: config } : null, error: null }) }) }) }),
      }),
    }),
  };
}

describe("normalizeAiConfig", () => {
  test("deepseek gets its default model and base URL", () => {
    const c = normalizeAiConfig({ provider: "deepseek", apiKey: "sk-test" });
    expect(c.provider).toBe("deepseek");
    expect(c.model).toBe("deepseek-v4-flash");
    expect(c.baseUrl).toBe("https://api.deepseek.com/v1");
  });
  test("gemini gets its default model", () => {
    const c = normalizeAiConfig({ provider: "gemini", apiKey: "AIza-test" });
    expect(c.model).toBe("gemini-2.5-flash");
  });
  test("custom requires an https base URL", () => {
    expect(() => normalizeAiConfig({ provider: "custom", model: "x", apiKey: "k" })).toThrow("https://");
  });
  test("empty key is rejected", () => {
    expect(() => normalizeAiConfig({ provider: "deepseek", apiKey: "  " })).toThrow("API key");
  });
});

describe("callAiJson (DeepSeek, OpenAI-compatible)", () => {
  beforeEach(() => {
    mockFetch((url) => {
      expect(url).toBe("https://api.deepseek.com/v1/chat/completions");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"title":"New Title","brand":"Acme"}' } }] }), { status: 200 });
    });
  });
  test("parses the JSON reply", async () => {
    const out = await callAiJson(userSupabase({ provider: "deepseek", model: "deepseek-v4-flash", api_key: "sk-test" }), "u1", { system: "s", user: "u" });
    expect(out).toEqual({ title: "New Title", brand: "Acme" });
  });
  test("401 becomes a clear wrong-key error", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "Incorrect API key" } }), { status: 401 }));
    await expect(callAiJson(userSupabase({ provider: "deepseek", model: "deepseek-v4-flash", api_key: "sk-bad" }), "u1", { system: "s", user: "u" })).rejects.toThrow("API key was rejected");
  });
  test("no provider configured returns null (local fallback)", async () => {
    const out = await callAiJson(userSupabase(null), "u1", { system: "s", user: "u" });
    expect(out).toBeNull();
  });
});

describe("callAiJson (Gemini)", () => {
  test("uses generateContent with the api key header and parses candidates", async () => {
    let seenUrl = "";
    let seenKey = "";
    mockFetch((url, init) => {
      seenUrl = url;
      seenKey = init.headers["x-goog-api-key"];
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Gemini Title"}' }] } }] }), { status: 200 });
    });
    const out = await callAiJson(userSupabase({ provider: "gemini", model: "gemini-2.5-flash", api_key: "AIza-test" }), "u1", { system: "s", user: "u" });
    expect(seenUrl).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
    expect(seenKey).toBe("AIza-test");
    expect(out).toEqual({ title: "Gemini Title" });
  });
});

describe("validateAiConfig", () => {
  test("accepts a provider that answers ok", async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 }));
    await validateAiConfig(normalizeAiConfig({ provider: "deepseek", apiKey: "sk-test" }));
  });
  test("rejects a wrong model with a clear message", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: { message: "Model not found" } }), { status: 404 }));
    await expect(validateAiConfig(normalizeAiConfig({ provider: "deepseek", model: "nope", apiKey: "sk-test" }))).rejects.toThrow("model was not found");
  });
  test("callAiText returns plain text", async () => {
    mockFetch(() => new Response(JSON.stringify({ choices: [{ message: { content: "  Short Title  " } }] }), { status: 200 }));
    const out = await callAiText(userSupabase({ provider: "openai", model: "gpt-4o-mini", api_key: "sk-test" }), "u1", { system: "s", user: "u" });
    expect(out).toBe("Short Title");
  });
  test("AiProviderError is an Error", () => {
    expect(new AiProviderError("x")).toBeInstanceOf(Error);
  });
});

describe("getAiConfigStatus (three states)", () => {
  // The status also falls back to env vars — keep the env key unset so the
  // DB row is the only source in these tests.
  const prevEnvKey = process.env.AI_API_KEY;
  beforeEach(() => { delete process.env.AI_API_KEY; });
  afterEach(() => { if (prevEnvKey !== undefined) process.env.AI_API_KEY = prevEnvKey; });

  test("provider + key saved -> connected with provider, model and key tail", async () => {
    const s = await getAiConfigStatus(userSupabase({ provider: "deepseek", model: "deepseek-v4-flash", api_key: "sk-test-1234" }), "u1");
    expect(s.connected).toBe(true);
    expect(s.provider).toBe("deepseek");
    expect(s.model).toBe("deepseek-v4-flash");
    expect(s.keyLast4).toBe("1234");
    expect(s.source).toBe("user");
  });

  test("provider selected but NO key saved -> not connected, provider still named", async () => {
    const s = await getAiConfigStatus(userSupabase({ provider: "deepseek", model: "deepseek-v4-flash" }), "u1");
    expect(s.connected).toBe(false);
    expect(s.provider).toBe("deepseek");
    expect(s.model).toBe("deepseek-v4-flash");
    expect(s.source).toBe("user");
  });

  test("no row at all -> not connected, no provider (Local only)", async () => {
    const s = await getAiConfigStatus(userSupabase(null), "u1");
    expect(s.connected).toBe(false);
    expect(s.provider).toBeUndefined();
    expect(s.source).toBeNull();
  });
});

describe("aiSelectionRow (save provider choice without a key)", () => {
  test("carries provider + model, no api_key, and is inactive", () => {
    const row = aiSelectionRow("u1", "deepseek", "deepseek-v4-flash");
    expect(row.provider).toBe("ai");
    expect(row.label).toBe("default");
    expect(row.is_active).toBe(false);
    expect(row.credentials.provider).toBe("deepseek");
    expect(row.credentials.model).toBe("deepseek-v4-flash");
    expect("api_key" in row.credentials).toBe(false);
  });
  test("empty model falls back to the provider default", () => {
    expect(aiSelectionRow("u1", "gemini", "").credentials.model).toBe("gemini-2.5-flash");
  });
});
