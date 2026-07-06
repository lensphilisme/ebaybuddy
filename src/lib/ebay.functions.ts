import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { ebayConsentUrl, exchangeEbayCode, fetchActiveEbayListings, getCategorySuggestions, getEbayCategoryTreeShallow, getFreshEbayToken, publishInventoryItem, reviseEbayListingText, endEbayFixedPriceListing } from "./ebay.server";

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

export const getEbayConnectUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => ebayConsentUrl(context.userId));

export const connectEbayWithCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { code: string }) => data)
  .handler(async ({ data, context }: any) => {
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

export const syncEbayListings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { entriesPerPage?: number }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    const perPage = data.entriesPerPage ?? 200;
    let page = 1;
    let totalSynced = 0;
    let grandTotal = 0;
    // eBay caps GetMyeBaySelling at 200 per page; walk until we've covered TotalNumberOfEntries.
    while (true) {
      const result = await fetchActiveEbayListings(token, page, perPage);
      grandTotal = result.total;
      for (const item of result.items) {
        const row = {
          user_id: context.userId,
          ebay_item_id: item.itemId,
          sku: item.sku,
          title: item.title,
          price: item.price,
          currency: item.currency,
          marketplace_id: "EBAY_US",
          status: "active",
          sales: item.quantitySold,
          views: item.watchCount,
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
      }
      totalSynced += result.items.length;
      if (result.items.length < perPage || totalSynced >= grandTotal) break;
      page += 1;
      if (page > 50) break; // safety cap ~10k listings
    }
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ebay", message: `Synced ${totalSynced} of ${grandTotal} active eBay listings`, metadata: { total: grandTotal, synced: totalSynced } });
    return { total: grandTotal, synced: totalSynced };
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
        if (!draft.profit?.start_country) {
          try {
            const { cjProductDetail, getUserCjToken } = await import("./cj.server");
            const cjToken = await getUserCjToken(context.supabase, context.userId);
            const detail: any = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", cjToken);
            const startCountry = (detail?.countryCode || detail?.countryFrom || detail?.sourceFrom || "CN").toString().toUpperCase().slice(0, 2);
            workingDraft = { ...draft, profit: { ...(draft.profit || {}), start_country: startCountry } };
            await context.supabase.from("listing_drafts").update({ profit: workingDraft.profit }).eq("id", draft.id);
          } catch { /* fall back to CN default in publish */ }
        }
        const pushed = await publishInventoryItem(token, workingDraft);
        await context.supabase.from("ebay_listings").insert({ user_id: context.userId, draft_id: draft.id, ebay_item_id: pushed.listingId, ebay_offer_id: pushed.offerId, sku: draft.sku, title: draft.title, price: draft.price, cj_product_id: draft.cj_product_id, status: "active", cj_landed_cost: Number((draft.profit || {}).item_cost || 0) + Number((draft.profit || {}).shipping || 0) });
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
// AI-powered deep category picker. Fetches the eBay category tree (top 3 levels),
// asks Gemini to pick the single best leaf categoryId for a product, returns
// the top candidates so the user can accept or override.
export const aiDeepCategorySuggest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title: string; description?: string; hint?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const token = await getFreshEbayToken(context.supabase, context.userId);
    // Cheap: also include normal suggestions as a strong prior.
    const [normal, tree] = await Promise.all([
      getCategorySuggestions(token, data.title, "EBAY_US").catch(() => []),
      getEbayCategoryTreeShallow(token, "EBAY_US"),
    ]);
    const priors = normal.slice(0, 8).map((c: any) => `${c.categoryId}\t${c.path}`).join("\n");
    // Keep prompt bounded: leaf categories only, shuffled prior wins.
    const leaves = tree.categories.filter((c) => c.leaf).slice(0, 4000);
    let picks: { categoryId: string; path: string; reason: string }[] = [];
    if (process.env.LOVABLE_API_KEY) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "You choose the single best eBay leaf category for a product. Return JSON { picks: [{categoryId, path, reason}] } with 3 candidates sorted best first. Use only categoryIds from the provided list." },
              { role: "user", content: `Product title: ${data.title}\nDescription: ${(data.description || "").slice(0, 500)}\nManual hint: ${data.hint || "none"}\n\nStrong prior (eBay suggestions):\n${priors}\n\nFull leaf categories (id\\tpath):\n${leaves.map((c) => `${c.categoryId}\t${c.path}`).join("\n").slice(0, 60000)}` },
            ],
          }),
        });
        const json = await res.json();
        picks = JSON.parse(json.choices?.[0]?.message?.content || "{}").picks || [];
      } catch { picks = []; }
    }
    if (picks.length === 0) {
      picks = normal.slice(0, 3).map((c: any) => ({ categoryId: c.categoryId, path: c.path, reason: "eBay suggestion" }));
    }
    return picks;
  });

// Optimizer: run rules over active listings. Ends dead listings, rewrites titles
// with AI when signals warrant. Returns per-listing actions taken.
export const runOptimizerRules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { dryRun?: boolean; listingIds?: string[] }) => data)
  .handler(async ({ data, context }: any) => {
    const token = data.dryRun ? null : await getFreshEbayToken(context.supabase, context.userId).catch(() => null);
    const { data: rule } = await context.supabase.from("automation_rules").select("*").eq("user_id", context.userId).maybeSingle();
    const daysNoSales = Number(rule?.optimizer_no_sales_days ?? 30);
    const daysNoViewsRewrite = Number(rule?.optimizer_low_views_days ?? 14);
    const poorExposureDays = Number(rule?.optimizer_poor_exposure_days ?? 45);
    let q = context.supabase.from("ebay_listings").select("*").eq("user_id", context.userId).eq("status", "active");
    if (data.listingIds?.length) q = q.in("id", data.listingIds);
    const { data: listings, error } = await q;
    if (error) throw error;
    const actions: { id: string; title: string; action: string; detail?: string; error?: string }[] = [];
    for (const l of listings || []) {
      const listedAt = l.listed_at ? new Date(l.listed_at) : null;
      const ageDays = listedAt ? Math.floor((Date.now() - listedAt.getTime()) / 86400000) : 0;
      if (ageDays >= daysNoSales && (l.sales || 0) === 0) {
        const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: data.dryRun ? "end_recommended" : "ended", detail: `${ageDays}d no sales` };
        actions.push(action);
        if (!data.dryRun) {
          try {
            if (token && l.ebay_item_id) await endEbayFixedPriceListing(token, l.ebay_item_id, "NotAvailable");
            await context.supabase.from("ebay_listings").update({ status: "ended", ended_at: new Date().toISOString() }).eq("id", l.id);
          } catch (e) {
            action.error = e instanceof Error ? e.message : String(e);
            await context.supabase.from("ebay_listings").update({ status: "error" }).eq("id", l.id);
          }
        }
        continue;
      }
      const needsRewrite = /ban\s+the\s+sale\s+of\s+amazon/i.test(l.title || "") || (l.views || 0) === 0 || (ageDays >= daysNoViewsRewrite && (l.views || 0) < 5) || (ageDays >= poorExposureDays && (l.clicks || 0) === 0);
      if (needsRewrite) {
        let newTitle = fallbackRewrite(l.title);
        if (process.env.LOVABLE_API_KEY) {
          try {
            const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
              method: "POST",
              headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                model: "google/gemini-3-flash-preview",
                messages: [
                  { role: "system", content: "Rewrite an eBay title for search. Max 80 chars. Keep brand/model/spec keywords. No emojis, no ALL CAPS. Return the title only." },
                  { role: "user", content: l.title },
                ],
              }),
            });
            const j = await res.json();
            newTitle = cleanTitle(j.choices?.[0]?.message?.content || newTitle);
          } catch {}
        }
        const reason = /ban\s+the\s+sale\s+of\s+amazon/i.test(l.title || "") ? "removed prohibited marketplace text" : `${ageDays}d, ${l.views || 0} views, ${l.clicks || 0} clicks, ${l.sales || 0} sales`;
        const action: { id: string; title: string; action: string; detail?: string; error?: string } = { id: l.id, title: l.title, action: "rewrite_title", detail: `${newTitle} · ${reason}` };
        actions.push(action);
        if (!data.dryRun && newTitle && newTitle !== l.title) {
          try {
            if (token && l.ebay_item_id) await reviseEbayListingText(token, l.ebay_item_id, newTitle);
            await context.supabase.from("ebay_listings").update({ title: newTitle }).eq("id", l.id);
          } catch (e) {
            action.error = e instanceof Error ? e.message : String(e);
          }
        }
      }
    }
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "optimizer", message: `Optimizer ${data.dryRun ? "dry-run" : "run"}: ${actions.length} action(s)`, metadata: { actions } });
    return actions;
  });
