import { EbayRestClient } from "./rest.server";
import { EbayValidationError } from "./http";
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

export async function fetchPublishedOffersPage(
  accessToken: string,
  offset = 0,
  limit = 100,
): Promise<{ total: number; items: EbayActiveListing[]; nextOffset: number }> {
  const client = new EbayRestClient(accessToken);
  const capped = Math.max(1, Math.min(limit, 100));
  // A page of offers can mix published and unpublished offers, so keep
  // paging through offers until this page is full of published listings
  // or offers are exhausted — otherwise sync would stop early.
  let cursor = Math.max(0, offset);
  let total = 0;
  const items: EbayActiveListing[] = [];
  for (let guard = 0; guard < 20 && items.length < capped; guard++) {
    const page = await client.json<{ total: number; offers: OfferRecord[] }>(
      `/sell/inventory/v1/offer?limit=${capped}&offset=${cursor}`,
    );
    total = page.total || 0;
    const offers = page.offers || [];
    if (!offers.length) break;
    for (const offer of offers) {
      if (items.length >= capped) break;
      // Advance only for source offers actually consumed, never the whole page.
      cursor += 1;
      if (offer.status && offer.status !== "PUBLISHED") continue;
      let item: InventoryRecord | null = null;
      try {
        item = await client.json<InventoryRecord>(
          `/sell/inventory/v1/inventory_item/${encodeURIComponent(offer.sku)}`,
        );
      } catch {
        item = null;
      }
      const mapped = mapOfferToActiveListing(offer, item);
      if (mapped) items.push(mapped);
    }
    if (cursor >= total) break;
  }
  return { total, items, nextOffset: cursor };
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
