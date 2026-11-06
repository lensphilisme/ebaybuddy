import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listMarketplaceListings, prepareMarketplaceListing, deleteMarketplaceListing, markMarketplaceListingPosted } from "@/lib/marketplace.functions";
import { getSavedMarketplaceLocationLabel } from "@/lib/marketplace-location";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Store, Trash2, CheckCircle2, Loader2, ExternalLink, MapPin } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/marketplace")({ head: () => pageHead("Marketplace", "Prepare listings for Facebook Marketplace — Muse posts them from chat."), component: MarketplacePage });

function statusBadge(status: string) {
  if (status === "posted") return <Badge className="bg-success/10 text-success shrink-0">Posted</Badge>;
  if (status === "draft") return <Badge variant="secondary" className="shrink-0">Draft</Badge>;
  return <Badge className="bg-amber-500/10 text-amber-700 shrink-0">Ready to post</Badge>;
}

function MarketplacePage() {
  const [draftId, setDraftId] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const listFn = useServerFn(listMarketplaceListings);
  const prepareFn = useServerFn(prepareMarketplaceListing);
  const deleteFn = useServerFn(deleteMarketplaceListing);
  const markPostedFn = useServerFn(markMarketplaceListingPosted);
  const locationLabel = getSavedMarketplaceLocationLabel();

  const { data: rows = [], refetch, isLoading } = useQuery({
    queryKey: ["marketplace-listings"],
    queryFn: () => listFn(),
  });
  // Pending eBay drafts are the source for "Prepare from a draft" — the
  // Marketplace row reuses the draft's title, price, description and
  // photos, so preparing is one click.
  const { data: drafts = [] } = useQuery({
    queryKey: ["marketplace-pending-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_drafts").select("id,title,price").eq("status", "pending").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const prepare = useMutation({
    mutationFn: () => prepareFn({ data: { draftId, locationLabel } }),
    onSuccess: (row: any) => {
      toast.success(`Prepared for Marketplace — ready to post: ${row?.title || ""}`);
      setDraftId("");
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Marketplace listing removed"); setConfirmDeleteId(null); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const markPosted = useMutation({
    mutationFn: (id: string) => markPostedFn({ data: { id } }),
    onSuccess: () => { toast.success("Marked as posted — tell Muse the Facebook link and it will be attached"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Marketplace" subtitle="Prepare listings for Facebook Marketplace — Muse posts them from chat">
      <div className="space-y-6">
        {/* How posting works: the app PREPARES, the agent POSTS. Facebook
            has no open posting API, so the app can never publish itself —
            the banner says so plainly, so nobody waits for a "Publish"
            button that cannot exist. */}
        <Card className="p-4 sm:p-6 shadow-[var(--shadow-card)]">
          <div className="flex items-start gap-3">
            <Store className="h-5 w-5 shrink-0 text-primary mt-0.5" />
            <div className="min-w-0 space-y-2 text-sm">
              <p className="font-medium">Listings are prepared here. To post one, ask Muse in chat — each post shows you an approval first.</p>
              <ol className="list-decimal ml-4 space-y-1 text-muted-foreground">
                <li>Prepare a listing below (title, price, photos, category and location are filled in from the draft).</li>
                <li>Ask Muse in chat to post it, e.g. “Post my Marketplace listing ‘Dog Bed’”.</li>
                <li>Muse posts it with the Facebook tool and shows you an approval card first — nothing goes live without your tap. Facebook posting is per item (no bulk API).</li>
                <li>After it is posted, mark it “Posted” here so the queue stays true.</li>
              </ol>
              <p className="flex flex-wrap items-center gap-1 text-muted-foreground">
                <MapPin className="h-3.5 w-3.5" /> Posting location: <span className="font-medium text-foreground">{locationLabel}</span> — change it in Settings.
              </p>
            </div>
          </div>
        </Card>

        <Card className="p-4 sm:p-6 shadow-[var(--shadow-card)]">
          <div className="text-sm font-medium mb-2">Prepare from a draft</div>
          <div className="flex flex-col sm:flex-row gap-2">
            <Select value={draftId} onValueChange={setDraftId}>
              <SelectTrigger className="flex-1" aria-label="Pick a pending draft"><SelectValue placeholder={drafts.length ? "Pick a pending draft…" : "No pending drafts — send a CJ product to Drafts first"} /></SelectTrigger>
              <SelectContent>
                {drafts.map((d: any) => (
                  <SelectItem key={d.id} value={d.id}>{d.title} — ${Number(d.price || 0).toFixed(2)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => prepare.mutate()} disabled={!draftId || prepare.isPending}>
              {prepare.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Store className="h-4 w-4 mr-1" />}
              {prepare.isPending ? "Preparing…" : "Prepare"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">The prepared listing reuses the draft's price (the same final sell price as eBay), description and photos. Condition is always “New” — CJ goods are new.</p>
        </Card>

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          {isLoading ? (
            <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : rows.length === 0 ? (
            <div className="p-6"><EmptyState icon={Store} title="No Marketplace listings yet" help="Prepare one from a draft above, or from a draft row or a CJ product page." /></div>
          ) : (
            <div className="divide-y">
              {rows.map((r: any) => {
                const photo = Array.isArray(r.photos) ? r.photos[0] : "";
                return (
                  <div key={r.id} className="grid grid-cols-[52px_1fr_auto] items-center gap-2 p-2">
                    {photo ? (
                      <img src={photo} alt={r.title || "Marketplace listing"} className="h-12 w-12 rounded-md object-cover bg-muted" />
                    ) : (
                      <div className="h-12 w-12 rounded-md bg-muted flex items-center justify-center"><Store className="h-5 w-5 text-muted-foreground" /></div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm line-clamp-2 leading-snug">{r.title}</span>
                        {statusBadge(r.status)}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>${Number(r.price || 0).toFixed(2)}</span>
                        <span>{r.fb_category}</span>
                        <span>New</span>
                        {r.location_label && <span>{r.location_label}</span>}
                        {r.fb_listing_url && (
                          <a href={r.fb_listing_url} target="_blank" rel="noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                            View on Facebook <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {r.status === "ready" && (
                        <Button size="sm" variant="outline" disabled={markPosted.isPending} title="Use this after Muse posts it in chat — tell Muse the Facebook link and it will be attached." onClick={() => markPosted.mutate(r.id)}>
                          <CheckCircle2 className="h-4 w-4 mr-1" />Mark as posted
                        </Button>
                      )}
                      {r.status === "posted" ? (
                        <span className="text-xs text-muted-foreground px-2" title="Posted listings live on Facebook — delete them there, not here.">Delete on Facebook</span>
                      ) : (
                        <Button size="sm" variant="ghost" disabled={remove.isPending} title="Removes this prepared listing. Posted listings cannot be deleted here." onClick={() => setConfirmDeleteId(r.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <AlertDialog open={confirmDeleteId !== null} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this prepared listing?</AlertDialogTitle>
            <AlertDialogDescription>This removes the prepared Marketplace listing from the queue. It was never posted, so nothing changes on Facebook.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDeleteId) remove.mutate(confirmDeleteId); }}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
