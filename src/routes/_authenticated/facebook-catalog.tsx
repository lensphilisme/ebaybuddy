import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listFacebookCatalogItems, setFacebookCatalogIncluded } from "@/lib/facebook-catalog.functions";
import { FACEBOOK_CATALOG_FEED_PATH, catalogFeedRowCount, catalogItemPriceLabel, normalizeCatalogItem } from "@/lib/facebook-catalog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Copy, LayoutList, Loader2, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/facebook-catalog")({ head: () => pageHead("Facebook Catalog", "Pick which Lisays Beauty products go to your Facebook Shop — Facebook pulls the feed automatically."), component: FacebookCatalogPage });

function FacebookCatalogPage() {
  const listFn = useServerFn(listFacebookCatalogItems);
  const toggleFn = useServerFn(setFacebookCatalogIncluded);
  const [feedUrl, setFeedUrl] = useState("");

  // The feed URL depends on where the app is deployed, so build it from
  // the live origin in the browser (avoids hardcoding a domain that
  // changes when the store moves to its real domain).
  useEffect(() => {
    setFeedUrl(`${window.location.origin}${FACEBOOK_CATALOG_FEED_PATH}`);
  }, []);

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["facebook-catalog-items"],
    queryFn: () => listFn(),
  });
  const items = rows.map(normalizeCatalogItem);
  const rowCount = catalogFeedRowCount(items);
  const includedCount = items.filter((i: any) => i.included).length;

  const toggle = useMutation({
    mutationFn: (args: { id: string; included: boolean }) => toggleFn({ data: args }),
    onSuccess: (updated: any) => {
      toast.success(updated?.included ? `Added to the Facebook feed: ${updated?.title || ""}` : `Removed from the Facebook feed: ${updated?.title || ""}`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function copyFeedUrl() {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      toast.success("Feed URL copied — paste it into Commerce Manager");
    } catch {
      toast.error("Could not copy — long-press the URL to copy it manually");
    }
  }

  return (
    <AppShell title="Facebook Catalog" subtitle="Pick which Lisays Beauty products go to your Facebook Shop — Facebook pulls this feed automatically">
      <div className="space-y-6">
        {/* How the feed works: the app SERVES the catalog, Facebook PULLS
            it. There is no Facebook push API for a third-party app, so
            nothing here posts to Facebook — Commerce Manager fetches this
            feed on the schedule the user sets there. */}
        <Card className="p-4 sm:p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <Store className="h-5 w-5 shrink-0 text-primary mt-0.5" />
            <div className="min-w-0 space-y-2 text-sm">
              <p className="font-medium">This page is the switchboard. Facebook pulls your product list from the feed URL below — tick a product and it appears in your Shop on the next fetch; untick it and it drops out.</p>
              <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                <li>Tick the products you want in your Facebook Shop below (only your real products are listed here — the dummy cosmetics from the store are never included).</li>
                <li>Copy the feed URL and open Facebook Commerce Manager → your catalog → Data sources → Add a scheduled feed.</li>
                <li>Paste the URL, set it to fetch daily, and save. Facebook will pull the products in — no re-uploading, ever.</li>
                <li>Checkout happens on your own store website (Facebook Shops send buyers to your site to pay), so prices here always match the store.</li>
              </ol>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-6 shadow-[var(--shadow-card)]">
          <div className="text-sm font-medium mb-2">Your catalog feed URL</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              readOnly
              value={feedUrl || "Loading…"}
              aria-label="Facebook catalog feed URL"
              className="flex-1 min-w-0 rounded-md border border-input bg-muted px-3 py-2 text-sm"
              onFocus={(e) => e.target.select()}
            />
            <Button onClick={copyFeedUrl} disabled={!feedUrl}>
              <Copy className="h-4 w-4 mr-1" /> Copy URL
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {items.length === 0
              ? "No catalog items yet — the feed will be empty until the catalog is set up."
              : `Feed currently has ${rowCount} item${rowCount === 1 ? "" : "s"} from ${includedCount} product${includedCount === 1 ? "" : "s"}.`}
            {" "}Anyone with this link can read your public product list (title, price, photo, store link) — the same info already on your storefront.
          </p>
        </Card>

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          {isLoading ? (
            <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : items.length === 0 ? (
            <div className="p-6"><EmptyState icon={LayoutList} title="No catalog items yet" help="The catalog table has no products — the Facebook catalog migration has not been applied yet. Apply it in the Supabase dashboard, then come back here." /></div>
          ) : (
            <div className="divide-y">
              {items.map((item: any) => (
                <div key={item.id || item.medusa_handle} className="grid grid-cols-[auto_52px_1fr_auto] items-center gap-2 p-2">
                  <Checkbox
                    checked={item.included}
                    disabled={toggle.isPending}
                    aria-label={`Include ${item.title} in the Facebook feed`}
                    onCheckedChange={(checked) => {
                      if (item.id) toggle.mutate({ id: item.id, included: checked === true });
                    }}
                  />
                  {item.image_link ? (
                    <img src={item.image_link} alt={item.title} className="h-12 w-12 rounded-md object-cover bg-muted" />
                  ) : (
                    <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center"><Store className="h-5 w-5 text-muted-foreground" /></div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <span className="font-semibold text-sm line-clamp-2 leading-snug">{item.title}</span>
                      {item.is_test && (
                        <Badge className="bg-amber-500/10 text-amber-700 shrink-0">TEST — remove later</Badge>
                      )}
                      {!item.included && (
                        <Badge variant="secondary" className="shrink-0">Not in feed</Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span>{catalogItemPriceLabel(item)}</span>
                      <span>{item.variants.length} variant{item.variants.length === 1 ? "" : "s"}</span>
                      <span>New</span>
                      <span>Lisays Beauty</span>
                    </div>
                    {item.is_test && (
                      <p className="mt-0.5 text-xs text-amber-700">Test product — it is in the feed for testing only. Uncheck it here when you are done testing and it drops out of the Shop.</p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground px-1">{catalogFeedRowCount([item])} feed row{catalogFeedRowCount([item]) === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
