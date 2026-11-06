import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ebayConsentUrl, exchangeEbayCode, fetchPublishedOffersPage, fetchPublishedOffersViaInventory, fetchEndedOffersViaInventory, getCategorySuggestions, getFreshEbayToken, publishInventoryItem, reviseEbayListingText, reviseOfferPrice, endEbayListingRow } from "./ebay.server";
import { EbayRestClient } from "./ebay/rest.server";
import { EbayOrderService, EbayReturnService } from "./ebay/orders.server";
import { EbayNotificationService } from "./ebay/notifications.server";
import { EbayMarketingService, campaignInput } from "./ebay/marketing.server";
import { requireLiveOptimizer, requireListingIdentity, hasFreshTraffic, priceDropFor, cjStockIsZero } from "./ebay/optimizer-policy";
import { callAiJson, callAiText } from "./ai-provider.server";
import { roundMoney } from "./pricing";
import { insertSyncStart, finalizeSyncActivity } from "./ebay/sync-activity";

function cleanTitle(value: unknown) {
  return String(value ?? "")
    .replace(/\bban\s+the\s+sale\s+of\s+amazon\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:])/g, "$1")
    .trim()
    .slice(0, 80);
}

function fallbackRewrite(title: string) {
  const cleaned = cleanTitle(title);
  const parts = cleaned.split(/[|,]/).map((p) => p.trim()).filter(Boolean);
  return (parts[0] || cleaned || title).slice(0, 80);
}

function compactText(value: unknown, fallback = "") {
  const text = String(value ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  if (text) return text;
  return String(fallback ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function cleanImages(...inputs: unknown[]) {
  const out: string[] = [];
  const walk = (input: unknown) => {
    if (!input) return;
    if (Array.isArray(input)) return input.forEach(walk);
    const text = String(input).trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    if (!text) return;
    if ((text.startsWith("[") && text.endsWith("]")) || (text.startsWith('"') && text.endsWith('"'))) {
      try { return walk(JSON.parse(text)); } catch { /* keep scanning */ }
    }
    for (const match of text.match(/https?:\/\/[^\s"'\\\])>,]+/gi) || []) {
      try { const url = new URL(match); if (url.hostname.includes(".")) out.push(url.toString()); } catch { /* skip */ }
    }
  };
  inputs.forEach(walk);
  return Array.from(new Set(out)).slice(0, 12);
}

function compactCountry(value: unknown, fallback = "CN") {
  return (compactText(value, fallback).toUpperCase().match(/[A-Z]{2}/)?.[0] || fallback).slice(0, 2);
}

async function resolveCjWarehouse(context: any, startCountry: string) {
  try {
    const { cjGetWarehouses, getUserCjToken } = await import("./cj.server");
    const token = await getUserCjToken(context.supabase, context.userId);
    const warehouses = await cjGetWarehouses(token);
    const country = compactCountry(startCountry);
    return warehouses.find((w: any) => compactCountry(w.countryCode || w.country) === country && !w.disabled)
      || warehouses.find((w: any) => compactCountry(w.countryCode || w.country) === country)
      || null;
  } catch {
    return null;
  }
}

function inferType(title: string, detail: any, draft: any) {
  const direct = compactText(draft?.item_specifics?.Type || detail?.categoryName || detail?.productCategoryName || detail?.productType);
  if (direct) return direct.slice(0, 65);
  return compactText(title).split(/\s+/).filter((w) => w.length > 2).slice(0, 4).join(" ").slice(0, 65) || "General Product";
}

function repairVariants(detail: any, draft: any, images: string[]) {
  const variants = detail?.variants || detail?.variantList || detail?.productVariants || draft?.profit?.variant_group?.variants || [];
  if (!Array.isArray(variants) || variants.length <= 1) return null;
  const productKey = compactText(detail?.productKeyEn || draft?.profit?.product_key);
  const axes = productKey ? productKey.split(/[-,/|>]+/).map((v) => compactText(v)).filter(Boolean) : [];
  const safeAxes = axes.length ? axes.map((a, i) => (/^type$/i.test(a) ? (i === 0 ? "Style" : `Option ${i + 1}`) : a)) : undefined;
  return {
    variants: variants.map((v: any, i: number) => ({
      vid: v.vid,
      variantSku: v.variantSku || v.sku || v.vid || `${draft.sku}-${i + 1}`,
      variantKey: compactText(v.variantKey || v.variantNameEn || v.variantSku || v.vid || `Option ${i + 1}`),
      variantNameEn: v.variantNameEn,
      variantImage: cleanImages(v.variantImage, v.image, images)[0] || images[0] || null,
      variantSellPrice: roundMoney(Number(v.variantSellPrice ?? v.price ?? draft.price ?? 0)),
      price: roundMoney(Number(v.price ?? v.variantSellPrice ?? draft.price ?? 0)),
      inventory: Number(v.inventory || v.quantity || draft.quantity || 1),
    })),
    axes: safeAxes,
    productKey,
  };
}

async function autoRepairDraftFromCj(context: any, draft: any, reason: string) {
  const { cjProductDetail, getUserCjToken } = await import("./cj.server");
  const token = await getUserCjToken(context.supabase, context.userId);
  const detail: any = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", token);
  const startCountry = compactCountry(draft.profit?.start_country || detail?.countryCode || detail?.countryFrom || detail?.sourceFrom, "CN");
  const warehouse = await resolveCjWarehouse(context, startCountry);
  const title = compactText(detail?.productNameEn, draft.title).slice(0, 80) || draft.title;
  const description = compactText(detail?.description, draft.description || `${title}. New item. Review photos and selected option before checkout.`);
  const images = cleanImages(draft.images, detail?.productImageSet, detail?.productImages, detail?.bigImage, detail?.productImage);
  const variants = repairVariants(detail, draft, images);
  const itemSpecifics = {
    ...(draft.item_specifics || {}),
    Brand: compactText(draft.brand || draft.item_specifics?.Brand || detail?.brand, "Unbranded"),
    Type: compactText(draft.item_specifics?.Type, inferType(title, detail, draft)),
    Model: compactText(draft.model || draft.item_specifics?.Model, "Does Not Apply"),
    MPN: compactText(draft.item_specifics?.MPN, "Does Not Apply"),
  };
  const repaired = {
    ...draft,
    title,
    description,
    images,
    item_specifics: itemSpecifics,
    brand: itemSpecifics.Brand,
    model: itemSpecifics.Model,
    status: "pending" as const,
    audit_reason: `Auto-repaired CJ data after eBay error: ${reason.slice(0, 180)}`,
    profit: {
      ...(draft.profit || {}),
      start_country: startCountry,
      cj_warehouse: warehouse || draft.profit?.cj_warehouse || null,
      product_key: variants?.productKey || draft.profit?.product_key || null,
      variant_axes: variants?.axes || draft.profit?.variant_axes || null,
      variant_group: variants ? { variants: variants.variants } : draft.profit?.variant_group || null,
      cj_repair_cached_at: new Date().toISOString(),
    },
  };
  await context.supabase.from("listing_drafts").update({
    title: repaired.title,
    description: repaired.description,
    images: repaired.images,
    item_specifics: repaired.item_specifics,
    brand: repaired.brand,
    model: repaired.model,
    status: repaired.status,
    audit_reason: repaired.audit_reason,
    profit: repaired.profit,
  }).eq("id", draft.id);
  await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "ebay", message: `Auto-repaired draft from CJ: ${title}`, metadata: { draftId: draft.id, reason, variants: variants?.variants?.length || 0 } });
  return repaired;
}

function shouldAutoRepair(message: string) {
  return /variation|specific|type\s+is\s+missing|invalid data|imageUrl|country|location|mpn|gtin|upc/i.test(message);
}

export const getEbayConnectUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => ebayConsentUrl(context.userId));

export const connectEbayWithCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string; state?: string }) => data)
  .handler(async ({ data, context }: any) => {
    // CSRF check: the callback's `state` is the user id that started the
    // OAuth flow. When the caller passes it, it must match the signed-in
    // user or the code is rejected. (The manual paste path in Settings
    // passes no state — the user is already signed in and pastes their
    // own code, so there is nothing to compare.)
    if (data.state && data.state !== context.userId) {
      throw new Error("eBay sign-in was started for a different account. Start the connection again from Settings.");
    }
    const creds = await exchangeEbayCode(decodeURIComponent(data.code.trim()));
    const row = {
      user_id: context.userId,
      provider: "ebay",
      label: "default",
      environment: "production",
      is_active: true,
      last_validated_at: new Date().toISOString(),
      credentials: creds,
    };
    const { data: existing } = await context.supabase.from("integration_credentials").select("id").eq("user_id", context.userId).eq("provider", "ebay").eq("label", "default").maybeSingle();
    if (existing?.id) await context.supabase.from("integration_credentials").update(row).eq("id", existing.id);
    else await context.supabase.from("integration_credentials").insert(row);
    return { ok: true };
  });

/**
 * Disconnect eBay (audit #51): removes the saved seller token so eBay
 * calls stop. Listings and drafts already in the app are NOT deleted, and
 * nothing is ended on eBay. Confirmation happens in the Settings UI.
 */
export const disconnectEbay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { error } = await context.supabase.from("integration_credentials").delete().eq("user_id", context.userId).eq("provider", "ebay").eq("label", "default");
    if (error) throw new Error("Could not disconnect eBay. Please retry.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "ebay", message: "eBay disconnected in Settings" });
    return { ok: true };
  });

export const syncEbayListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { entriesPerPage?: number }) => data)
  .handler(async ({ data, context }: any) => {
    // The sync takes ~4 minutes. Write a "started" row FIRST: if the user
    // reloads mid-sync and the function is killed before the final row,
    // the sync still leaves a trace instead of vanishing (sync #1 left no
    // row at all). The inner function updates this row with the outcome.
    const startRowId = await insertSyncStart(context.supabase, context.userId);
    // Sync failures used to vanish: the success row was the only one ever
    // written, so a failed sync appeared in the Dashboard and then
    // disappeared. Persist failures as error rows too (bug 7).
    try {
      return await syncEbayListingsInner(data, context, startRowId);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await finalizeSyncActivity(context.supabase, context.userId, startRowId, { level: "error", message: `eBay sync failed: ${message}`, metadata: { error: message } });
      throw e;
    }
  });

async function syncEbayListingsInner(data: { entriesPerPage?: number }, context: any, startRowId?: string | null) {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    // Modern Inventory API: 100 offers per page. The Inventory API does not
    // expose quantitySold / watchCount, so sales/views are refreshed from
    // the Analytics traffic report below — never guessed, never overwritten
    // with zeros. Only price/title/stock refresh from the offers themselves.
    const perPage = Math.min(data.entriesPerPage ?? 100, 100);
    let offset = 0;
    let totalSynced = 0;
    let totalSkipped = 0;
    let grandTotal = 0;
    let retrievedAnyOfferData = false;
    const syncedItemIds: string[] = [];
    const upsertItem = async (item: any) => {
      const row = {
        user_id: context.userId,
        ebay_item_id: item.itemId,
        ebay_offer_id: item.offerId,
        sku: item.sku,
        title: item.title,
        price: item.price,
        currency: item.currency,
        marketplace_id: "EBAY_US",
        image_url: item.imageUrl || undefined,
        status: "active",
        listed_at: item.listedAt || undefined,
      };
      const { data: existingRows } = await context.supabase.from("ebay_listings").select("id").eq("user_id", context.userId).eq("ebay_item_id", item.itemId).limit(10);
      const existing = existingRows?.[0];
      if (existing?.id) {
        await context.supabase.from("ebay_listings").update(row).eq("id", existing.id);
        const duplicateIds = (existingRows || []).slice(1).map((r: any) => r.id);
        if (duplicateIds.length) await context.supabase.from("ebay_listings").delete().in("id", duplicateIds);
      }
      else await context.supabase.from("ebay_listings").insert(row);
      if (item.itemId) syncedItemIds.push(item.itemId);
    };
    while (true) {
      const result = await fetchPublishedOffersPage(token, offset, perPage);
      grandTotal = result.total;
      offset = result.nextOffset;
      totalSkipped += result.skipped || 0;
      if (result.retrieved) retrievedAnyOfferData = true;
      for (const item of result.items) await upsertItem(item);
      totalSynced += result.items.length;
      if (offset >= grandTotal) break;
      if (offset > 10000) break; // safety cap
    }
    // Fallback: eBay rejects EVERY page of the unfiltered offer list with
    // error 25707 for this account (a SKU somewhere in the offer set that
    // eBay will not serialize — never named, fails even for a one-item
    // page). When the offer list returned no data at all, enumerate
    // inventory items first and fetch each SKU's offer instead; a bad SKU
    // then fails only its own lookup.
    let usedInventoryFallback = false;
    let inventoryFallbackError: string | null = null;
    if (totalSynced === 0 && !retrievedAnyOfferData) {
      try {
        const viaInventory = await fetchPublishedOffersViaInventory(token);
        usedInventoryFallback = true;
        // The inventory phase re-examines the same underlying offers the
        // probing phase could not retrieve, so its counts supersede the
        // probing phase's — carrying both over double-counts (e.g. "653
        // skipped" against "454 total").
        grandTotal = viaInventory.total;
        totalSkipped = viaInventory.skipped;
        for (const item of viaInventory.items) await upsertItem(item);
        totalSynced += viaInventory.items.length;
      } catch (e) {
        inventoryFallbackError = e instanceof Error ? e.message : String(e);
        console.error("[ebay-sync] inventory-first fallback failed:", inventoryFallbackError);
      }
    }
    // Real traffic (views/clicks/sales, last 30 days) from the Analytics API.
    // Best-effort: a traffic failure must never fail the sync itself — the
    // optimizer simply keeps reporting metrics_unavailable until it works.
    let traffic: { updated: number; total: number; error?: string } = { updated: 0, total: 0 };
    try {
      const { refreshListingTraffic } = await import("./ebay/analytics.server");
      traffic = await refreshListingTraffic(context.supabase, context.userId, token, syncedItemIds);
    } catch (e) {
      traffic = { updated: 0, total: syncedItemIds.length, error: e instanceof Error ? e.message : String(e) };
    }
    // Sync 0-result (audit #1/#3/#54): 0 imported is NOT a success — the
    // user has no active listings, or the route itself failed. Log it at
    // level "warn" and name the reason, so the toast reads as a warning.
    const level = totalSynced === 0 ? "warn" : "success";
    const reason = totalSynced === 0
      ? (inventoryFallbackError
        ? `Sync finished — 0 listings imported. eBay error: ${inventoryFallbackError}`
        : `Sync finished — 0 listings imported. 0 published offers found — the account has no active listings${grandTotal ? ` (${grandTotal} inventory items, none published)` : ""}`)
      : null;
    const message = reason
      ?? `Synced ${totalSynced} published eBay listings (${grandTotal} offers total, including unpublished)${totalSkipped ? `, ${totalSkipped} skipped (bad data)` : ""}${usedInventoryFallback ? " · via inventory list (offer list rejected by eBay)" : ""}`;
    // One row per sync: update the "started" row written when the sync
    // began (falls back to a fresh insert when there is no start row).
    await finalizeSyncActivity(context.supabase, context.userId, startRowId, { level, message, metadata: { total: grandTotal, synced: totalSynced, skipped: totalSkipped, trafficUpdated: traffic.updated, trafficError: traffic.error || null, viaInventory: usedInventoryFallback } });
    return { total: grandTotal, synced: totalSynced, skipped: totalSkipped, trafficUpdated: traffic.updated, trafficError: traffic.error || null, level, reason };
  }

// End one listing from the Listings page. Variant listings are ended as a
// group (see endEbayListingRow); single listings withdraw their offer.
export const endEbayListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { listingId: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const { data: row, error } = await context.supabase.from("ebay_listings").select("*").eq("user_id", context.userId).eq("id", data.listingId).maybeSingle();
    if (error || !row) throw new Error("Listing not found.");
    requireListingIdentity(row.ebay_item_id, row.ebay_offer_id);
    await endEbayListingRow(token, row);
    const saved = await context.supabase.from("ebay_listings").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", row.id);
    if (saved.error) throw new Error("eBay ended the listing, but saving failed. Re-sync listings.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "ebay", message: `Ended eBay listing: ${row.title}`, metadata: { listingId: row.ebay_item_id } });
    return { ok: true };
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
    // Server-side guardrail (bug 4): with "Live Push to eBay" OFF in Rules
    // nothing may publish — a push attempted a real publish while OFF
    // because this check did not exist. Read the row exactly the way the
    // Rules page does and refuse before touching eBay. Select * so the
    // Best Offer settings travel with the row (no second query).
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    if (!rule?.live_listing_enabled) {
      throw new Error("Live push is off in Rules — turn it on to publish.");
    }
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const { data: drafts, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).in("id", data.draftIds);
    if (error) throw error;
    const results = [];
    for (const draft of drafts || []) {
      try {
        if (!draft.category_id) throw new Error("Missing eBay category");
        // Duplicate guard: refuse to push the same CJ product twice.
        if (draft.cj_product_id) {
          const { data: existing } = await context.supabase
            .from("ebay_listings")
            .select("id,ebay_item_id")
            .eq("user_id", context.userId)
            .eq("cj_product_id", draft.cj_product_id)
            .in("status", ["active", "pushed"])
            .limit(1)
            .maybeSingle();
          if (existing?.id) throw new Error(`Already listed on eBay (item ${existing.ebay_item_id || existing.id}). Skipping duplicate.`);
        }
        // Ensure start_country is set from CJ so inventory location is valid.
        let workingDraft = draft;
        let cjDetailForStock: any = null;
        if (!draft.profit?.start_country) {
          try {
            const { cjProductDetail, getUserCjToken } = await import("./cj.server");
            const cjToken = await getUserCjToken(context.supabase, context.userId);
            const detail: any = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", cjToken);
            cjDetailForStock = detail;
            const startCountry = compactCountry(detail?.countryCode || detail?.countryFrom || detail?.sourceFrom, "CN");
            const warehouse = await resolveCjWarehouse(context, startCountry);
            workingDraft = { ...draft, profit: { ...(draft.profit || {}), start_country: startCountry, cj_warehouse: warehouse || draft.profit?.cj_warehouse || null } };
            await context.supabase.from("listing_drafts").update({ profit: workingDraft.profit }).eq("id", draft.id);
          } catch { /* fall back to CN default in publish */ }
        } else if (!draft.profit?.cj_warehouse) {
          const warehouse = await resolveCjWarehouse(context, draft.profit.start_country);
          if (warehouse) {
            workingDraft = { ...draft, profit: { ...(draft.profit || {}), cj_warehouse: warehouse } };
            await context.supabase.from("listing_drafts").update({ profit: workingDraft.profit }).eq("id", draft.id);
          }
        }
        // CJ stock guard (sales feature #4): refuse the push when CJ is
        // definitively out of stock for this product. Reuse the detail
        // fetched above when available; otherwise fetch it once here.
        if (draft.cj_product_id) {
          try {
            if (!cjDetailForStock) {
              const { cjProductDetail, getUserCjToken } = await import("./cj.server");
              cjDetailForStock = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", await getUserCjToken(context.supabase, context.userId));
            }
            if (cjStockIsZero(cjDetailForStock)) throw new Error("Out of stock at CJ — cannot push");
          } catch (e) {
            if (e instanceof Error && /Out of stock at CJ/.test(e.message)) throw e;
            /* CJ lookup failed — do not block the push on an unknown stock state. */
          }
        }
        let pushed: any;
        try {
          pushed = await publishInventoryItem(token, workingDraft, { bestOffer: rule });
        } catch (firstError) {
          const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
          if (!draft.cj_product_id || !shouldAutoRepair(firstMessage)) throw firstError;
          workingDraft = await autoRepairDraftFromCj(context, workingDraft, firstMessage);
          pushed = await publishInventoryItem(token, workingDraft, { bestOffer: rule });
        }
        await context.supabase.from("ebay_listings").insert({ user_id: context.userId, draft_id: draft.id, ebay_item_id: pushed.listingId, ebay_offer_id: pushed.offerId, sku: draft.sku, title: draft.title, price: roundMoney(Number(draft.price ?? 0)), cj_product_id: draft.cj_product_id, status: "active", cj_landed_cost: Number((draft.profit || {}).item_cost || 0) + Number((draft.profit || {}).shipping || 0) });
        // Auto-remove pushed draft from queue.
        await context.supabase.from("listing_drafts").delete().eq("id", draft.id);
        await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ebay", message: `Pushed to eBay: ${draft.title}`, metadata: { draftId: draft.id, listingId: pushed.listingId, offerId: pushed.offerId } });
        results.push({ draftId: draft.id, ok: true, ...pushed });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        await context.supabase.from("listing_drafts").update({ status: "failed", audit_reason: message }).eq("id", draft.id);
        await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "error", category: "ebay", message: `eBay push failed: ${draft.title}`, metadata: { draftId: draft.id, error: message } });
        results.push({ draftId: draft.id, ok: false, error: message });
      }
    }
    return results;
  });
// Category picker. Returns eBay's own category suggestions for a product,
// top candidates first so the user can accept or override. When an AI
// provider is configured in Settings, the AI re-ranks eBay's suggestions
// against the title/description instead of guessing a category itself.
export const aiDeepCategorySuggest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title: string; description?: string; hint?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const normal = await getCategorySuggestions(token, data.title, "EBAY_US").catch(() => []);
    let picks: { categoryId: string; path: string; reason: string }[] = [];
    try {
      const aiOut = await callAiJson(context.supabase, context.userId, {
        system: "You pick the best eBay category as JSON. Reply with ONLY a JSON object: {\"picks\": [{\"categoryId\": \"...\", \"path\": \"...\", \"reason\": \"...\"}, ...]} with up to 3 picks, ordered best first. Pick ONLY from the suggestions given — never invent a categoryId. Prefer the most specific leaf category that fits the product.",
        user: JSON.stringify({ title: data.title, description: data.description || "", hint: data.hint || "", suggestions: normal.slice(0, 10) }),
      });
      const aiPicks = Array.isArray(aiOut?.picks) ? aiOut.picks : [];
      picks = aiPicks
        .map((p: any) => {
          const match = normal.find((c: any) => String(c.categoryId) === String(p.categoryId));
          return match ? { categoryId: match.categoryId, path: match.path, reason: String(p.reason || "AI pick").slice(0, 120) } : null;
        })
        .filter(Boolean) as { categoryId: string; path: string; reason: string }[];
    } catch {
      /* AI is a re-ranker only; eBay's own suggestions are the fallback. */
    }
    if (picks.length === 0) {
      picks = normal.slice(0, 3).map((c: any) => ({ categoryId: c.categoryId, path: c.path, reason: "eBay suggestion" }));
    }
    return picks;
  });

// Optimizer: run rules over active listings. Ends dead listings, rewrites titles
// with local rules when signals warrant. Returns per-listing actions taken.
export const runOptimizerRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dryRun?: boolean; listingIds?: string[] }) => data)
  .handler(async ({ data, context }: any) => {
    const token = data.dryRun ? null : await getFreshEbayToken(context.supabase, context.userId);
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    if (!data.dryRun) requireLiveOptimizer(rule, token);
    const daysNoSales = Number(rule?.optimizer_no_sales_days ?? 30);
    const daysNoViewsRewrite = Number(rule?.optimizer_low_views_days ?? 14);
    const poorExposureDays = Number(rule?.optimizer_poor_exposure_days ?? 14);
    // Traffic refresh is part of a run now (removal F): the standalone
    // "Refresh traffic" button is gone. Dry-runs read the last sync's data.
    if (!data.dryRun && token) {
      try {
        const { refreshListingTraffic } = await import("./ebay/analytics.server");
        await refreshListingTraffic(context.supabase, context.userId, token);
      } catch {
        /* Best-effort — the traffic gate below still applies. */
      }
    }
    let q = context.supabase.from("ebay_listings").select("*").eq("user_id", context.userId).eq("status", "active");
    if (data.listingIds?.length) q = q.in("id", data.listingIds);
    const { data: listings, error } = await q;
    if (error) throw error;
    // Promoted auto-rules (sales feature #3, Rules-gated, default OFF):
    // map each RUNNING campaign's ads to listingIds so the auto-pause rule
    // can attribute views/sales to the campaign. Best-effort — if the ads
    // fetch fails for a campaign it is skipped, never paused blindly.
    const promotedAutoOn = rule?.promoted_auto_enabled === true;
    const promotedMaxRate = Number(rule?.promoted_auto_max_rate_percent ?? 10);
    const campaignAds = new Map<string, { campaignId: string; campaignName: string; startedAt: string | null; listingIds: string[] }>();
    if (promotedAutoOn && !data.dryRun && token) {
      try {
        const svc = new EbayMarketingService(new EbayRestClient(token));
        const page = await svc.campaigns(0);
        for (const c of page.campaigns || []) {
          if (c.campaignStatus !== "RUNNING") continue;
          try {
            const ads = await svc.ads(c.campaignId);
            campaignAds.set(c.campaignId, { campaignId: c.campaignId, campaignName: c.campaignName, startedAt: c.startDate || null, listingIds: (ads.ads || []).map((a: any) => a.listingId).filter(Boolean) });
          } catch {
            /* Skip this campaign — never pause blindly. */
          }
        }
      } catch {
        /* Campaigns unavailable — promoted rules skip this run. */
      }
    }
    const actions: { id: string; title: string; action: string; detail?: string; error?: string }[] = [];
    for (const l of listings || []) {
      const listedAt = l.listed_at ? new Date(l.listed_at) : null;
      const ageDays = listedAt ? Math.floor((Date.now() - listedAt.getTime()) / 86400000) : 0;
      // Traffic comes from the Analytics report written during listing sync
      // (see refreshListingTraffic). Do not take destructive decisions from
      // stale or unavailable measurements.
      if (!hasFreshTraffic(l.last_traffic_check) && !/ban\s+the\s+sale\s+of\s+amazon/i.test(l.title || "")) {
        actions.push({ id: l.id, title: l.title, action: "metrics_unavailable", detail: "No fresh traffic data (last 24h). Sync eBay listings, then run again — no changes applied." });
        continue;
      }
      // CJ stock guard (sales feature #4): flag (dry-run) / end (run) an
      // active listing whose CJ product is definitively out of stock, so
      // it cannot sell and fail to ship. Unknown stock never acts.
      if (l.cj_product_id) {
        let outOfStock = false;
        try {
          const { cjProductDetail, getUserCjToken } = await import("./cj.server");
          const detail = await cjProductDetail(l.cj_product_id, "US", await getUserCjToken(context.supabase, context.userId));
          outOfStock = cjStockIsZero(detail);
        } catch {
          /* CJ lookup failed — do not act on unknown stock. */
        }
        if (outOfStock) {
          const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: data.dryRun ? "cj_out_of_stock" : "ended_out_of_stock", detail: "CJ stock is 0 — end the listing before it sells and cannot ship" };
          actions.push(action);
          if (!data.dryRun) {
            try {
              requireListingIdentity(l.ebay_item_id, l.ebay_offer_id);
              if (!token) throw new Error("Reconnect eBay first.");
              await endEbayListingRow(token, l);
              const saved = await context.supabase.from("ebay_listings").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", l.id);
              if (saved.error) throw new Error("eBay ended the listing, but saving failed. Re-sync listings.");
            } catch (e) {
              action.error = e instanceof Error ? e.message : String(e);
              action.action = "failed";
            }
          }
          continue;
        }
      }
      if (ageDays >= daysNoSales && (l.sales || 0) === 0) {
        // Price-drop ladder (sales feature #5): a 5% cut (floor- and
        // cap-bounded) is tried BEFORE ending — if a drop applies, the
        // listing gets one more chance this run instead of being ended.
        const drop = priceDropFor(l, rule);
        if (drop) {
          const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: data.dryRun ? "price_drop_recommended" : "price_dropped", detail: `Price $${Number(l.price || 0).toFixed(2)} → $${drop.newPrice.toFixed(2)} (floor $${drop.floor.toFixed(2)}, cap $${drop.capPrice.toFixed(2)})` };
          actions.push(action);
          if (!data.dryRun) {
            try {
              requireListingIdentity(l.ebay_item_id, l.ebay_offer_id);
              if (!token) throw new Error("Reconnect eBay first.");
              // Single-variant only: revising only the first variant of a
              // group listing would price it wrong. Same group detection
              // as endEbayListingRow (deterministic group key lookup).
              const { variantGroupKeyFor } = await import("./ebay/inventory.server");
              const groupKey = variantGroupKeyFor(l.sku || undefined, l.cj_product_id || undefined);
              let isGroup = false;
              try {
                await new EbayRestClient(token).json(`/sell/inventory/v1/inventory_item_group/${encodeURIComponent(groupKey)}`);
                isGroup = true;
              } catch {
                isGroup = false;
              }
              if (isGroup) throw new Error("Group (multi-variant) listing — price drops are not applied to variant listings yet.");
              await reviseOfferPrice(token, l.ebay_offer_id, drop.newPrice);
              const saved = await context.supabase.from("ebay_listings").update({ price: drop.newPrice }).eq("id", l.id);
              if (saved.error) throw new Error("eBay repriced the listing, but saving failed. Re-sync listings.");
            } catch (e) {
              action.error = e instanceof Error ? e.message : String(e);
            }
          }
          continue;
        }
        const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: data.dryRun ? "end_recommended" : "ended", detail: `${ageDays}d no sales` };
        actions.push(action);
        if (!data.dryRun) {
          try {
            requireListingIdentity(l.ebay_item_id, l.ebay_offer_id);
            if (!token) throw new Error("Reconnect eBay first.");
            await endEbayListingRow(token, l);
            const saved = await context.supabase.from("ebay_listings").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", l.id);
            if (saved.error) throw new Error("eBay ended the listing, but saving failed. Re-sync listings.");
          } catch (e) {
            action.error = e instanceof Error ? e.message : String(e);
            action.action = "failed";
          }
        }
        continue;
      }
      // Promoted auto-rules (sales feature #3): views but no sales after
      // N days -> auto-create ONE FIXED campaign at the capped rate.
      // Promoted Listings Standard is COST_PER_SALE, so spend only happens
      // on a sale — the trigger is views without a sale, not spend.
      if (promotedAutoOn && ageDays >= daysNoSales && (l.sales || 0) === 0 && (l.views || 0) > 0) {
        const alreadyPromoted = [...campaignAds.values()].some((c) => c.listingIds.includes(l.ebay_item_id));
        if (!alreadyPromoted) {
          const campaignName = `Auto — ${l.title}`.slice(0, 80);
          const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: data.dryRun ? "promote_recommended" : "promoted", detail: `Create Promoted Listings (FIXED ${promotedMaxRate}%) — ${l.views} views, no sales in ${ageDays}d` };
          actions.push(action);
          if (!data.dryRun && token) {
            try {
              campaignInput.parse({ name: campaignName, strategy: "FIXED", rate: promotedMaxRate, listingIds: [l.ebay_item_id] });
              await new EbayMarketingService(new EbayRestClient(token)).create({ name: campaignName, strategy: "FIXED", rate: promotedMaxRate, listingIds: [l.ebay_item_id] });
            } catch (e) {
              action.error = e instanceof Error ? e.message : String(e);
            }
          }
        }
      }
      const needsRewrite = /ban\s+the\s+sale\s+of\s+amazon/i.test(l.title || "") || (l.views || 0) === 0 || (ageDays >= daysNoViewsRewrite && (l.views || 0) < 5) || (ageDays >= poorExposureDays && (l.clicks || 0) === 0);
      if (needsRewrite) {
        let newTitle = fallbackRewrite(l.title);
        try {
          const aiTitle = await callAiText(context.supabase, context.userId, {
            system: "Rewrite this eBay listing title to get more views. Reply with ONLY the new title, nothing else. Max 80 characters, no ALL CAPS, no keyword stuffing, no other marketplace names, no words like 'amazing' or 'best'. Keep the real product words; drop filler.",
            user: l.title,
          });
          if (aiTitle) newTitle = cleanTitle(aiTitle);
        } catch {
          /* AI is optional here; the local rewrite stands. */
        }
                const reason = /ban\s+the\s+sale\s+of\s+amazon/i.test(l.title || "") ? "removed prohibited marketplace text" : `${ageDays}d, ${l.views || 0} views, ${l.clicks || 0} clicks, ${l.sales || 0} sales`;
        const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: "rewrite_title", detail: `${newTitle} · ${reason}` };
        actions.push(action);
        if (!data.dryRun && newTitle && newTitle !== l.title) {
          try {
            requireListingIdentity(l.ebay_item_id, l.ebay_offer_id);
            if (!token) throw new Error("Reconnect eBay first.");
            await reviseEbayListingText(token, l.ebay_item_id, newTitle, undefined, l.sku);
            const saved = await context.supabase.from("ebay_listings").update({ title: newTitle }).eq("id", l.id);
            if (saved.error) throw new Error("eBay updated the title, but saving failed. Re-sync listings.");
          } catch (e) {
            action.error = e instanceof Error ? e.message : String(e);
          }
        }
      }
    }
    // Auto-pause campaigns with views but no sales (promoted auto-rules):
    // a RUNNING campaign started >= daysNoSales ago whose ads' listings
    // ALL have views > 0 and sales == 0 gets paused.
    if (promotedAutoOn && !data.dryRun && token && campaignAds.size) {
      for (const c of campaignAds.values()) {
        const started = c.startedAt ? new Date(c.startedAt) : null;
        const campaignAgeDays = started ? Math.floor((Date.now() - started.getTime()) / 86400000) : 0;
        if (campaignAgeDays < daysNoSales) continue;
        const adsListings = (listings || []).filter((l: any) => c.listingIds.includes(l.ebay_item_id));
        if (!adsListings.length) continue;
        const allViewsNoSales = adsListings.every((l: any) => (l.views || 0) > 0 && (l.sales || 0) === 0);
        if (!allViewsNoSales) continue;
        const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: c.campaignId, title: c.campaignName, action: "campaign_paused", detail: `Promoted campaign ${campaignAgeDays}d old, views but no sales — paused` };
        actions.push(action);
        try {
          await new EbayMarketingService(new EbayRestClient(token)).action(c.campaignId, "pause");
        } catch (e) {
          action.error = e instanceof Error ? e.message : String(e);
          action.action = "failed";
        }
      }
    }
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "optimizer", message: `Optimizer ${data.dryRun ? "dry-run" : "run"}: ${actions.length} action(s)`, metadata: { actions } });
    return actions;
  });

// --- Modern Fulfillment / Returns / Notifications / Marketing (Phase 2-3) ---
// These are authenticated server functions, not webhooks: eBay webhooks hit
// the deployed app's public endpoint and must be wired there (see
// docs/ebay-audit.md), using handleEbayNotification in notifications.server.
// No function here sends tracking to eBay — CJ owns tracking.

async function ebayClientFor(context: any) {
  const token = await getFreshEbayToken(context.supabase, context.userId);
  return new EbayRestClient(token);
}

export const listEbayOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { offset?: number; status?: string }) => data)
  .handler(async ({ data, context }: any) => new EbayOrderService(await ebayClientFor(context)).orders(data.offset ?? 0, data.status ?? "ALL"));

export const listEbayDisputes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { offset?: number }) => data)
  .handler(async ({ data, context }: any) => new EbayOrderService(await ebayClientFor(context)).disputes(data.offset ?? 0));

export const listEbayReturns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { offset?: number; filter?: string }) => data)
  .handler(async ({ data, context }: any) => {
    // Post-Order v2 authenticates with IAF, not Bearer — see orders.server.
    const token = await getFreshEbayToken(context.supabase, context.userId);
    return new EbayReturnService(new EbayRestClient(token, "EBAY_US", { authScheme: "IAF" })).searchReturns(data.offset ?? 0, data.filter);
  });

export const listEbayNotificationTopics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { getEbayApplicationToken } = await import("./ebay/auth.server");
    return new EbayNotificationService(new EbayRestClient(await getEbayApplicationToken())).topics();
  });

export const listEbayNotificationSubscriptions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => new EbayNotificationService(await ebayClientFor(context)).subscriptions());

export const createEbayNotificationSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { topicId: string; destinationId?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const svc = new EbayNotificationService(await ebayClientFor(context));
    const sub = await svc.createSubscription(data.topicId, data.destinationId);
    // Provider subscription was created as this authenticated user. Privileged
    // persistence records only this user's returned provider ID.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const saved = await supabaseAdmin.from("ebay_notification_subscriptions").upsert({
      user_id: context.userId, subscription_id: sub.subscriptionId, topic_id: sub.topicId, destination_id: sub.destinationId, status: sub.status || "active",
    }, { onConflict: "user_id,topic_id" });
    if (saved.error) throw new Error("eBay created the subscription, but saving failed. Refresh before retrying.");
    return sub;
  });

export const listEbayCampaigns = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { offset?: number }) => data)
  .handler(async ({ data, context }: any) => {
    const svc = new EbayMarketingService(await ebayClientFor(context));
    const page = await svc.campaigns(data.offset ?? 0);
    // Attach the listings-included count per campaign (best-effort — the
    // campaign list itself carries no ad count). Performance
    // (clicks/impressions/spend/sales) is NOT in this API at all; it lives
    // in eBay's Seller Hub, so the card says so instead of inventing it.
    const campaigns = await Promise.all((page.campaigns || []).map(async (c: any) => {
      let adCount: number | null = null;
      try {
        const ads = await svc.ads(c.campaignId);
        adCount = (ads.ads || []).length;
      } catch {
        adCount = null;
      }
      return { ...c, adCount };
    }));
    return { ...page, campaigns };
  });

/** Ended offers (sales feature #1): the "Ended" tab on Listings. Read-only
 * enumeration via the inventory route; never publishes or ends anything. */
export const listEndedEbayOffers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    return fetchEndedOffersViaInventory(token);
  });

/**
 * Relist an ended listing (sales feature #1): rebuilds the draft from the
 * CJ product behind the SKU and inserts it as a PENDING draft with a fresh
 * AI title and the current pricing rules. NEVER publishes — the user
 * approves the draft and pushes it themselves.
 */
export const relistEndedListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sku: string; title?: string; categoryId?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    const { cjSearchProducts, cjProductDetail, getUserCjToken, cjFreightCalculate, cjOriginForVariant } = await import("./cj.server");
    const { buildCjDraftRow } = await import("./draft-from-cj");
    const cjToken = await getUserCjToken(context.supabase, context.userId);
    // Match the CJ product by its SKU. Prefer an exact productSku match;
    // a single search result is the fallback; anything else is an error.
    const search = await cjSearchProducts({ keyword: data.sku }, cjToken);
    const list = search.list || [];
    const exact = list.find((p: any) => String(p.productSku || "").toUpperCase() === String(data.sku).toUpperCase());
    const product = exact || (list.length === 1 ? list[0] : null);
    if (!product) throw new Error(`No CJ product matches SKU ${data.sku} — it may have been removed from CJ, or the SKU is not a CJ SKU.`);
    const detail: any = await cjProductDetail(product.pid, "US", cjToken);
    const primaryVariant = detail?.variants?.[0] || detail?.variantList?.[0] || null;
    const itemCost = Number(primaryVariant?.variantSellPrice ?? detail?.sellPrice) || 0;
    // Freight quote for the primary variant (cheapest option; 0 when CJ
    // has no quote — the push preflight blocks a 0-shipping push). The
    // quote starts from the warehouse country holding this variant — a
    // US-warehouse product quoted from CN returns an empty list.
    let shipping = 0;
    let carrier: { logisticName?: string; logisticAging?: string } | null = null;
    try {
      const options = await cjFreightCalculate({ startCountryCode: await cjOriginForVariant(product.pid, primaryVariant?.vid, "US", cjToken), endCountryCode: "US", products: [{ vid: primaryVariant?.vid || "", quantity: 1 }] }, cjToken);
      const cheapest = (options || []).reduce((best: any, o: any) => (!best || Number(o.logisticPrice) < Number(best.logisticPrice) ? o : best), null);
      if (cheapest) {
        shipping = Number(cheapest.logisticPrice) || 0;
        carrier = { logisticName: cheapest.logisticName, logisticAging: cheapest.logisticAging };
      }
    } catch {
      shipping = 0;
    }
    const draft = buildCjDraftRow({ userId: context.userId, detail, itemCost, shipping, carrier, rules: rule || null, endCountry: "US", primaryVariant });
    // Fresh AI title (same prompt style as the optimizer's title rewrite;
    // CJ name as the fallback when AI is unavailable).
    try {
      const aiTitle = await callAiText(context.supabase, context.userId, {
        system: "Rewrite this product name as an eBay listing title. Reply with ONLY the new title, nothing else. Max 80 characters, no ALL CAPS, no keyword stuffing, no other marketplace names. Keep the real product words; drop filler.",
        user: draft.title,
      });
      if (aiTitle) draft.title = aiTitle.trim().replace(/^["']|["']$/g, "").slice(0, 80);
    } catch {
      /* AI is optional; the CJ title stands. */
    }
    // Keep the original eBay category from the ended offer when we have
    // it; otherwise the draft needs a category before it can be pushed
    // (the Drafts page blocks a push with no category).
    const { data: inserted, error } = await context.supabase.from("listing_drafts").insert({
      user_id: context.userId,
      cj_product_id: String(product.pid),
      sku: data.sku,
      title: draft.title,
      price: roundMoney(Number(draft.price ?? 0)),
      profit: draft.profit,
      images: draft.images,
      description: draft.description,
      item_specifics: draft.item_specifics,
      category_id: data.categoryId || null,
      status: "pending",
    }).select("id").single();
    if (error) throw error;
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "ebay", message: `Relisted as draft: ${draft.title}`, metadata: { draftId: inserted?.id, sku: data.sku } });
    return { draftId: inserted?.id, title: draft.title };
  });

export const createEbayCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { name: string; strategy: "FIXED" | "DYNAMIC"; rate: number; listingIds: string[] }) => data)
  .handler(async ({ data, context }: any) => {
    // DYNAMIC = eBay's auto ad-rate strategy (trending category rates).
    // FIXED requires an explicit rate, validated by campaignInput in marketing.server.
    campaignInput.parse(data);
    return new EbayMarketingService(await ebayClientFor(context)).create(data);
  });

export const changeEbayCampaign = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; action: "pause" | "resume" | "end" }) => {
    if (!data.id || !["pause", "resume", "end"].includes(data.action)) throw new Error("Invalid campaign action.");
    return data;
  })
  .handler(async ({ data, context }: any) => new EbayMarketingService(await ebayClientFor(context)).action(data.id, data.action));
