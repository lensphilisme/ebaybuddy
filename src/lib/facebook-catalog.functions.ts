// Facebook Shop catalog — selection data (list + toggle).
//
// The catalog itself lives in public.facebook_catalog_items (seeded
// from the Lisays Beauty Medusa storefront with only the 6 real
// products; the auto-sync adds new store products switched OFF — the
// 23 dummy store products arrive OFF too and never enter the feed
// until a human ticks them on). The public feed endpoint
// /api/facebook-catalog serves the INCLUDED rows; these functions are
// the selection UI behind it. Toggling a product updates
// the feed immediately — the next scheduled Facebook fetch picks it up.
// Nothing here posts anything to Facebook.
//
// AUTO-SYNC: syncCatalogFromMedusa pulls the store's product list from
// the Medusa Store API and mirrors it into the table. New products are
// ALWAYS inserted OFF (included=false) — nothing new ever enters the
// feed until the user ticks it on. Existing rows get their
// title/description/link/image/variants refreshed, but `included` and
// `is_test` are never changed by a sync. The Medusa publishable key
// comes from env (MEDUSA_PUBLISHABLE_KEY, server-side only) and is
// never hardcoded; without it the sync returns a plain-language
// message and changes nothing.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getMedusaPublishableKey, runCatalogSync, type CatalogSyncDb, type CatalogSyncRow } from "@/lib/medusa-catalog";

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

/**
 * Pull the store's products from Medusa and mirror them into the
 * catalog table. New products arrive OFF (included=false) — they show
 * in the list with a "New from store" badge but never enter the feed
 * until ticked. Existing products get refreshed prices/titles/images;
 * their `included` and `is_test` values are never touched. Returns a
 * plain-language summary; a missing key or a failed store fetch
 * changes nothing and returns ok:false with the reason.
 */
export const syncCatalogFromMedusa = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const db: CatalogSyncDb = {
      listExisting: async () => {
        const { data, error } = await context.supabase
          .from("facebook_catalog_items")
          .select("medusa_handle, included, is_test, title, description, link, image_link, variants");
        if (error) throw error;
        return data || [];
      },
      insertNew: async (rows) => {
        const { error } = await context.supabase.from("facebook_catalog_items").insert(rows);
        if (error) throw error;
      },
      updateExisting: async (handle: string, patch: CatalogSyncRow) => {
        const { error } = await context.supabase.from("facebook_catalog_items").update(patch).eq("medusa_handle", handle);
        if (error) throw error;
      },
    };
    return runCatalogSync({ apiKey: getMedusaPublishableKey(), db });
  });
