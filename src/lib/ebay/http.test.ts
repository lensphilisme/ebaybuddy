// @ts-nocheck -- run with `bun test`
import { describe, expect, test, beforeEach } from "bun:test";
import { ebayFetch, classifyEbayError, EbayAuthError, EbayRateLimitError, EbayValidationError, sanitizeUrl, singleFlight, __resetBreakers } from "./http";

const realFetch = globalThis.fetch;
beforeEach(() => { __resetBreakers(); globalThis.fetch = realFetch; });

describe("ebay http layer", () => {
  test("retries 429 then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return calls < 2 ? new Response("{}", { status: 429, headers: { "retry-after": "0.01" } }) : new Response("{}", { status: 200 }); }) as any;
    const res = await ebayFetch("https://api.ebay.com/x");
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
  });
  test("does not retry 400", async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response("{}", { status: 400 }); }) as any;
    const res = await ebayFetch("https://api.ebay.com/y");
    expect(res.status).toBe(400);
    expect(calls).toBe(1);
  });
  test("classifies errors", () => {
    expect(classifyEbayError(401, "x")).toBeInstanceOf(EbayAuthError);
    expect(classifyEbayError(429, "x")).toBeInstanceOf(EbayRateLimitError);
    expect(classifyEbayError(422, "x")).toBeInstanceOf(EbayValidationError);
  });
  test("hides tokens in logged urls", () => {
    expect(sanitizeUrl("https://a/b?refresh_token=abc&x=1")).toBe("https://a/b?refresh_token=***&x=1");
  });
  test("single-flight shares one refresh", async () => {
    let runs = 0;
    const fn = async () => { runs++; await new Promise((r) => setTimeout(r, 10)); return "t"; };
    const [a, b] = await Promise.all([singleFlight("u1", fn), singleFlight("u1", fn)]);
    expect(a).toBe("t"); expect(b).toBe("t"); expect(runs).toBe(1);
  });
});
