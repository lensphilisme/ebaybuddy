// @ts-nocheck -- run with `bun test`
import { describe, expect, test, beforeEach } from "bun:test";
import { mapOfferToActiveListing, shippingFulfillmentPayload } from "./contracts";
import { classifyNotification } from "./notifications.server";
import { fetchPublishedOffersPage } from "./listings.server";
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
