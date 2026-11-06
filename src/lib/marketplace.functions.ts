// Facebook Marketplace — PREPARE / QUEUE ONLY.
//
// The Vercel app cannot post to Marketplace: Facebook's Marketplace
// posting API is not open to third-party apps, and the supported posting
// path in this environment is the facebook-cli on the agent's VM (which
// shows the user an approval card per listing). So these functions only
// PREPARE listings and queue them as 'ready' rows in
// public.marketplace_listings. The agent posts them via
// `facebook-cli marketplace listing create` and marks them 'posted'
// afterwards. Nothing here publishes, buys, or deletes anything on
// Facebook. Deleting a POSTED row is refused — posted listings are
// deleted on Facebook, not here.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { buildMarketplaceRow, extractFbListingId } from "./marketplace-build";

function logPrepared(ctx: any, row: any, extra: Record<string, unknown>) {
  return ctx.supabase.from("activity_logs").insert({
    user_id: ctx.userId,
    level: "info",
    category: "marketplace",
    message: `Prepared for Facebook Marketplace: ${row.title}`,
    metadata: { marketplaceListingId: row.id, fbCategory: row.fb_category, ...extra },
  });
}

/**
 * Prepare a Marketplace-ready listing from a draft OR a CJ product.
 * From a draft: reuses the draft's stored title/price/description/photos
 * verbatim — the price is the corrected final sell price (fee on the
 * final sell price), identical to the eBay draft price. From a CJ
 * product: builds the draft row first with the same builder + pricing as
 * the eBay draft path (cheapest CJ freight quote for the primary variant),
 * then prepares from it. Inserts a 'ready' row; never publishes.
 */
export const prepareMarketplaceListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftId?: string; cjProductId?: string; locationLabel?: string }) => data)
  .handler(async ({ data, context }: any) => {
    if (!data.draftId && !data.cjProductId) throw new Error("Pick a draft or a CJ product to prepare.");
    if (data.draftId && data.cjProductId) throw new Error("Pick one source — a draft or a CJ product, not both.");

    if (data.draftId) {
      const { data: draft, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).eq("id", data.draftId).single();
      if (error || !draft) throw new Error("Draft not found.");
      const row = buildMarketplaceRow({ draft, locationLabel: data.locationLabel, userId: context.userId });
      const { data: inserted, error: insertError } = await context.supabase.from("marketplace_listings").insert(row).select("*").single();
      if (insertError) throw insertError;
      await logPrepared(context, inserted, { draftId: draft.id });
      return inserted;
    }

    // From a CJ product: same builder + pricing as the eBay draft path
    // (see relistEndedListing in ebay.functions.ts for the pattern).
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    const { cjProductDetail, getUserCjToken, cjFreightCalculate, cjOriginForVariant } = await import("./cj.server");
    const { buildCjDraftRow } = await import("./draft-from-cj");
    const cjToken = await getUserCjToken(context.supabase, context.userId);
    if (!cjToken) throw new Error("Add your CJ API key in Settings first.");
    const detail: any = await cjProductDetail(data.cjProductId, "US", cjToken);
    if (!detail) throw new Error("CJ product not found.");
    const primaryVariant = detail?.variants?.[0] || detail?.variantList?.[0] || detail?.productVariants?.[0] || null;
    const itemCost = Number(primaryVariant?.variantSellPrice ?? detail?.sellPrice) || 0;
    // Cheapest CJ freight for the primary variant (0 when CJ has no quote
    // — the prepared price then uses $0 shipping, same as an unquoted
    // draft; the toast shows the prepared price so the user can see it).
    // The quote starts from the warehouse country holding this variant —
    // a US-warehouse product quoted from CN returns an empty list.
    let shipping = 0;
    let carrier: { logisticName?: string; logisticAging?: string } | null = null;
    try {
      const options = await cjFreightCalculate({ startCountryCode: await cjOriginForVariant(data.cjProductId, primaryVariant?.vid, "US", cjToken), endCountryCode: "US", products: [{ vid: primaryVariant?.vid || "", quantity: 1 }] }, cjToken);
      const cheapest = (options || []).reduce((best: any, o: any) => (!best || Number(o.logisticPrice) < Number(best.logisticPrice) ? o : best), null);
      if (cheapest) {
        shipping = Number(cheapest.logisticPrice) || 0;
        carrier = { logisticName: cheapest.logisticName, logisticAging: cheapest.logisticAging };
      }
    } catch {
      shipping = 0;
    }
    const draftRow = buildCjDraftRow({ userId: context.userId, detail, itemCost, shipping, carrier, rules: rule || null, endCountry: "US", primaryVariant });
    const row = buildMarketplaceRow({
      draft: { ...draftRow, id: null, cj_product_id: String(detail.pid) },
      categoryName: detail.categoryName || detail.category || null,
      locationLabel: data.locationLabel,
      userId: context.userId,
    });
    const { data: inserted, error: insertError } = await context.supabase.from("marketplace_listings").insert(row).select("*").single();
    if (insertError) throw insertError;
    await logPrepared(context, inserted, { cjProductId: String(detail.pid) });
    return inserted;
  });

/** All prepared Marketplace listings for the user, newest first. */
export const listMarketplaceListings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data, error } = await context.supabase.from("marketplace_listings").select("*").eq("user_id", context.userId).order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  });

/**
 * Delete a prepared listing. Only 'ready' or 'draft' rows can be deleted
 * here — a 'posted' listing lives on Facebook and must be deleted there
 * (the agent's `facebook-cli marketplace listing delete`).
 */
export const deleteMarketplaceListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: row, error } = await context.supabase.from("marketplace_listings").select("id,status,title").eq("user_id", context.userId).eq("id", data.id).single();
    if (error || !row) throw new Error("Marketplace listing not found.");
    if (row.status === "posted") throw new Error("This listing is already posted on Facebook — delete it on Facebook, not here.");
    const { error: delError } = await context.supabase.from("marketplace_listings").delete().eq("user_id", context.userId).eq("id", data.id);
    if (delError) throw delError;
    return { ok: true };
  });

/**
 * Record a successful post. The agent calls this after
 * `facebook-cli marketplace listing create` returns a listing (the
 * Facebook URL is optional — the row can be marked posted first and the
 * link attached later). Only flips this app's queue row; it does not
 * touch Facebook.
 */
export const markMarketplaceListingPosted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; fbListingUrl?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: row, error } = await context.supabase.from("marketplace_listings").select("id,status").eq("user_id", context.userId).eq("id", data.id).single();
    if (error || !row) throw new Error("Marketplace listing not found.");
    if (row.status === "posted") return { ok: true, alreadyPosted: true };
    const { data: updated, error: updError } = await context.supabase
      .from("marketplace_listings")
      .update({
        status: "posted",
        fb_listing_url: data.fbListingUrl || null,
        fb_listing_id: data.fbListingUrl ? extractFbListingId(data.fbListingUrl) : null,
      })
      .eq("user_id", context.userId)
      .eq("id", data.id)
      .select("*")
      .single();
    if (updError) throw updError;
    await context.supabase.from("activity_logs").insert({
      user_id: context.userId,
      level: "success",
      category: "marketplace",
      message: `Posted to Facebook Marketplace: ${updated.title}`,
      metadata: { marketplaceListingId: updated.id, fbListingUrl: updated.fb_listing_url },
    });
    return updated;
  });
