// @ts-nocheck -- run with `bun test`
import { describe, expect, test, beforeEach } from "bun:test";
import { mapOfferToActiveListing, shippingFulfillmentPayload } from "./contracts";
import { classifyNotification } from "./notifications.server";
import { fetchPublishedOffersPage, fetchPublishedOffersViaInventory, fetchEndedOffersViaInventory } from "./listings.server";
import { __resetBreakers } from "./http";
import offerPage from "./__fixtures__/offer-page.json";
import inventoryItem from "./__fixtures__/inventory-item.json";

const realFetch = globalThis.fetch;
beforeEach(() => {
  __resetBreakers();
  globalThis.fetch = realFetch;
});

describe("modern listings mapping", () => {
  test("mixed pages never skip published offers at the batch boundary", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/offer?")) {
        const offset = Number(new URL(String(url)).searchParams.get("offset"));
        const all = [0,1,2,3].map((n) => ({ offerId: `o${n}`, sku: `s${n}`, status: n === 0 ? "UNPUBLISHED" : "PUBLISHED", marketplaceId: "EBAY_US", listing: n === 0 ? undefined : { listingId: String(n) } }));
        return Response.json({ total: 4, offers: all.slice(offset, offset + 2) });
      }
      return Response.json(inventoryItem);
    };
    const first = await fetchPublishedOffersPage("fixture", 0, 2);
    const second = await fetchPublishedOffersPage("fixture", first.nextOffset, 2);
    expect(first.nextOffset).toBe(3);
    expect([...first.items, ...second.items].map((item) => item.itemId)).toEqual(["1","2","3"]);
    globalThis.fetch = realFetch;
  });
  test("published offer joins to its inventory item; unpublished is skipped", async () => {
    let calls = 0;
    globalThis.fetch = (async (url: string) => {
      calls++;
      if (String(url).includes("/offer?"))
        return new Response(JSON.stringify(offerPage), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      return new Response(JSON.stringify(inventoryItem), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as any;
    const page = await fetchPublishedOffersPage("test-token", 0, 100);
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);
    expect(page.items[0].itemId).toBe("111222333");
    expect(page.items[0].offerId).toBe("offer-1");
    expect(page.items[0].title).toBe("Test Widget");
    expect(page.items[0].price).toBe(19.99);
    // Modern API has no sold/watch counts — they must stay undefined, never 0.
    expect(page.items[0].quantitySold).toBeUndefined();
    expect(page.items[0].watchCount).toBeUndefined();
  });

  test("offer without a listingId is dropped, not synced as a blank row", () => {
    expect(
      mapOfferToActiveListing({ offerId: "x", sku: "S", marketplaceId: "EBAY_US" } as any, null),
    ).toBeNull();
  });

  test("shipping fulfillment payload is built, but no test here sends it", () => {
    const payload = shippingFulfillmentPayload({
      lineItems: [{ lineItemId: "li-1", quantity: 1 }],
      shippedDate: "2026-10-21T10:00:00.000Z",
      shippingCarrierCode: "USPS",
      trackingNumber: "TRACK1",
    });
    expect(payload.trackingNumber).toBe("TRACK1");
  });

  test("notification classification dedupes and routes topics", () => {
    expect(
      classifyNotification(
        { metadata: { topic: "ITEM_SOLD" }, notification: { notificationId: "n1" } } as any,
        true,
      ).action,
    ).toBe("duplicate");
    expect(
      classifyNotification(
        { metadata: { topic: "RETURN_CREATED" }, notification: { notificationId: "n2" } } as any,
        false,
      ).action,
    ).toBe("return_created");
    expect(
      classifyNotification(
        { metadata: { topic: "SOMETHING_ELSE" }, notification: { notificationId: "n3" } } as any,
        false,
      ).action,
    ).toBe("ignored");
  });
});

describe("sync resilience (task B3)", () => {
  test("an offer that cannot map is skipped and counted, not fatal", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/offer?")) {
        return Response.json({
          total: 2,
          offers: [
            { offerId: "o-good", sku: "good-1", status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "111" }, pricingSummary: { price: { value: "9.99", currency: "USD" } } },
            // Published but no listingId: mapOfferToActiveListing returns null.
            { offerId: "o-bad", sku: "bad sku/with spaces", status: "PUBLISHED", marketplaceId: "EBAY_US", pricingSummary: { price: { value: "1.00", currency: "USD" } } },
          ],
        });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchPublishedOffersPage("test-token", 0, 100);
    expect(page.items.length).toBe(1);
    expect(page.items[0].itemId).toBe("111");
    expect(page.skipped).toBe(1);
    globalThis.fetch = realFetch;
  });

  test("inventory-first route recovers published offers when the offer list rejects every page", async () => {
    const skuError = () =>
      new Response(JSON.stringify({ errors: [{ errorId: 25707, message: "This is an invalid value for a SKU. Only alphanumeric characters can be used for SKUs, and their length must not exceed 50 characters" }] }), { status: 400, headers: { "content-type": "application/json" } });
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/inventory_item")) {
        return Response.json({
          total: 2,
          inventoryItems: [
            { sku: "good-1", product: { title: "Good Widget", imageUrls: ["https://example.com/good.jpg"] }, availability: { shipToLocationAvailability: { quantity: 3 } } },
            { sku: "bad sku/with spaces", product: { title: "Bad Widget" } },
          ],
        });
      }
      if (u.pathname.endsWith("/offer")) {
        const sku = u.searchParams.get("sku");
        if (sku === "good-1") {
          return Response.json({
            total: 1,
            offers: [{ offerId: "o-good", sku: "good-1", status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "555", listingStartDate: "2026-08-01T00:00:00.000Z" }, pricingSummary: { price: { value: "12.50", currency: "USD" } } }],
          });
        }
        return skuError();
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchPublishedOffersViaInventory("test-token");
    expect(page.total).toBe(2);
    expect(page.items.length).toBe(1);
    expect(page.items[0].itemId).toBe("555");
    expect(page.items[0].title).toBe("Good Widget");
    expect(page.items[0].price).toBe(12.5);
    expect(page.skipped).toBe(1);
    globalThis.fetch = realFetch;
  });

  test("a bulk offer list poisoned by one bad SKU falls back to probing one at a time", async () => {
    const skuError = () =>
      new Response(JSON.stringify({ errors: [{ errorId: 25710, message: "This is an invalid value for a SKU. Only alphanumeric characters can be used for SKUs, and their length must not exceed 50 characters" }] }), { status: 400, headers: { "content-type": "application/json" } });
    const good = (n: number) => ({ offerId: `o-${n}`, sku: `good-${n}`, status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: String(100 + n) }, pricingSummary: { price: { value: "9.99", currency: "USD" } } });
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.includes("/offer")) {
        const limit = Number(u.searchParams.get("limit"));
        const offset = Number(u.searchParams.get("offset"));
        // The bulk page is poisoned by the bad offer, so eBay 400s it.
        if (limit > 1) return skuError();
        // Probing one at a time: offset 1 is the poisoned offer.
        if (offset === 1) return skuError();
        if (offset === 0) return Response.json({ total: 3, offers: [good(0)] });
        if (offset === 2) return Response.json({ total: 3, offers: [good(2)] });
        return Response.json({ total: 3, offers: [] });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchPublishedOffersPage("test-token", 0, 100);
    expect(page.items.map((i) => i.itemId)).toEqual(["100", "102"]);
    expect(page.skipped).toBe(1);
    expect(page.total).toBe(3);
    globalThis.fetch = realFetch;
  });

  test("SKUs stored from sync are sanitized", async () => {
    globalThis.fetch = async (url) => {
      if (String(url).includes("/offer?")) {
        return Response.json({
          total: 1,
          offers: [
            { offerId: "o-1", sku: "bad sku/with spaces", status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "222" }, pricingSummary: { price: { value: "5.00", currency: "USD" } } },
          ],
        });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchPublishedOffersPage("test-token", 0, 100);
    expect(page.items[0].sku).toBe("badskuwithspaces");
    globalThis.fetch = realFetch;
  });
});

describe("ended offers (UNPUBLISHED, not ENDED)", () => {
  test("a withdrawn (UNPUBLISHED) offer is surfaced; a PUBLISHED one is not", async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/inventory_item")) {
        return Response.json({
          total: 3,
          inventoryItems: [
            { sku: "ended-1", product: { title: "Ended Pet Bed", imageUrls: ["https://example.com/bed.jpg"] } },
            { sku: "live-1", product: { title: "Live Toy" } },
            { sku: "draft-1", product: { title: "Never Published Toy" } },
          ],
        });
      }
      if (u.pathname.endsWith("/offer")) {
        const sku = u.searchParams.get("sku");
        if (sku === "ended-1") {
          return Response.json({
            total: 2,
            offers: [
              // Withdrawn listing: UNPUBLISHED, still carries its listingId.
              { offerId: "o-ended", sku: "ended-1", status: "UNPUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "999" }, pricingSummary: { price: { value: "12.99", currency: "USD" } } },
              // The same SKU also has a live offer — it must NOT appear here.
              { offerId: "o-live", sku: "ended-1", status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "1000" }, pricingSummary: { price: { value: "12.99", currency: "USD" } } },
            ],
          });
        }
        if (sku === "draft-1") {
          return Response.json({
            total: 1,
            // Never published: UNPUBLISHED with no listingId — still surfaced.
            offers: [{ offerId: "o-draft", sku: "draft-1", status: "UNPUBLISHED", marketplaceId: "EBAY_US", pricingSummary: { price: { value: "5.00", currency: "USD" } } }],
          });
        }
        return Response.json({
          total: 1,
          offers: [{ offerId: "o-live-1", sku: "live-1", status: "PUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "1001" }, pricingSummary: { price: { value: "7.50", currency: "USD" } } }],
        });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchEndedOffersViaInventory("test-token");
    expect(page.total).toBe(3);
    // Round 2: only offers that were ACTUALLY LISTED (carry a listingId)
    // count as ended. The never-published offer is excluded from the
    // list and counted separately — it must not inflate the Ended tab.
    expect(page.items.map((i) => i.sku).sort()).toEqual(["ended-1"]);
    expect(page.neverPublished).toBe(1);
    expect(page.items.find((i) => i.sku === "ended-1")?.listingId).toBe("999");
    expect(page.items.find((i) => i.sku === "ended-1")?.title).toBe("Ended Pet Bed");
    expect(page.items.find((i) => i.sku === "draft-1")).toBeUndefined();
    globalThis.fetch = realFetch;
  });

  test("a whitespace-only title falls back to the SKU (no blank row)", async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/inventory_item")) {
        return Response.json({ total: 1, inventoryItems: [{ sku: "CJPC242270002BY", product: { title: "   ", imageUrls: [] } }] });
      }
      if (u.pathname.endsWith("/offer")) {
        return Response.json({ total: 1, offers: [{ offerId: "o-blank", sku: "CJPC242270002BY", status: "UNPUBLISHED", marketplaceId: "EBAY_US", listing: { listingId: "555" }, pricingSummary: { price: { value: "9.99", currency: "USD" } } }] });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchEndedOffersViaInventory("test-token");
    expect(page.items.length).toBe(1);
    expect(page.items[0].title).toBe("CJPC242270002BY");
    expect(page.items[0].listingId).toBe("555");
    globalThis.fetch = realFetch;
  });

  test("the old ENDED status value never matches anything", async () => {
    globalThis.fetch = async (url) => {
      const u = new URL(String(url));
      if (u.pathname.endsWith("/inventory_item")) {
        return Response.json({ total: 1, inventoryItems: [{ sku: "weird-1", product: { title: "Weird" } }] });
      }
      if (u.pathname.endsWith("/offer")) {
        // eBay never returns this status; if it ever did, it is not an
        // UNPUBLISHED offer and the Ended view must not claim it.
        return Response.json({ total: 1, offers: [{ offerId: "o-weird", sku: "weird-1", status: "ENDED", marketplaceId: "EBAY_US", pricingSummary: { price: { value: "1.00", currency: "USD" } } }] });
      }
      return Response.json(inventoryItem);
    };
    const page = await fetchEndedOffersViaInventory("test-token");
    expect(page.items.length).toBe(0);
    globalThis.fetch = realFetch;
  });
});
