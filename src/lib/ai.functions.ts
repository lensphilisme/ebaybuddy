// Listing AI (Nov 2026): the user connects their own provider in Settings
// (DeepSeek, Gemini, OpenAI or any OpenAI-compatible endpoint) and these
// functions call it through src/lib/ai-provider.server.ts. When no provider
// is configured — or the provider fails — the local fallback rules in this
// file fill everything, so listing work never blocks on AI.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cjProductDetail, getUserCjToken } from "./cj.server";
import { callAiJson } from "./ai-provider.server";

async function getAspectCatalog(accessToken: string, categoryId: string) {
  const { getItemAspectsForCategory } = await import("./ebay.server");
  return getItemAspectsForCategory(accessToken, categoryId);
}

function cleanText(value: unknown, fallback = "") {
  const normalize = (v: unknown) => String(v ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
  return normalize(value) || normalize(fallback);
}

function flattenImageInput(input: unknown): unknown[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.flatMap(flattenImageInput);
  if (typeof input === "string") {
    const trimmed = input.trim().replace(/\\\//g, "/").replace(/&amp;/gi, "&");
    if (!trimmed) return [];
    if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
      try { return flattenImageInput(JSON.parse(trimmed)); } catch { /* continue */ }
    }
    const urls = trimmed.match(/https?:\/\/[^\s"'\\\])>,]+/gi);
    return urls?.length ? urls : [trimmed];
  }
  return [];
}

function cleanImages(...inputs: unknown[]) {
  const urls: string[] = [];
  for (const input of inputs) {
    for (const raw of flattenImageInput(input)) {
      const value = String(raw || "").trim().replace(/\\\//g, "/").replace(/^['"]|['"]$/g, "");
      if (!/^https?:\/\//i.test(value)) continue;
      try {
        const u = new URL(value);
        if (u.hostname.includes(".")) urls.push(u.toString());
      } catch { /* ignore */ }
    }
  }
  return Array.from(new Set(urls)).slice(0, 12);
}

function shortAspect(name: string, value: unknown) {
  let text = cleanText(value);
  if (/^features?$/i.test(name)) text = text.replace(/\bContains\s+(?=\w)/gi, "").replace(/\bAll Natural Ingredients\b/gi, "Natural Ingredients");
  if (text.length <= 65) return text;
  return text.slice(0, 65).replace(/[\s,;:|/+-]+[^\s,;:|/+-]*$/g, "").replace(/[\s,;:|/+-]+$/g, "").trim() || text.slice(0, 65).trim();
}

const LOCATION_SPECIFIC_NAMES = new Set([
  "item location",
  "location",
  "inventory location",
  "merchant location",
  "merchantlocationkey",
  "warehouse",
  "warehouse location",
  "ship from",
  "ships from",
  "shipping location",
  "postal code",
  "zip code",
  "city",
  "state",
  "state or province",
]);

function isListingLocationSpecific(name: string) {
  return LOCATION_SPECIFIC_NAMES.has(cleanText(name).toLowerCase().replace(/[_-]+/g, " "));
}

function sanitizeSpecifics(input: any, axes: string[] = []) {
  const axisSet = new Set(axes.map((a) => cleanText(a).toLowerCase()));
  const specifics: Record<string, string | string[]> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = cleanText(rawKey);
    if (!key || axisSet.has(key.toLowerCase()) || isListingLocationSpecific(key)) continue;
    if (Array.isArray(rawValue)) {
      const values = rawValue.map((v) => shortAspect(key, v)).filter(Boolean).slice(0, 10);
      if (values.length) specifics[key] = Array.from(new Set(values));
    } else {
      const value = shortAspect(key, rawValue);
      if (value) specifics[key] = value;
    }
  }
  return { Condition: "New", Brand: specifics.Brand || "Unbranded", ...specifics, Model: specifics.Model || "Does Not Apply", MPN: specifics.MPN || "Does Not Apply" } as Record<string, string | string[]>;
}

function catalogForPrompt(catalog: Record<string, { required: boolean; allowed?: string[]; maxLen?: number; applicableTo?: string[]; usage?: string; cardinality?: string }>) {
  return Object.entries(catalog || {}).map(([name, spec]) => ({
    name,
    required: !!spec.required,
    usage: spec.usage,
    applicableTo: spec.applicableTo,
    cardinality: spec.cardinality,
    allowed: spec.allowed?.slice(0, 40),
    maxLen: spec.maxLen,
  })).filter((spec) => !spec.applicableTo?.includes("PRODUCT") || spec.applicableTo.includes("ITEM")).slice(0, 120);
}


function variantAxes(productKey?: unknown, sample?: any) {
  const configured = cleanText(productKey);
  if (configured) return configured.split(/[-,/|>]+/).map((a) => cleanText(a)).filter(Boolean);
  const label = cleanText(sample?.variantKey || sample?.variantNameEn || "");
  const parts = label.split(/[-,/|]+/).map((p) => cleanText(p)).filter(Boolean);
  return parts.length > 1 ? parts.map((_, i) => `Option ${i + 1}`) : ["Option"];
}

function variantRows(detail: any, draft: any, images: string[]) {
  const variants = detail?.variants || detail?.variantList || detail?.productVariants || draft?.profit?.variant_group?.variants || [];
  if (!Array.isArray(variants) || variants.length <= 1) return [];
  return variants.map((v: any, i: number) => ({
    vid: v.vid,
    variantSku: v.variantSku || v.sku || v.vid || `${draft.sku}-${i + 1}`,
    variantKey: v.variantKey || v.variantNameEn || v.variantSku || v.vid || `Option ${i + 1}`,
    variantNameEn: v.variantNameEn,
    variantImage: cleanImages(v.variantImage, v.image, images)[0] || images[0] || null,
    variantSellPrice: Number(v.variantSellPrice ?? v.price ?? draft.profit?.item_cost ?? draft.price ?? 0),
    price: Number(v.price ?? draft.price ?? 0),
    inventory: Number(v.inventory || v.quantity || draft.quantity || 1),
  }));
}

function fallback(title: string, description = "") {
  const text = `${title} ${description}`.toLowerCase();
  const cleanTitle = cleanText(title, "New marketplace item");
  const specifics: Record<string, string> = { Condition: "New", Brand: "Unbranded", Type: cleanTitle.split(" ").slice(0, 3).join(" "), Model: "Does not apply" };
  if (text.includes("wireless")) specifics.Connectivity = "Wireless";
  if (text.includes("led")) specifics.Lighting = "LED";
  if (text.includes("cotton")) specifics.Material = "Cotton";
  const bullets = cleanTitle.split(/[,.|-]/).slice(0, 5).map((s) => s.trim()).filter(Boolean);
  const rewritten = `${cleanTitle}\n\n${bullets.map((b) => `• ${b}`).join("\n")}\n\nShips from vetted fulfillment partners. Please review the photos and selected option before checkout.`;
  return { title: cleanTitle.slice(0, 80), description: rewritten, bullet_features: bullets, item_specifics: specifics, brand: "Unbranded", model: "Does not apply" };
}

export const optimizeDraftWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftId: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: draft, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).eq("id", data.draftId).single();
    if (error) throw error;
    const local = fallback(draft.title, draft.description);
    let aiOut: any = null;
    try {
      let cjDetail: any = null;
      try { cjDetail = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", await getUserCjToken(context.supabase, context.userId)); } catch { /* AI works from the draft alone */ }
      let catalog: any = {};
      try {
        if (draft.category_id) {
          const { getFreshEbayToken } = await import("./ebay.server");
          catalog = await getAspectCatalog(await getFreshEbayToken(context.supabase, context.userId), String(draft.category_id));
        }
      } catch { /* catalog is a hint, not a requirement */ }
      aiOut = await callAiJson(context.supabase, context.userId, {
        system: "You write eBay item specifics as JSON. Reply with ONLY a JSON object: {\"item_specifics\": {\"Brand\": \"...\", \"Model\": \"...\", \"Type\": \"...\", \"Material\": \"...\"}, \"brand\": \"...\", \"model\": \"...\"}. Use only aspects from the catalog when one is given. Never invent a brand or model — use \"Unbranded\" / \"Does Not Apply\" when unknown. Never include location aspects (country, city, warehouse).",
        user: JSON.stringify({ title: draft.title, description: draft.description, cjProductName: cjDetail?.productNameEn || null, cjDescription: cjDetail?.description || null, catalog: catalogForPrompt(catalog) }),
      });
    } catch (e) {
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "warn", category: "ai", message: `AI provider failed for item specifics, used local rules: ${draft.title}`, metadata: { draftId: draft.id, error: e instanceof Error ? e.message : String(e) } });
    }
    const out: any = aiOut?.item_specifics
      ? { item_specifics: aiOut.item_specifics, brand: aiOut.brand || draft.brand || "Unbranded", model: aiOut.model || draft.model || "Does Not Apply" }
      : { item_specifics: local.item_specifics, brand: draft.brand || "Unbranded", model: draft.model || "Does Not Apply" };
        const specifics = sanitizeSpecifics({ Brand: out.brand || draft.brand || "Unbranded", ...(out.item_specifics || {}), Model: out.model || draft.model || "Does Not Apply" });
    const update = {
      item_specifics: specifics,
      brand: Array.isArray(specifics.Brand) ? specifics.Brand[0] : specifics.Brand,
      model: Array.isArray(specifics.Model) ? specifics.Model[0] : specifics.Model,
    };
    // The fields this run actually filled (new keys, or keys that were
    // empty before) — the toast lists them instead of a generic "done".
    const before = (draft.item_specifics || {}) as Record<string, unknown>;
    const filledFields = Object.keys(specifics).filter((k) => {
      const v = before[k];
      return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    });
    await context.supabase.from("listing_drafts").update(update).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `AI filled item specifics: ${draft.title}${filledFields.length ? ` — ${filledFields.join(", ")}` : ""}`, metadata: { draftId: draft.id, aspectCount: Object.keys(specifics).length, ai: !!aiOut, filledFields } });
    return { ...update, filledFields };
  });

export const optimizeDraftCopyWithAi = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftId: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: draft, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).eq("id", data.draftId).single();
    if (error) throw error;
    const local = fallback(draft.title, draft.description);
    let aiOut: any = null;
    try {
      aiOut = await callAiJson(context.supabase, context.userId, {
        system: "You rewrite the OPENING of an eBay listing description. Reply with ONLY a JSON object: {\"title\": \"...\", \"description\": \"...\", \"bullet_features\": [\"...\", \"...\"]}. Title max 80 characters, no ALL CAPS, no keyword stuffing, no other marketplace names. Description: keep the input description's facts exactly — colours, compatibility, packing list, sizes and materials — rewrite only the opening into one short selling paragraph, then keep the rest of the detail as-is. Never invent features, sizes or materials not in the input. If the input description is empty, write a short plain description from the title only.",
        user: JSON.stringify({ title: draft.title, description: draft.description }),
      });
    } catch (e) {
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "warn", category: "ai", message: `AI provider failed for listing copy, used local rules: ${draft.title}`, metadata: { draftId: draft.id, error: e instanceof Error ? e.message : String(e) } });
    }
    // The local fallback PRESERVES the CJ description — the generic
    // template (fallback()) is only used when there is no description at
    // all. Replacing the full CJ detail with a template was the audit #29
    // bug: colours, compatibility and the packing list were destroyed.
    const aiSucceeded = Boolean(aiOut?.title);
    const out = aiOut?.title ? aiOut : { title: draft.title, description: draft.description, bullet_features: local.bullet_features };
    const update: Record<string, unknown> = {
      title: cleanText(out.title, draft.title).slice(0, 80),
      description: cleanText(out.description, draft.description) || local.description,
      bullet_features: Array.isArray(out.bullet_features) ? out.bullet_features.map((b: unknown) => shortAspect("Features", b)).filter(Boolean).slice(0, 8) : [],
    };
    // Mark the description as AI-optimized (audit #30): Repair reads this
    // flag and leaves the description alone. Only set when AI actually
    // ran — the local fallback changes nothing, so it claims nothing.
    if (aiSucceeded) update.profit = { ...(draft.profit || {}), description_optimized_at: new Date().toISOString() };
    const summary = aiSucceeded ? "Rewrote opening, kept colours/compatibility/packing" : "AI unavailable — kept the original description";
    await context.supabase.from("listing_drafts").update(update).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `AI optimized listing copy: ${update.title} — ${summary}`, metadata: { draftId: draft.id, ai: aiSucceeded } });
    return { ...update, summary };
  });

export const repairDraftForEbay = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { draftId: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { data: draft, error } = await context.supabase.from("listing_drafts").select("*").eq("user_id", context.userId).eq("id", data.draftId).single();
    if (error) throw error;

    let cjDetail: any = null;
    try {
      cjDetail = await cjProductDetail(draft.cj_product_id, draft.profit?.end_country || "US", await getUserCjToken(context.supabase, context.userId));
    } catch (e) {
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "warn", category: "ai", message: `CJ refresh skipped for draft: ${draft.title}`, metadata: { draftId: draft.id, error: e instanceof Error ? e.message : String(e) } });
    }

    const titleSource = cjDetail?.productNameEn || draft.title || draft.sku;
    const descriptionSource = cleanText(cjDetail?.description, draft.description);
    const baseImages = cleanImages(draft.images, cjDetail?.productImageSet, cjDetail?.productImages, cjDetail?.bigImage, cjDetail?.productImage);
    const axes = variantAxes(cjDetail?.productKeyEn || draft.profit?.product_key, (cjDetail?.variants || cjDetail?.variantList || cjDetail?.productVariants || draft.profit?.variant_group?.variants || [])[0]);
    const variants = variantRows(cjDetail, draft, baseImages);

    const fallbackOut = fallback(titleSource, descriptionSource);
    let aiOut: any = null;
    try {
      let catalog: any = {};
      try {
        if (draft.category_id) {
          const { getFreshEbayToken } = await import("./ebay.server");
          catalog = await getAspectCatalog(await getFreshEbayToken(context.supabase, context.userId), String(draft.category_id));
        }
      } catch { /* catalog is a hint, not a requirement */ }
      aiOut = await callAiJson(context.supabase, context.userId, {
        system: "You repair CJ product data into eBay listing format as JSON. Reply with ONLY a JSON object: {\"title\": \"...\", \"description\": \"...\", \"bullet_features\": [\"...\"], \"item_specifics\": {\"Brand\": \"...\", \"Model\": \"...\", \"Type\": \"...\"}, \"brand\": \"...\", \"model\": \"...\"}. Title max 80 characters. Use only aspects from the catalog when one is given. Never invent a brand, model, size or material — use \"Unbranded\" / \"Does Not Apply\" when unknown. Never include location aspects.",
        user: JSON.stringify({ title: titleSource, description: descriptionSource, cjProductName: cjDetail?.productNameEn || null, cjDescription: cjDetail?.description || null, catalog: catalogForPrompt(catalog) }),
      });
    } catch (e) {
      await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "warn", category: "ai", message: `AI provider failed for draft repair, used local rules: ${draft.title}`, metadata: { draftId: draft.id, error: e instanceof Error ? e.message : String(e) } });
    }
    if (!aiOut) aiOut = {};
    const title = cleanText(aiOut.title, titleSource).slice(0, 80) || fallbackOut.title;
    // Audit #30: when AI Optimized already rewrote this description, Repair
    // must NOT overwrite it — it repairs only the other fields (brand,
    // specifics, images, variants) and leaves the description (and its
    // bullets) alone. The flag lives in the draft's profit JSONB.
    const descriptionOptimized = Boolean(draft.profit?.description_optimized_at);
    const description = descriptionOptimized
      ? cleanText(draft.description) || cleanText(descriptionSource)
      : cleanText(aiOut.description, descriptionSource) || fallbackOut.description;
    const bulletFeatures = (descriptionOptimized
      ? (Array.isArray(draft.bullet_features) ? draft.bullet_features : fallbackOut.bullet_features)
      : (Array.isArray(aiOut.bullet_features) ? aiOut.bullet_features : fallbackOut.bullet_features))
      .map((b: unknown) => shortAspect("Features", b))
      .filter(Boolean)
      .slice(0, 8);
    const itemSpecifics = sanitizeSpecifics({ ...draft.item_specifics, ...(aiOut.item_specifics || {}), Brand: aiOut.brand || draft.brand || "Unbranded", Model: aiOut.model || draft.model || "Does Not Apply" }, variants.length > 1 ? axes : []);
    if (bulletFeatures.length) itemSpecifics.Features = bulletFeatures;

    const patch = {
      title,
      description,
      bullet_features: bulletFeatures,
      item_specifics: itemSpecifics,
      brand: Array.isArray(itemSpecifics.Brand) ? itemSpecifics.Brand[0] : itemSpecifics.Brand,
      model: Array.isArray(itemSpecifics.Model) ? itemSpecifics.Model[0] : itemSpecifics.Model,
      images: baseImages,
      status: "pending",
      audit_reason: baseImages.length ? "AI repaired CJ data into eBay format. Retry push." : "AI repaired text/specs, but a valid image URL is still required before push.",
      profit: { ...(draft.profit || {}), start_country: (draft.profit?.start_country || (cjDetail as any)?.countryCode || (cjDetail as any)?.countryFrom || "CN").toString().toUpperCase().slice(0, 2), product_key: cjDetail?.productKeyEn || draft.profit?.product_key || null, variant_axes: axes, variant_group: variants.length > 1 ? { variants } : draft.profit?.variant_group || null, cj_refresh_cached_at: cjDetail ? new Date().toISOString() : draft.profit?.cj_refresh_cached_at || null },
    };

    // Summary for the toast: what was actually repaired, and whether the
    // optimized description was left in place.
    const repaired: string[] = [];
    if (title !== draft.title) repaired.push("title");
    repaired.push("item specifics");
    if (baseImages.length) repaired.push("images");
    if (variants.length > 1) repaired.push("variants");
    if (descriptionOptimized) repaired.push("left the optimized description in place");
    const summary = `Repaired ${repaired.join(", ")}`;
    await context.supabase.from("listing_drafts").update(patch).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `Repaired eBay draft data: ${title} — ${summary}`, metadata: { draftId: draft.id, images: baseImages.length, variants: variants.length, axes, descriptionOptimized } });
    return { ...patch, summary };
  });
