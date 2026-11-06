/**
 * Build a Marketplace-ready row from a draft (or from a draft row built
 * from a CJ product). Pure — no Supabase, no network — so it is unit
 * tested directly.
 *
 * Price reuse is the point: the row carries the draft's stored price
 * verbatim, and the draft's price is the corrected final sell price from
 * src/lib/pricing.ts (fee on the FINAL sell price, not the pre-fee
 * subtotal). The Marketplace price and the eBay price are the same number.
 *
 * Description is plain text: CJ descriptions are HTML with embedded
 * <img> tags and a dangling "Product Image:" label, none of which belongs
 * in a Marketplace description. Photos are the draft's cleaned image
 * URLs (max 10 — the facebook-cli takes --photo paths the agent
 * downloads from these URLs when posting).
 */
import { cleanDescription, cleanImageList } from "./draft-from-cj";
import { mapMarketplaceCategory } from "./marketplace-category";
import { resolveMarketplaceLocation } from "./marketplace-location";
import { roundMoney } from "./pricing";

export function marketplaceDescription(html: unknown, maxLen = 1500): string {
  const text = cleanDescription(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen).trim()}…` : text;
}

/** The fields buildMarketplaceRow reads — a listing_drafts row, or a row
 * freshly built by buildCjDraftRow (which has no id yet). */
export type MarketplaceDraftLike = {
  id?: string | null;
  cj_product_id?: string | null;
  title?: string | null;
  price?: number | null;
  description?: string | null;
  images?: unknown;
  // The draft's profit block carries the eBay category path (and, for a
  // freshly built draft row, the full pricing breakdown) — the index
  // signature keeps both shapes assignable.
  profit?: { category_path?: string | null; [key: string]: unknown } | null;
  category_id?: string | null;
};

export function buildMarketplaceRow(input: {
  draft: MarketplaceDraftLike;
  /** eBay category path or CJ category name — extra keywords for the
   * category mapper. Defaults to the draft's stored category path. */
  categoryName?: string | null;
  locationLabel?: string | null;
  userId: string;
}) {
  const { draft, userId } = input;
  const title = String(draft.title || "Marketplace item").trim().slice(0, 140);
  // The draft price IS the final sell price (corrected pricing model) —
  // reuse it exactly, never re-price.
  const price = roundMoney(Number(draft.price || 0));
  const description = marketplaceDescription(draft.description);
  const photos = cleanImageList(draft.images).slice(0, 10);
  const categoryName = input.categoryName ?? draft.profit?.category_path ?? "";
  const fbCategory = mapMarketplaceCategory({ title, categoryName, description });
  const location = resolveMarketplaceLocation(input.locationLabel);
  return {
    user_id: userId,
    source_draft_id: draft.id ?? null,
    cj_product_id: draft.cj_product_id ?? null,
    title,
    price,
    description,
    photos,
    fb_category: fbCategory,
    condition: "new",
    latitude: location.latitude,
    longitude: location.longitude,
    location_label: location.label,
    status: "ready",
    fb_listing_id: null,
    fb_listing_url: null,
  };
}

/** Pull the listing id out of a facebook.com/marketplace/item/<id> URL
 * (for markMarketplaceListingPosted). Anything else returns null. */
export function extractFbListingId(url: unknown): string | null {
  const match = String(url || "").match(/facebook\.com\/marketplace\/item\/(\d+)/i);
  return match ? match[1] : null;
}
