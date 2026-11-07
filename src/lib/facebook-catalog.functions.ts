// Facebook Shop catalog — selection data (list + toggle).
//
// The catalog itself lives in public.facebook_catalog_items (seeded from
// the Lisays Beauty Medusa storefront — only the 6 real products; the
// 23 dummy store products must never be added here). The public feed
// endpoint /api/facebook-catalog serves the INCLUDED rows; these
// functions are the selection UI behind it. Toggling a product updates
// the feed immediately — the next scheduled Facebook fetch picks it up.
// Nothing here posts anything to Facebook.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** All catalog items (included and excluded), alphabetical by title. */
export const listFacebookCatalogItems = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data, error } = await context.supabase.from("facebook_catalog_items").select("*").order("title", { ascending: true });
    if (error) throw error;
    return data || [];
  });

/** Include or exclude one product from the feed. Test products stay flagged is_test; toggling only changes `included`. */
export const setFacebookCatalogIncluded = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; included: boolean }) => data)
  .handler(async ({ data, context }: any) => {
    if (!data.id || typeof data.included !== "boolean") throw new Error("Pick a product and whether to include it.");
    const { data: updated, error } = await context.supabase
      .from("facebook_catalog_items")
      .update({ included: data.included })
      .eq("id", data.id)
      .select("*")
      .single();
    if (error) throw error;
    return updated;
  });
