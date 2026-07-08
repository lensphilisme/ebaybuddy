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
      variantSellPrice: Number(v.variantSellPrice ?? v.price ?? draft.price ?? 0),
      price: Number(v.price ?? v.variantSellPrice ?? draft.price ?? 0),
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
        let pushed: any;
        try {
          pushed = await publishInventoryItem(token, workingDraft);
        } catch (firstError) {
          const firstMessage = firstError instanceof Error ? firstError.message : String(firstError);
          if (!draft.cj_product_id || !shouldAutoRepair(firstMessage)) throw firstError;
          workingDraft = await autoRepairDraftFromCj(context, workingDraft, firstMessage);
          pushed = await publishInventoryItem(token, workingDraft);
        }
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
          headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY, "Content-Type": "application/json" },
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
              headers: { "Lovable-API-Key": process.env.LOVABLE_API_KEY, "Content-Type": "application/json" },
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
