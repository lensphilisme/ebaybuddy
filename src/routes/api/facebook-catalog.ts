import { createFileRoute } from "@tanstack/react-router";
import { buildFacebookCatalogCsv, normalizeCatalogItem } from "@/lib/facebook-catalog";

// Public Facebook catalog feed — NO auth on purpose: Facebook's
// scheduled-feed fetcher has no login, so it must be able to read this
// URL. It only ever serves the INCLUDED rows of
// public.facebook_catalog_items — new store products (dummies included)
// arrive switched OFF via the auto-sync and are never served until a
// human ticks them on. It reads through the service-role client server-side; the data served is public
// product info (title, price, image, store link), the same as the
// public storefront. Nothing here posts to Facebook — Commerce Manager
// pulls this URL on a schedule the user sets there.
export const Route = createFileRoute("/api/facebook-catalog")({ server: { handlers: {
  GET: async () => {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data, error } = await supabaseAdmin.from("facebook_catalog_items").select("*").eq("included", true).order("title", { ascending: true });
      if (error) throw error;
      const csv = buildFacebookCatalogCsv((data || []).map(normalizeCatalogItem));
      return new Response(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Cache-Control": "no-store",
          "Content-Disposition": 'inline; filename="facebook-catalog.csv"',
        },
      });
    } catch {
      console.error(JSON.stringify({ svc: "facebook-catalog-feed", error: "feed_failed" }));
      return new Response("Catalog feed unavailable", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
  },
} } });
