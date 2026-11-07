// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { parseMoney, roundMoney, roundToLadder, priceFromRules, floorBindsNote, roundingNote, moneyInputValue, loadedMoney } from "./pricing";
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
    for (const v of [p.finalSell, p.profit, p.actualProfit, p.ebayFee, p.landed, p.preFeePrice]) {
      expect(v).toBe(Math.round(v * 100) / 100);
    }
    // landed 7.89, floor binds ($5 > 35% of 7.89 = $2.76): sell $15.99
    expect(p.profit).toBe(5);
    expect(p.finalSell).toBe(15.99);
  });
});

describe("true profit (audit #19: fee is charged on the FINAL sell price)", () => {
  const rules = { markup_percent: 35, min_profit_usd: 9, ebay_fee_buffer_percent: 15, payment_fee_buffer_percent: 4, round_to: 0.99 };
  test("landed $9.45 / $9 floor / 19% fee — true profit is >= the $9 target", () => {
    const p = priceFromRules(9.45, 0, rules);
    // sell = (9.45 + 9) / 0.81 = 22.78 -> ladder 22.99; fee = 22.99 x 19% = 4.37
    expect(p.finalSell).toBe(22.99);
    expect(p.ebayFee).toBe(4.37);
    expect(p.actualProfit).toBe(9.17);
    expect(p.actualProfit).toBeGreaterThanOrEqual(9);
    // profit shown = sell - landed - fee (the old model overstated it at $9.03 on a $21.99 sell)
    expect(p.actualProfit).toBe(roundMoney(p.finalSell - p.landed - p.ebayFee));
  });
  test("landed $4.32 / $9 floor / 19% fee — true profit is >= the $9 target", () => {
    const p = priceFromRules(4.32, 0, rules);
    // sell = (4.32 + 9) / 0.81 = 16.44 -> ladder 16.99; fee = 16.99 x 19% = 3.23
    expect(p.finalSell).toBe(16.99);
    expect(p.ebayFee).toBe(3.23);
    expect(p.actualProfit).toBe(9.44);
    expect(p.actualProfit).toBeGreaterThanOrEqual(9);
    expect(p.actualProfit).toBe(roundMoney(p.finalSell - p.landed - p.ebayFee));
  });
  test("fee is always computed on the final sell price", () => {
    const p = priceFromRules(12.5, 3.25, rules);
    expect(p.ebayFee).toBe(roundMoney(p.finalSell * p.feeRate));
  });
});

describe("pricing copy spacing (audit #24/#53)", () => {
  test("floor and rounding notes keep proper spaces around numbers", () => {
    const floor = floorBindsNote(9, 35, 3.31);
    expect(floor).toBe("Your $9.00 minimum profit applies instead — the 35% markup would only give $3.31.");
    expect(floor).not.toContain("$9.00minimum");
    expect(floor).not.toContain("the35%");
    const rounding = roundingNote(0.14, 15.99, 9.03);
    expect(rounding).toBe("Includes $0.14 added by rounding the price up to $15.99 — sell price − landed cost − fees = $9.03.");
    expect(rounding).not.toContain("$0.14added");
    expect(rounding).not.toContain("$15.99—");
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

describe("moneyInputValue + roundMoney (float32 artifacts at the form boundary)", () => {
  test("a float32 draft price loads as a clean 2dp string", () => {
    expect(moneyInputValue(21.989999771118164)).toBe("21.99");
    expect(moneyInputValue(0.9900000095367432)).toBe("0.99");
    expect(moneyInputValue(15.99)).toBe("15.99");
  });
  test("empty/missing prices load as an empty input", () => {
    expect(moneyInputValue(null)).toBe("");
    expect(moneyInputValue(undefined)).toBe("");
    expect(moneyInputValue("")).toBe("");
  });
  test("the same artifact saves back as a clean 2dp number", () => {
    expect(roundMoney(Number(moneyInputValue(21.989999771118164)))).toBe(21.99);
    expect(roundMoney(0.9900000095367432)).toBe(0.99);
    expect(roundMoney(21.989999771118164)).toBe(21.99);
  });
});

describe("loadedMoney (round 2: the LOADED value, not just the display)", () => {
  test("a draft row carrying a float32 price loads as a clean 2dp number", () => {
    // The live failure: the Edit dialog DISPLAYED 21.99 while the loaded
    // value underneath was 21.989999771118164. loadedMoney is the query
    // boundary that makes the value itself 21.99.
    expect(loadedMoney(21.989999771118164)).toBe(21.99);
    expect(loadedMoney(0.9900000095367432)).toBe(0.99);
    expect(loadedMoney(15.99)).toBe(15.99);
    expect(loadedMoney(null)).toBe(0);
    expect(loadedMoney(undefined)).toBe(0);
  });
  test("a normalized row feeds the form a clean value", () => {
    const row = { id: "d1", price: 21.989999771118164 };
    const loaded = { ...row, price: loadedMoney(row.price) };
    expect(loaded.price).toBe(21.99);
    expect(moneyInputValue(loaded.price)).toBe("21.99");
  });
});
