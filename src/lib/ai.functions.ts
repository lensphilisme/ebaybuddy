import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { cjProductDetail, getUserCjToken } from "./cj.server";

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

function sanitizeSpecifics(input: any, axes: string[] = []) {
  const axisSet = new Set(axes.map((a) => cleanText(a).toLowerCase()));
  const specifics: Record<string, string> = {};
  for (const [rawKey, rawValue] of Object.entries(input || {})) {
    const key = cleanText(rawKey);
    if (!key || axisSet.has(key.toLowerCase())) continue;
    const value = Array.isArray(rawValue) ? rawValue.map((v) => shortAspect(key, v)).filter(Boolean).join(", ") : shortAspect(key, rawValue);
    if (value) specifics[key] = shortAspect(key, value);
  }
  return { Condition: "New", Brand: specifics.Brand || "Unbranded", ...specifics, Model: specifics.Model || "Does not apply" } as Record<string, string>;
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
    let out = fallback(draft.title, draft.description);
    if (process.env.LOVABLE_API_KEY) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "Return strict JSON for an eBay listing: title <=80 chars, description plain text <=3000 chars, bullet_features array, item_specifics object, brand, model. Fill missing safe item specifics for eBay, rewrite the description for buyers, and optimize for search clicks without unsupported claims. Do not invent variation options, certifications, brand names, or compatibility." },
              { role: "user", content: JSON.stringify({ title: draft.title, description: draft.description, category_id: draft.category_id, existing_specifics: draft.item_specifics, sku: draft.sku }) },
            ],
          }),
        });
        const json = await res.json();
        out = JSON.parse(json.choices?.[0]?.message?.content || JSON.stringify(out));
      } catch {
        out = fallback(draft.title, draft.description);
      }
    }
    const specifics = sanitizeSpecifics({ Brand: out.brand || draft.brand || "Unbranded", ...(out.item_specifics || {}), Model: out.model || draft.model || "Does not apply" });
    const update = {
      title: cleanText(out.title, draft.title).slice(0, 80),
      description: cleanText(out.description, fallback(draft.title, draft.description).description),
      bullet_features: Array.isArray(out.bullet_features) ? out.bullet_features.map((b: unknown) => shortAspect("Features", b)).filter(Boolean).slice(0, 8) : [],
      item_specifics: specifics,
      brand: specifics.Brand,
      model: specifics.Model,
    };
    await context.supabase.from("listing_drafts").update(update).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `Optimized draft: ${update.title}`, metadata: { draftId: draft.id } });
    return update;
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

    let aiOut: any = {};
    if (process.env.LOVABLE_API_KEY) {
      try {
        const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.LOVABLE_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model: "google/gemini-3-flash-preview",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: "Repair CJ Dropshipping product data for eBay Inventory API. Return strict JSON: title, description, bullet_features array, item_specifics object, brand, model. Rules: title <=80 chars, description plain text not empty, every item specific value <=65 chars, no duplicate variation axes in item_specifics, no unsupported brands/certifications/compatibility." },
              { role: "user", content: JSON.stringify({ title: titleSource, description: descriptionSource, existing_specifics: draft.item_specifics, variation_axes: axes, category_id: draft.category_id, error: draft.audit_reason }) },
            ],
          }),
        });
        const json = await res.json();
        aiOut = JSON.parse(json.choices?.[0]?.message?.content || "{}");
      } catch { aiOut = {}; }
    }

    const fallbackOut = fallback(titleSource, descriptionSource);
    const title = cleanText(aiOut.title, titleSource).slice(0, 80) || fallbackOut.title;
    const description = cleanText(aiOut.description, descriptionSource) || fallbackOut.description;
    const bulletFeatures = (Array.isArray(aiOut.bullet_features) ? aiOut.bullet_features : fallbackOut.bullet_features)
      .map((b: unknown) => shortAspect("Features", b))
      .filter(Boolean)
      .slice(0, 8);
    const itemSpecifics = sanitizeSpecifics({ ...draft.item_specifics, ...(aiOut.item_specifics || {}), Brand: aiOut.brand || draft.brand || "Unbranded", Model: aiOut.model || draft.model || "Does not apply" }, variants.length > 1 ? axes : []);
    if (bulletFeatures.length) itemSpecifics.Features = shortAspect("Features", bulletFeatures.join(", "));

    const patch = {
      title,
      description,
      bullet_features: bulletFeatures,
      item_specifics: itemSpecifics,
      brand: itemSpecifics.Brand,
      model: itemSpecifics.Model,
      images: baseImages,
      status: "pending",
      audit_reason: baseImages.length ? "AI repaired CJ data into eBay format. Retry push." : "AI repaired text/specs, but a valid image URL is still required before push.",
      profit: { ...(draft.profit || {}), start_country: (draft.profit?.start_country || (cjDetail as any)?.countryCode || (cjDetail as any)?.countryFrom || "CN").toString().toUpperCase().slice(0, 2), product_key: cjDetail?.productKeyEn || draft.profit?.product_key || null, variant_axes: axes, variant_group: variants.length > 1 ? { variants } : draft.profit?.variant_group || null, cj_refresh_cached_at: cjDetail ? new Date().toISOString() : draft.profit?.cj_refresh_cached_at || null },
    };

    await context.supabase.from("listing_drafts").update(patch).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `Repaired eBay draft data: ${title}`, metadata: { draftId: draft.id, images: baseImages.length, variants: variants.length, axes } });
    return patch;
  });