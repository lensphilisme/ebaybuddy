// @ts-nocheck -- run with `bun test`
import { describe, expect, test, afterEach } from "bun:test";
import { originCountryForVariant, requireFreightOptions, pricedFreightOptions, cheapestPricedFreightOption, hasUnpricedFreightOnly, freightPrice } from "./cj-inventory";
import { cjFreightCalculate } from "./cj.server";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("originCountryForVariant (freight must start from the stocking warehouse)", () => {
  const usAndCn = {
    inventories: [
      { countryCode: "CN", totalInventoryNum: 50 },
      { countryCode: "US", totalInventoryNum: 20 },
    ],
    variantInventories: [
      { vid: "v1", inventory: [
        { countryCode: "CN", totalInventory: 50 },
        { countryCode: "US", totalInventory: 20 },
      ] },
      { vid: "v2", inventory: [{ countryCode: "CN", totalInventory: 10 }] },
    ],
  };

  test("variant stocked in the destination country ships from there (US -> US)", () => {
    expect(originCountryForVariant(usAndCn, "v1", "US")).toBe("US");
  });

  test("variant stocked only in CN ships from CN even for a US destination", () => {
    expect(originCountryForVariant(usAndCn, "v2", "US")).toBe("CN");
  });

  test("destination with no local stock falls back to the first stocked country", () => {
    expect(originCountryForVariant(usAndCn, "v1", "GB")).toBe("CN");
  });

  test("no inventory at all falls back to CN (the old default)", () => {
    expect(originCountryForVariant(null, "v1", "US")).toBe("CN");
    expect(originCountryForVariant({ inventories: [], variantInventories: [] }, "v1", "US")).toBe("CN");
  });

  test("variant with no stock falls back to the product-level stock", () => {
    const inv = {
      inventories: [{ countryCode: "US", totalInventoryNum: 5 }],
      variantInventories: [{ vid: "v9", inventory: [{ countryCode: "CN", totalInventory: 0 }] }],
    };
    expect(originCountryForVariant(inv, "v9", "US")).toBe("US");
  });
});

describe("requireFreightOptions (an empty quote must fail loudly, never silently)", () => {
  test("a non-empty list passes through", () => {
    const opts = [{ logisticName: "CJPacket", logisticPrice: 5.5, logisticAging: "7-12" }];
    expect(requireFreightOptions(opts, "US")).toBe(opts);
  });

  test("an empty list throws naming the warehouse", () => {
    expect(() => requireFreightOptions([], "US")).toThrow("US warehouse");
    expect(() => requireFreightOptions([], "US")).toThrow("No shipping quote available");
  });

  test("null/undefined also throws", () => {
    expect(() => requireFreightOptions(null, "CN")).toThrow("CN warehouse");
    expect(() => requireFreightOptions(undefined, "CN")).toThrow("CN warehouse");
  });
});

describe("cjFreightCalculate (startCountryCode is sent to CJ)", () => {
  test("passes the origin through instead of defaulting to CN", async () => {
    let seenBody: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ code: 200, message: "success", data: [{ logisticName: "CJPacket", logisticPrice: 5.5, logisticAging: "7-12" }] }), { status: 200 });
    }) as any;
    const opts = await cjFreightCalculate({ startCountryCode: "US", endCountryCode: "US", products: [{ vid: "v1", quantity: 1 }] }, "test-token");
    expect(seenBody.startCountryCode).toBe("US");
    expect(seenBody.endCountryCode).toBe("US");
    expect(opts).toHaveLength(1);
  });

  test("omitting the origin still defaults to CN", async () => {
    let seenBody: any = null;
    globalThis.fetch = (async (url: any, init: any) => {
      seenBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ code: 200, message: "success", data: [] }), { status: 200 });
    }) as any;
    await cjFreightCalculate({ endCountryCode: "US", products: [{ vid: "v1", quantity: 1 }] }, "test-token");
    expect(seenBody.startCountryCode).toBe("CN");
  });
});

describe("priced freight options (a $0.00 option is a missing price, not free shipping)", () => {
  // Live case: the Foldable Inflatable Home Swimming Pool quoted
  // "DHL US to US #3 · 3-5d · $0.00" and the $0 flowed into the landed
  // cost, inflating the shown profit. A $0 DHL shipment of a pool is
  // not plausible free freight — CJ returns null/missing when it cannot
  // price a carrier, and the old `?? 0` turned that into $0.00.
  const dhlZero = { logisticName: "DHL US to US #3", logisticPrice: 0, logisticAging: "3-5" };
  const dhlNull = { logisticName: "DHL Express", logisticPrice: null, logisticAging: "3-5" };
  const packet = { logisticName: "CJPacket", logisticPrice: 5.5, logisticAging: "7-12" };
  const ems = { logisticName: "EMS", logisticPrice: 12.0, logisticAging: "5-8" };

  test("freightPrice turns a missing price into 0 (the signal, not a real price)", () => {
    expect(freightPrice(dhlZero)).toBe(0);
    expect(freightPrice(dhlNull)).toBe(0);
    expect(freightPrice(packet)).toBe(5.5);
    expect(freightPrice(null)).toBe(0);
  });

  test("priced options drop $0/null carriers and sort cheapest first", () => {
    expect(pricedFreightOptions([dhlZero, ems, packet])).toEqual([packet, ems]);
    expect(pricedFreightOptions([dhlZero, dhlNull])).toEqual([]);
    expect(pricedFreightOptions(null)).toEqual([]);
  });

  test("cheapest priced option never picks a $0 carrier", () => {
    expect(cheapestPricedFreightOption([dhlZero, ems, packet])?.logisticName).toBe("CJPacket");
    expect(cheapestPricedFreightOption([dhlZero, dhlNull])).toBeNull();
  });

  test("hasUnpricedFreightOnly is true only when options exist but none has a price", () => {
    expect(hasUnpricedFreightOnly([dhlZero, dhlNull])).toBe(true);
    expect(hasUnpricedFreightOnly([dhlZero, packet])).toBe(false);
    expect(hasUnpricedFreightOnly([])).toBe(false);
    expect(hasUnpricedFreightOnly(null)).toBe(false);
  });
});
