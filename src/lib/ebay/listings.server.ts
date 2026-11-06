import { EbayRestClient } from "./rest.server";
import { EbayValidationError, sanitizeSku } from "./http";
import type { EbayActiveListing, InventoryRecord, OfferRecord } from "./contracts";
import { mapOfferToActiveListing } from "./contracts";

// Modern Inventory API replacement for the old Trading API.
// - Active listings: GET /sell/inventory/v1/offer (published offers) joined
//   to GET /sell/inventory/v1/inventory_item/{sku} (title / images).
// - Revise title: PUT /sell/inventory/v1/inventory_item/{sku} with the
//   existing item merged, because Inventory revises by SKU, not listing ID.
// - End listing: POST /sell/inventory/v1/offer/{offerId}/withdraw.
// Documented loss vs Trading API: quantitySold and watchCount are not
// exposed by the Inventory API, so sync must preserve stored values.

function isSkuListError(e: unknown): boolean {
  const status = (e as any)?.status;
  const msg = e instanceof Error ? e.message : String(e);
  return status === 400 && /SKU/i.test(msg);
}

export async function fetchPublishedOffersPage(
  accessToken: string,
  offset = 0,
  limit = 100,
): Promise<{ total: number; items: EbayActiveListing[]; nextOffset: number; skipped: number; retrieved: boolean }> {
  const client = new EbayRestClient(accessToken);
  const capped = Math.max(1, Math.min(limit, 100));
  // A page of offers can mix published and unpublished offers, so keep
  // paging through offers until this page is full of published listings
  // or offers are exhausted — otherwise sync would stop early.
  let cursor = Math.max(0, offset);
  let total = 0;
  let skipped = 0;
  // retrieved = at least one offer-list page actually returned data. When
  // eBay rejects every page (error 25707, see below), retrieved stays
  // false so the caller knows to try the inventory-item route instead.
  let retrieved = false;
  const items: EbayActiveListing[] = [];
  // eBay validates SKUs when serving the offer list, so ONE existing offer
  // with an invalid SKU (spaces, slashes, >50 chars — e.g. created by
  // another tool before this app) makes the whole bulk list call fail
  // with 400 "invalid value for a SKU". When that happens, fall back to
  // probing one offer at a time: the poisoned offer's page fails alone
  // and the good offers still sync.
  let probing = false;
  for (let guard = 0; guard < (probing ? 200 : 20) && items.length < capped; guard++) {
    const pageSize = probing ? 1 : capped;
    let page: { total: number; offers: OfferRecord[] };
    try {
      page = await client.json<{ total: number; offers: OfferRecord[] }>(
        `/sell/inventory/v1/offer?limit=${pageSize}&offset=${cursor}`,
      );
    } catch (e) {
      if (isSkuListError(e) && !probing) {
        // Retry the same cursor one offer at a time so no offer is lost.
        probing = true;
        continue;
      }
      if (isSkuListError(e) && probing) {
        // This single offer is the poisoned one — skip it and move on.
        skipped += 1;
        cursor += 1;
        continue;
      }
      throw e;
    }
    total = page.total || 0;
    retrieved = true;
    const offers = page.offers || [];
    if (!offers.length) break;
    for (const offer of offers) {
      if (items.length >= capped) break;
      // Advance only for source offers actually consumed, never the whole page.
      cursor += 1;
      if (offer.status && offer.status !== "PUBLISHED") continue;
      // One bad offer (bad SKU, malformed inventory record, …) must not
      // kill the whole sync — skip it, count it, keep going.
      try {
        let item: InventoryRecord | null = null;
        try {
          item = await client.json<InventoryRecord>(
            `/sell/inventory/v1/inventory_item/${encodeURIComponent(sanitizeSku(offer.sku))}`,
          );
        } catch {
          item = null;
        }
        const mapped = mapOfferToActiveListing(offer, item);
        if (mapped) items.push(mapped);
        else skipped += 1;
      } catch (e) {
        skipped += 1;
        console.warn(`[ebay-sync] skipping offer ${offer.offerId ?? "?"} (sku ${offer.sku ?? "?"}): ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (cursor >= total) break;
  }
  // In probing mode the bulk call never reported a total, so report the
  // number of offers actually encountered instead of a stale 0.
  if (probing) total = items.length + skipped;
  return { total, items, nextOffset: cursor, skipped, retrieved };
}

/**
 * Inventory-item-first sync. The unfiltered offer list
 * (GET /sell/inventory/v1/offer) rejects EVERY page with eBay error 25707
 * ("invalid value for a SKU") for accounts whose offer set contains a SKU
 * eBay will not serialize — the bad SKU is never named, and the failure
 * happens even for a one-item page, so probing cannot isolate it. This
 * route avoids that endpoint for enumeration entirely: it pages the
 * inventory-item list (a different endpoint), then fetches each SKU's
 * offer with the `sku` filter, which returns only that SKU's offers. A
 * bad SKU fails only its own per-SKU fetch and is skipped, never the
 * whole sync. Used as the fallback when the offer list returns no data.
 */
export type EndedOffer = {
  offerId: string;
  sku: string;
  title: string;
  price: number;
  currency: string;
  /** The eBay category the offer was listed under — carried into the
   * relist draft so it does not need to be re-picked. */
  categoryId?: string | null;
  listingId?: string | null;
  imageUrl?: string;
};

/** Join an UNPUBLISHED offer to its inventory item. Unlike
 * mapOfferToActiveListing, an unpublished offer need not carry a listingId
 * (the listing is withdrawn), so this mapping does not require one. */
export function mapOfferToEndedListing(offer: OfferRecord, item?: InventoryRecord | null): EndedOffer | null {
  const price = offer.pricingSummary?.price;
  return {
    offerId: offer.offerId,
    sku: sanitizeSku(offer.sku),
    title: item?.product?.title || offer.sku,
    price: Number(price?.value || 0),
    currency: price?.currency || "USD",
    categoryId: typeof offer.categoryId === "string" ? offer.categoryId : null,
    listingId: offer.listing?.listingId || null,
    imageUrl: item?.product?.imageUrls?.[0],
  };
}

async function fetchOffersViaInventory<T>(
  accessToken: string,
  maxItems: number,
  // eBay's Offer status is ONLY "PUBLISHED" or "UNPUBLISHED" (Inventory API
  // spec) — there is no "ENDED" value. Withdrawing an offer moves it to
  // UNPUBLISHED, and the API cannot distinguish a withdrawn listing from
  // one that was never published, so the Ended view is "ended / not live"
  // and lists both. Filtering on "ENDED" matched nothing, ever.
  wantedStatus: "PUBLISHED" | "UNPUBLISHED",
  map: (offer: OfferRecord, item: InventoryRecord) => T | null,
): Promise<{ total: number; items: T[]; skipped: number }> {
  const client = new EbayRestClient(accessToken);
  const items: T[] = [];
  let skipped = 0;
  let seen = 0;
  for (let offset = 0; offset < maxItems; offset += 100) {
    const page = await client.json<{ total: number; inventoryItems: InventoryRecord[] }>(
      `/sell/inventory/v1/inventory_item?limit=100&offset=${offset}`,
    );
    const records = page.inventoryItems || [];
    if (!records.length) break;
    seen += records.length;
    for (const record of records) {
      const sku = record.sku;
      if (!sku) {
        skipped += 1;
        continue;
      }
      try {
        const offers = await client.json<{ total: number; offers: OfferRecord[] }>(
          `/sell/inventory/v1/offer?sku=${encodeURIComponent(sku)}&limit=100&offset=0`,
        );
        const matching = (offers.offers || []).filter((o) => o.status === wantedStatus);
        if (!matching.length) {
          skipped += 1;
          continue;
        }
        for (const offer of matching) {
          const mapped = map(offer, record);
          if (mapped) items.push(mapped);
          else skipped += 1;
        }
      } catch (e) {
        // One bad SKU (or a missing offer) must not kill the sync.
        skipped += 1;
        console.warn(`[ebay-sync] skipping inventory item ${sku}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (offset + records.length >= (page.total || 0)) break;
  }
  return { total: seen, items, skipped };
}

export async function fetchPublishedOffersViaInventory(
  accessToken: string,
  maxItems = 1000,
): Promise<{ total: number; items: EbayActiveListing[]; skipped: number }> {
  return fetchOffersViaInventory(accessToken, maxItems, "PUBLISHED", mapOfferToActiveListing);
}

/**
 * Ended offers, enumerated the same inventory-first way (the unfiltered
 * offer list rejects every page for this account — see above). Used only
 * by the Listings "Ended" view for relisting as drafts; never by the
 * main sync, whose behaviour is unchanged. Matches UNPUBLISHED offers:
 * withdrawn listings land there, and so do offers that were never
 * published — eBay does not distinguish the two.
 */
export async function fetchEndedOffersViaInventory(
  accessToken: string,
  maxItems = 1000,
): Promise<{ total: number; items: EndedOffer[]; skipped: number }> {
  return fetchOffersViaInventory(accessToken, maxItems, "UNPUBLISHED", mapOfferToEndedListing);
}

export async function fetchActiveEbayListings(
  accessToken: string,
  pageNumber = 1,
  entriesPerPage = 100,
): Promise<{ total: number; items: EbayActiveListing[] }> {
  const { total, items } = await fetchPublishedOffersPage(
    accessToken,
    Math.max(0, (pageNumber - 1) * Math.max(1, Math.min(entriesPerPage, 100))),
    entriesPerPage,
  );
  return { total, items };
}

export async function reviseEbayListingText(
  accessToken: string,
  itemId: string,
  title: string,
  description?: string,
  sku?: string,
): Promise<{ itemId: string; title: string }> {
  const safe =
    String(title || "")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80) || "eBay item";
  if (!sku) {
    throw new EbayValidationError(
      "Modern eBay revises by SKU, not listing ID. Re-sync listings first so the SKU is stored, then retry.",
    );
  }
  const client = new EbayRestClient(accessToken);
  let existing: InventoryRecord | null = null;
  try {
    existing = await client.json<InventoryRecord>(
      `/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`,
    );
  } catch (e) {
    // A multi-variant listing has no single inventory item under the base
    // SKU — its title lives on the inventory item GROUP instead. Fall back
    // to revising the group (group key is deterministic from the SKU).
    if (!/404|not found/i.test(e instanceof Error ? e.message : String(e))) throw e;
  }
  if (existing) {
    const body = {
      ...existing,
      product: { ...(existing.product || {}), title: safe, ...(description ? { description } : {}) },
    };
    await client.response(`/sell/inventory/v1/inventory_item/${encodeURIComponent(sku)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
    return { itemId, title: safe };
  }
  const { variantGroupKeyFor } = await import("./inventory.server");
  const groupKey = variantGroupKeyFor(sku, undefined);
  const group = await client.json<any>(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`);
  await client.response(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`, {
    method: "PUT",
    body: JSON.stringify({ ...group, title: safe, ...(description ? { description } : {}) }),
  });
  return { itemId, title: safe };
}

export async function endEbayFixedPriceListing(
  accessToken: string,
  itemId: string,
  _reason: "NotAvailable" | "Incorrect" | "LostOrBroken" | "OtherListingError" = "NotAvailable",
  offerId?: string,
): Promise<{ itemId: string; ended: boolean }> {
  if (!offerId) {
    throw new EbayValidationError(
      "Modern eBay ends a listing by withdrawing its offer. Re-sync listings first so the offer ID is stored, then retry.",
    );
  }
  const client = new EbayRestClient(accessToken);
  await client.response(`/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/withdraw`, {
    method: "POST",
  });
  return { itemId, ended: true };
}

/**
 * End a listing the way the Inventory API requires for its shape.
 * Multi-variant listings are one eBay item backed by a variant group:
 * withdrawing a single variant offer would leave the rest live, so the
 * group is withdrawn as a whole (POST offer/withdraw_by_inventory_item_group).
 * Single-variant listings fall back to withdrawing their one offer.
 * `row` is the stored ebay_listings row (sku + cj_product_id re-derive the
 * deterministic group key — see variantGroupKeyFor).
 */
export async function endEbayListingRow(
  accessToken: string,
  row: { ebay_item_id?: string | null; ebay_offer_id?: string | null; sku?: string | null; cj_product_id?: string | null },
): Promise<{ itemId: string; ended: boolean }> {
  const itemId = row.ebay_item_id || "";
  const client = new EbayRestClient(accessToken);
  const { variantGroupKeyFor } = await import("./inventory.server");
  const groupKey = variantGroupKeyFor(row.sku || undefined, row.cj_product_id || undefined);
  let isGroup = false;
  try {
    await client.json(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`);
    isGroup = true;
  } catch {
    isGroup = false;
  }
  if (isGroup) {
    await client.response(`/sell/inventory/v1/offer/withdraw_by_inventory_item_group`, {
      method: "POST",
      body: JSON.stringify({ inventoryItemGroupKey: groupKey, marketplaceId: "EBAY_US" }),
    });
    return { itemId, ended: true };
  }
  return endEbayFixedPriceListing(accessToken, itemId, "NotAvailable", row.ebay_offer_id || undefined);
}
