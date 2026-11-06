// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { mapMarketplaceCategory } from "./marketplace-category";
import { resolveMarketplaceLocation, MARKETPLACE_LOCATION_DEFAULT_LABEL } from "./marketplace-location";
import { buildMarketplaceRow, marketplaceDescription, extractFbListingId } from "./marketplace-build";
import { priceFromRules } from "./pricing";

describe("Marketplace category mapping", () => {
  test("pet beds map to pet, not furniture", () => {
    expect(mapMarketplaceCategory({ title: "Soft Plush Dog Bed for Small Dogs", categoryName: "Pet Supplies" })).toBe("pet");
    expect(mapMarketplaceCategory({ title: "Orthopedic Dog Bed — Large", categoryName: "Dog Beds" })).toBe("pet");
  });
  test("pet toys map to pet, not toys", () => {
    expect(mapMarketplaceCategory({ title: "Cat Toy Interactive Feather Wand", categoryName: "Pet Toys" })).toBe("pet");
    expect(mapMarketplaceCategory({ title: "Dog Chew Toy Rope", categoryName: "" })).toBe("pet");
  });
  test("headphones map to electronics", () => {
    expect(mapMarketplaceCategory({ title: "Wireless Bluetooth Headphones Over Ear HiFi", categoryName: "Headphones" })).toBe("electronics");
    expect(mapMarketplaceCategory({ title: "True Wireless Earbuds with Charging Case", categoryName: "" })).toBe("electronics");
  });
  test("lamps map to home, not furniture or electronics", () => {
    expect(mapMarketplaceCategory({ title: "Modern LED Table Lamp", categoryName: "Lamps" })).toBe("home");
    expect(mapMarketplaceCategory({ title: "Rattan Wall Lamp", categoryName: "Lighting" })).toBe("home");
  });
  test("watch straps map to miscellaneous (a watch strap is an accessory, not a device)", () => {
    expect(mapMarketplaceCategory({ title: "Resin Three-link Watch Strap Compatible With The Watch", categoryName: "Watch Bands" })).toBe("miscellaneous");
    expect(mapMarketplaceCategory({ title: "Leather Watch Band 22mm", categoryName: "" })).toBe("miscellaneous");
  });
  test("a smart watch is electronics, a strap is not", () => {
    expect(mapMarketplaceCategory({ title: "Smart Watch with Heart Rate Monitor", categoryName: "" })).toBe("electronics");
  });
  test("clothing, furniture, toys, sports, auto-parts, garden", () => {
    expect(mapMarketplaceCategory({ title: "Men's Casual Cotton T-Shirt", categoryName: "Clothing" })).toBe("clothing");
    expect(mapMarketplaceCategory({ title: "Wooden Dining Table for 6", categoryName: "Furniture" })).toBe("furniture");
    expect(mapMarketplaceCategory({ title: "Kids Building Blocks Toy Set 100pc", categoryName: "Toys" })).toBe("toys");
    expect(mapMarketplaceCategory({ title: "Non-Slip Yoga Mat 6mm", categoryName: "Sports" })).toBe("sports");
    expect(mapMarketplaceCategory({ title: "Car Brake Pads Set Front", categoryName: "Auto Parts" })).toBe("auto-parts");
    expect(mapMarketplaceCategory({ title: "Ceramic Garden Plant Pot", categoryName: "Garden" })).toBe("garden");
  });
  test("empty or unknown products map to miscellaneous", () => {
    expect(mapMarketplaceCategory({ title: "", categoryName: "" })).toBe("miscellaneous");
    expect(mapMarketplaceCategory({})).toBe("miscellaneous");
    expect(mapMarketplaceCategory({ title: "Some random gadget thing", categoryName: "" })).toBe("miscellaneous");
  });
});

describe("Marketplace location", () => {
  test("no label defaults to Jacksonville, FL", () => {
    const loc = resolveMarketplaceLocation(null);
    expect(loc.label).toBe(MARKETPLACE_LOCATION_DEFAULT_LABEL);
    expect(loc.latitude).toBe(30.3322);
    expect(loc.longitude).toBe(-81.6557);
    expect(loc.approximate).toBe(false);
  });
  test("a Jacksonville ZIP is an exact match", () => {
    const loc = resolveMarketplaceLocation("32211");
    expect(loc.latitude).toBe(30.3322);
    expect(loc.approximate).toBe(false);
  });
  test("any other place falls back to Jacksonville coords and says so", () => {
    const loc = resolveMarketplaceLocation("Miami, FL");
    expect(loc.label).toBe("Miami, FL");
    expect(loc.latitude).toBe(30.3322);
    expect(loc.longitude).toBe(-81.6557);
    expect(loc.approximate).toBe(true);
    expect(loc.note).toBe("update the ZIP for a precise location");
  });
});

describe("Marketplace row builder (price/description reuse)", () => {
  const rules = { markup_percent: 35, min_profit_usd: 9, ebay_fee_buffer_percent: 15, payment_fee_buffer_percent: 4, round_to: 0.99, max_listing_quantity: 5 };
  test("the prepared price is the draft's final sell price, fee on the final price", () => {
    // Same numbers as the audit #19 case: landed 9.45 + 5.13 shipping,
    // $9 min profit, 19% fee -> final sell $29.99, true profit >= $9.
    const priced = priceFromRules(9.45, 5.13, rules);
    const row = buildMarketplaceRow({
      draft: { id: "d1", cj_product_id: "CJPB123", title: "Wireless Bluetooth Headphones", price: priced.finalSell, description: "Great sound.", images: ["https://example.com/a.jpg"] },
      userId: "u1",
    });
    expect(row.price).toBe(priced.finalSell);
    expect(row.price).toBe(29.99);
    expect(priced.actualProfit).toBeGreaterThanOrEqual(9);
  });
  test("description is plain text: no HTML, no images, no dangling Product Image label", () => {
    const row = buildMarketplaceRow({
      draft: {
        id: "d1", cj_product_id: "CJPB123", title: "Dog Bed", price: 21.99,
        description: "<p>Product information: Colors: Brown.</p><p>Product Image:</p><img src=\"https://example.com/x.jpg\"> Packing: Opp bag",
        images: [],
      },
      userId: "u1",
    });
    expect(row.description).not.toContain("<");
    expect(row.description).not.toContain("Product Image:");
    expect(row.description).toContain("Colors: Brown.");
    expect(row.description).toContain("Packing: Opp bag");
  });
  test("photos are cleaned, deduped and capped at 10", () => {
    const images = Array.from({ length: 12 }, (_, i) => `https://example.com/${i}.jpg`);
    const row = buildMarketplaceRow({
      draft: { id: "d1", cj_product_id: "CJPB123", title: "Lamp", price: 15.99, description: "", images: [...images, images[0], "not-a-url"] },
      userId: "u1",
    });
    expect(row.photos).toHaveLength(10);
    expect(row.photos[0]).toBe("https://example.com/0.jpg");
  });
  test("condition is always new and status starts ready", () => {
    const row = buildMarketplaceRow({
      draft: { id: "d1", cj_product_id: "CJPB123", title: "Lamp", price: 15.99, description: "", images: [] },
      userId: "u1",
    });
    expect(row.condition).toBe("new");
    expect(row.status).toBe("ready");
    expect(row.fb_category).toBe("home");
    expect(row.latitude).toBe(30.3322);
    expect(row.location_label).toBe(MARKETPLACE_LOCATION_DEFAULT_LABEL);
  });
  test("long descriptions are capped, not cut mid-word silently", () => {
    const long = "A very detailed description. ".repeat(100);
    const text = marketplaceDescription(long);
    expect(text.length).toBeLessThanOrEqual(1501);
    expect(text.endsWith("…")).toBe(true);
  });
});

describe("extractFbListingId", () => {
  test("parses a marketplace item URL", () => {
    expect(extractFbListingId("https://www.facebook.com/marketplace/item/1234567890")).toBe("1234567890");
  });
  test("anything else returns null", () => {
    expect(extractFbListingId("https://www.facebook.com/")).toBeNull();
    expect(extractFbListingId(null)).toBeNull();
    expect(extractFbListingId("")).toBeNull();
  });
});
