// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { parseMoney, roundMoney, roundToLadder, priceFromRules } from "./pricing";
import { sanitizeSku, extractEbayErrorText } from "./ebay/http";

describe("parseMoney (bug 10: $NaN prices)", () => {
  test("numbers pass through", () => {
    expect(parseMoney(2.76)).toBe(2.76);
    expect(parseMoney(0)).toBe(0);
  });
  test("numeric strings parse", () => {
    expect(parseMoney("2.76")).toBe(2.76);
    expect(parseMoney("1234.56")).toBe(1234.56);
  });
  test("currency symbols and commas are stripped", () => {
    expect(parseMoney("$2.76")).toBe(2.76);
    expect(parseMoney("$1,234.56")).toBe(1234.56);
    expect(parseMoney("USD 9.99")).toBe(9.99);
  });
  test("missing/empty/garbage values never become NaN", () => {
    expect(parseMoney("")).toBe(0);
    expect(parseMoney(undefined)).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney(NaN)).toBe(0);
    expect(parseMoney("free")).toBe(0);
    expect(Number.isNaN(parseMoney("$"))).toBe(false);
  });
});

describe("roundToLadder / roundMoney (bug 11: float artifacts)", () => {
  test("float32 round_to artifact snaps to 0.99", () => {
    expect(roundToLadder(15.34, 0.9900000095367432)).toBe(15.99);
    expect(roundToLadder(24.1, 0.99)).toBe(24.99);
  });
  test("roundMoney kills long floats", () => {
    expect(roundMoney(15.989999771118164)).toBe(15.99);
    expect(roundMoney(0.9900000095367432)).toBe(0.99);
  });
  test("priceFromRules never returns long floats", () => {
    const p = priceFromRules(7.89, 0, { markup_percent: 35, min_profit_usd: 5, ebay_fee_buffer_percent: 15, payment_fee_buffer_percent: 4, round_to: 0.9900000095367432 });
    for (const v of [p.finalSell, p.profit, p.ebayFee, p.landed, p.preFeePrice]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
    // landed 7.89, floor binds ($5 > 35% of 7.89 = $2.76): sell $15.99
    expect(p.profit).toBe(5);
    expect(p.finalSell).toBe(15.99);
  });
});

describe("sanitizeSku (bug 1: bad SKUs sent to eBay)", () => {
  test("keeps letters, digits, - and _", () => {
    expect(sanitizeSku("CJ-ABC_123")).toBe("CJ-ABC_123");
  });
  test("strips spaces, slashes, dots and quotes", () => {
    expect(sanitizeSku("SKU 123/456.78")).toBe("SKU12345678");
    expect(sanitizeSku('a"b\'c')).toBe("abc");
  });
  test("caps at 50 chars", () => {
    expect(sanitizeSku("x".repeat(80)).length).toBe(50);
  });
  test("never returns empty", () => {
    expect(sanitizeSku("!!!").length).toBeGreaterThan(0);
    expect(sanitizeSku("")).toMatch(/^sku-/);
  });
});

describe("extractEbayErrorText (task A: diagnosable error bodies)", () => {
  test("prefers longMessage", () => {
    const body = JSON.stringify({ errors: [{ errorId: 100, message: "short", longMessage: "Invalid value for SKU: bad sku" }] });
    expect(extractEbayErrorText(body)).toContain("Invalid value for SKU");
  });
  test("falls back to message", () => {
    expect(extractEbayErrorText(JSON.stringify({ errors: [{ message: "nope" }] }))).toBe("nope");
  });
  test("scrubs tokens and caps length", () => {
    const body = JSON.stringify({ errors: [{ message: "bad access_token=secret123 here" }] });
    const out = extractEbayErrorText(body) || "";
    expect(out).not.toContain("secret123");
    expect(out.length).toBeLessThanOrEqual(300);
  });
  test("empty body returns undefined", () => {
    expect(extractEbayErrorText("")).toBeUndefined();
  });
});
