// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { bestOfferFields, brandBlockedByCatalog } from "./inventory.server";
import { priceDropFor, cjStockIsZero } from "./optimizer-policy";
import { completenessScore } from "../completeness";

describe("Best Offer (sales feature #2)", () => {
  test("offer body includes bestOfferEnabled when the rule is on", () => {
    const fields = bestOfferFields({ best_offer_enabled: true, best_offer_min_percent: 80 }, 25);
    expect(fields.bestOfferEnabled).toBe(true);
    const terms: any = fields.bestOfferTerms;
    // auto-decline at sell x min% = $25 x 80% = $20.00; auto-accept at full price
    expect(terms.autoDeclinePrice.value).toBe("20.00");
    expect(terms.autoAcceptPrice.value).toBe("25.00");
    expect(terms.autoDeclinePrice.currency).toBe("USD");
  });
  test("offer body omits bestOfferEnabled when the rule is off", () => {
    expect(bestOfferFields({ best_offer_enabled: false, best_offer_min_percent: 80 }, 25)).toEqual({});
  });
  test("missing rule row defaults to ON at 80%", () => {
    const fields = bestOfferFields(null, 10);
    expect(fields.bestOfferEnabled).toBe(true);
    expect((fields.bestOfferTerms as any).autoDeclinePrice.value).toBe("8.00");
  });
  test("no usable price means no Best Offer fields", () => {
    expect(bestOfferFields({ best_offer_enabled: true, best_offer_min_percent: 80 }, 0)).toEqual({});
  });
});

describe("Brand catalog check (audit #57)", () => {
  const catalog = { Brand: { required: true, allowed: ["Nike", "Adidas"], maxLen: 65 } };
  test("placeholder brand not in the allowed list is blocked with the category named", () => {
    const err = brandBlockedByCatalog("Unbranded", catalog, "182068");
    expect(err).toContain("182068");
    expect(err).toContain("Unbranded");
    expect(err).toContain("Nike");
  });
  test("'Does Not Apply' placeholder is blocked the same way", () => {
    expect(brandBlockedByCatalog("Does Not Apply", catalog, "182068")).toContain("Does Not Apply");
  });
  test("a real brand in the allowed list passes", () => {
    expect(brandBlockedByCatalog("Nike", catalog, "182068")).toBeNull();
  });
  test("no allowed list means 'Unbranded' passes as before", () => {
    expect(brandBlockedByCatalog("Unbranded", {}, "182068")).toBeNull();
    expect(brandBlockedByCatalog("Unbranded", { Brand: { required: true } }, "182068")).toBeNull();
  });
  test("placeholder that IS in the allowed list passes", () => {
    const permissive = { Brand: { required: true, allowed: ["Unbranded", "Nike"], maxLen: 65 } };
    expect(brandBlockedByCatalog("Unbranded", permissive, "182068")).toBeNull();
  });
});

describe("price-drop ladder (sales feature #5)", () => {
  const rules = { optimizer_price_drop_enabled: true, optimizer_price_drop_max_percent: 20, markup_percent: 35, min_profit_usd: 9, ebay_fee_buffer_percent: 15, payment_fee_buffer_percent: 4, round_to: 0.99 };
  test("cuts 5% when there is room above the floor and cap", () => {
    // landed 9.45, current $30: 5% cut = $28.50; floor = $22.99; cap = original x 80%
    const drop = priceDropFor({ price: 30, cj_landed_cost: 9.45 }, rules);
    expect(drop).not.toBeNull();
    expect(drop!.newPrice).toBe(28.5);
    expect(drop!.floor).toBe(22.99);
  });
  test("never drops below the min-profit floor", () => {
    // landed 9.45, current $23.50: 5% cut = $22.33, below the $22.99 floor -> floor wins, but floor ($22.99) < current ($23.50) so a drop still applies at the floor
    const drop = priceDropFor({ price: 23.5, cj_landed_cost: 9.45 }, rules);
    expect(drop).not.toBeNull();
    expect(drop!.newPrice).toBe(22.99);
    expect(drop!.floor).toBe(22.99);
  });
  test("no drop when the price is already at the floor", () => {
    expect(priceDropFor({ price: 22.99, cj_landed_cost: 9.45 }, rules)).toBeNull();
  });
  test("no drop when the landed cost is unknown", () => {
    expect(priceDropFor({ price: 30, cj_landed_cost: null }, rules)).toBeNull();
  });
  test("no drop when the feature is off", () => {
    expect(priceDropFor({ price: 30, cj_landed_cost: 9.45 }, { ...rules, optimizer_price_drop_enabled: false })).toBeNull();
  });
  test("total cap binds: never more than max% below the original price", () => {
    // landed $150 at 35% markup: original = (150 + 52.50) / 0.81 -> $249.99; cap = 249.99 x 80% = $199.99.
    // floor = (150 + 9) / 0.81 -> $196.99. A listing priced at $210: 5% cut = $199.50, below the cap -> cap wins at $199.99.
    const drop = priceDropFor({ price: 210, cj_landed_cost: 150 }, rules);
    expect(drop).not.toBeNull();
    expect(drop!.floor).toBe(196.99);
    expect(drop!.capPrice).toBe(199.99);
    expect(drop!.newPrice).toBe(199.99);
  });
});

describe("CJ stock guard (sales feature #4)", () => {
  test("all variants at 0 means out of stock", () => {
    expect(cjStockIsZero({ variants: [{ inventory: 0 }, { inventory: 0 }] })).toBe(true);
  });
  test("any variant with stock means in stock", () => {
    expect(cjStockIsZero({ variants: [{ inventory: 0 }, { inventory: 3 }] })).toBe(false);
  });
  test("undefined inventory is unknown, never blocks", () => {
    expect(cjStockIsZero({ variants: [{}, {}] })).toBe(false);
    expect(cjStockIsZero({ variants: [] })).toBe(false);
    expect(cjStockIsZero({})).toBe(false);
  });
  test("variantList / productVariants aliases work", () => {
    expect(cjStockIsZero({ variantList: [{ inventory: 0 }] })).toBe(true);
    expect(cjStockIsZero({ productVariants: [{ inventory: 5 }] })).toBe(false);
  });
});

describe("completeness score (sales feature #7)", () => {
  test("a complete listing scores 100", () => {
    const { score } = completenessScore({
      title: "Resin Three-Link Watch Strap Compatible With The Watch — Brown Leather",
      itemSpecifics: { Brand: "Unbranded", Model: "X", Type: "Strap", Material: "Resin", Color: "Brown" },
      images: ["a.jpg", "b.jpg", "c.jpg", "d.jpg"],
      description: "A very long description. ".repeat(30),
    });
    expect(score).toBe(100);
  });
  test("an empty listing scores 0", () => {
    expect(completenessScore({}).score).toBe(0);
  });
  test("a thin listing scores in the middle", () => {
    const { score, parts } = completenessScore({
      title: "Watch strap",
      itemSpecifics: { Brand: "Unbranded" },
      images: ["a.jpg"],
      description: "Short.",
    });
    expect(score).toBe(10 + 10 + 10 + 10);
    expect(parts.title).toBe(10);
  });
});
