import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
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
    const specifics = { Condition: "New", Brand: out.brand || draft.brand || "Unbranded", ...(out.item_specifics || {}), Model: out.model || draft.model || "Does not apply" };
    const update = {
      title: cleanText(out.title, draft.title).slice(0, 80),
      description: cleanText(out.description, fallback(draft.title, draft.description).description),
      bullet_features: Array.isArray(out.bullet_features) ? out.bullet_features.map((b: unknown) => cleanText(b)).filter(Boolean).slice(0, 8) : [],
      item_specifics: specifics,
      brand: out.brand || "Unbranded",
      model: out.model || "Does not apply",
    };
    await context.supabase.from("listing_drafts").update(update).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `Optimized draft: ${update.title}`, metadata: { draftId: draft.id } });
    return update;
  });