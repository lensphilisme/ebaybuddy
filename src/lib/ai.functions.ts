import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

function fallback(title: string, description = "") {
  const text = `${title} ${description}`.toLowerCase();
  const specifics: Record<string, string> = { Condition: "New", Type: title.split(" ").slice(0, 3).join(" ") };
  if (text.includes("wireless")) specifics.Connectivity = "Wireless";
  if (text.includes("led")) specifics.Lighting = "LED";
  if (text.includes("cotton")) specifics.Material = "Cotton";
  return { title: title.slice(0, 80), bullet_features: title.split(/[,.|-]/).slice(0, 5).map((s) => s.trim()).filter(Boolean), item_specifics: specifics, brand: "Unbranded", model: "Does not apply" };
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
              { role: "system", content: "Return strict JSON for an eBay listing: title <=80 chars, bullet_features array, item_specifics object, brand, model. Optimize for search clicks without unsupported claims." },
              { role: "user", content: JSON.stringify({ title: draft.title, description: draft.description, category_id: draft.category_id }) },
            ],
          }),
        });
        const json = await res.json();
        out = JSON.parse(json.choices?.[0]?.message?.content || JSON.stringify(out));
      } catch {
        out = fallback(draft.title, draft.description);
      }
    }
    const update = { title: String(out.title || draft.title).slice(0, 80), bullet_features: out.bullet_features || [], item_specifics: out.item_specifics || {}, brand: out.brand || "Unbranded", model: out.model || null };
    await context.supabase.from("listing_drafts").update(update).eq("id", draft.id);
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `Optimized draft: ${update.title}`, metadata: { draftId: draft.id } });
    return update;
  });