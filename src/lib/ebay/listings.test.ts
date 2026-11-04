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
