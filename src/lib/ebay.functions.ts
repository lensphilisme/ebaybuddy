import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ebayConsentUrl, exchangeEbayCode, fetchActiveEbayListings, getCategorySuggestions, getFreshEbayToken, publishInventoryItem } from "./ebay.server";

export const getEbayConnectUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => ebayConsentUrl(context.userId));

export const connectEbayWithCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => data)
  .handler(async ({ data, context }: any) => {
    const creds = await exchangeEbayCode(decodeURIComponent(data.code.trim()));
    await context.supabase.from("integration_credentials").upsert({
      user_id: context.userId,
      provider: "ebay",
      label: "default",
      environment: "production",
      is_active: true,
      last_validated_at: new Date().toISOString(),
      credentials: creds,
    }, { onConflict: "user_id,provider,label" });
    return { ok: true };
  });

export const syncEbayListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pageNumber?: number; entriesPerPage?: number }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const result = await fetchActiveEbayListings(token, data.pageNumber ?? 1, data.entriesPerPage ?? 100);
    for (const item of result.items) {
      const row = {
        user_id: context.userId,
        ebay_item_id: item.itemId,
        ebay_offer_id: null,
        sku: item.sku,
        title: item.title,
        price: item.price,
        currency: item.currency,
        marketplace_id: "EBAY_US",
        status: "active",
        sales: item.quantitySold,
        views: item.watchCount,
      };
      const { data: existing } = await context.supabase.from("ebay_listings").select("id").eq("user_id", context.userId).eq("ebay_item_id", item.itemId).maybeSingle();
      if (existing?.id) await context.supabase.from("ebay_listings").update(row).eq("id", existing.id);
      else await context.supabase.from("ebay_listings").insert(row);
    }
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ebay", message: `Synced ${result.items.length} active eBay listings`, metadata: { total: result.total } });
    return result;
  });

export const suggestEbayCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { q: string; marketplaceId?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    return getCategorySuggestions(token, data.q, data.marketplaceId ?? "EBAY_US");
  });

export const pushDraftsToEbay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftIds: string[] }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const { data: drafts, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).in("id", data.draftIds);
    if (error) throw error;
    const results = [];
    for (const draft of drafts || []) {
      try {
        if (!draft.category_id) throw new Error("Missing eBay category");
        const pushed = await publishInventoryItem(token, draft);
        await context.supabase.from("listing_drafts").update({ status: "pushed", ebay_listing_id: null }).eq("id", draft.id);
        await context.supabase.from("ebay_listings").insert({ user_id: context.userId, draft_id: draft.id, ebay_item_id: pushed.listingId, ebay_offer_id: pushed.offerId, sku: draft.sku, title: draft.title, price: draft.price, cj_product_id: draft.cj_product_id, cj_landed_cost: Number((draft.profit || {}).item_cost || 0) + Number((draft.profit || {}).shipping || 0) });
        results.push({ draftId: draft.id, ok: true, ...pushed });
      } catch (e) {
        await context.supabase.from("listing_drafts").update({ status: "failed", audit_reason: e instanceof Error ? e.message : String(e) }).eq("id", draft.id);
        results.push({ draftId: draft.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return results;
  });