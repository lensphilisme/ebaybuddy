import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SyncButton } from "@/components/sync-button";
import { EmptyState } from "@/components/empty-state";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncEbayListings, endEbayListing, listEndedEbayOffers, relistEndedListing } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, MoreHorizontal, RotateCcw, Tag } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/listings")({ head: () => pageHead("Listings", "Browse and sync Inventory-managed eBay listings."), component: ListingsPage });

function ListingsPage() {
  const [page, setPage] = useState(0);
  const [endId, setEndId] = useState<string | null>(null);
  const [tab, setTab] = useState("active");
  const syncFn = useServerFn(syncEbayListings);
  const endFn = useServerFn(endEbayListing);
  const endedFn = useServerFn(listEndedEbayOffers);
  const relistFn = useServerFn(relistEndedListing);
  const { data = [], refetch, isLoading } = useQuery({ queryKey: ["ebay-listings"], queryFn: async () => {
    const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: false });
    if (error) throw error; return data || [];
  }});
  const rows = Array.from(new Map(data.map((l: any) => [l.ebay_item_id || l.id, l])).values());
  const { data: ended = [], refetch: refetchEnded, isLoading: endedLoading } = useQuery({
    queryKey: ["ebay-ended-offers"],
    enabled: tab === "ended",
    queryFn: async () => {
      const r: any = await endedFn();
      return r.items || [];
    },
  });
  const sync = useMutation({ mutationFn: () => syncFn({ data: { entriesPerPage: 200 } }), onSuccess: (r: any) => {
    if (r.level === "warn") toast.warning(r.reason || "Sync finished — 0 listings imported.");
    else toast.success(`Synced ${r.synced || 0} of ${r.total || 0} active listings${r.skipped ? ` · ${r.skipped} skipped (bad data)` : ""}`);
    refetch();
  }, onError: (e: Error) => toast.error(e.message) });
  const end = useMutation({ mutationFn: (id: string) => endFn({ data: { listingId: id } }), onSuccess: () => { toast.success("Listing ended"); setEndId(null); refetch(); }, onError: (e: Error) => toast.error(e.message) });
  const relist = useMutation({
    mutationFn: (offer: any) => relistFn({ data: { sku: offer.sku, title: offer.title, categoryId: offer.categoryId || undefined } }),
    onSuccess: (r: any) => { toast.success(`Draft created: ${r.title} — review it in Drafts before pushing.`); refetchEnded(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return <AppShell title="Listings" subtitle="Your live eBay listings, synced from your connected account" actions={<SyncButton onSync={() => sync.mutateAsync()} />}>
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3"><div className="text-sm text-muted-foreground">{`${rows.length} listing${rows.length === 1 ? "" : "s"} stored`}</div></div>
      <p className="text-xs text-muted-foreground">Sales and views are 30-day numbers from eBay Analytics — they refresh when you sync. "—" means traffic has never been fetched for that listing.</p>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="ended">Ended / not live</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">
          <Card className="overflow-hidden shadow-[var(--shadow-card)]">
            {isLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : rows.length === 0 ? (
              <div className="p-6"><EmptyState icon={Tag} title="No synced listings yet" help="Click Sync all from eBay above to pull your active inventory." /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16" /><TableHead>Item</TableHead><TableHead className="hidden sm:table-cell">SKU</TableHead><TableHead>Price</TableHead><TableHead className="hidden md:table-cell">Sales (30d)</TableHead><TableHead className="hidden md:table-cell">Views (30d)</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
                  <TableBody>{rows.slice(page * 50, (page + 1) * 50).map((l: any) => {
                    const img = Array.isArray(l.images) ? l.images[0] : l.image_url || l.thumbnail_url;
                    return (
                      <TableRow key={l.id}>
                        <TableCell><div className="h-12 w-12 rounded bg-muted overflow-hidden">{img ? <img src={img} alt={l.title} className="h-full w-full object-cover" loading="lazy" /> : null}</div></TableCell>
                        <TableCell className="max-w-xs"><a className="font-medium hover:underline line-clamp-2" href={l.ebay_item_id ? `https://www.ebay.com/itm/${l.ebay_item_id}` : undefined} target="_blank" rel="noreferrer">{l.title}</a><div className="text-xs text-muted-foreground">{l.ebay_item_id}</div></TableCell>
                        <TableCell className="hidden sm:table-cell text-xs">{l.sku}</TableCell>
                        <TableCell>${Number(l.price).toFixed(2)}</TableCell>
                        <TableCell className="hidden md:table-cell">{l.last_traffic_check ? (l.sales ?? 0) : "—"}</TableCell>
                        <TableCell className="hidden md:table-cell">{l.last_traffic_check ? (l.views ?? 0) : "—"}</TableCell>
                        <TableCell>{l.status}</TableCell>
                        <TableCell><DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Listing actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem className="text-destructive" onClick={() => setEndId(l.id)}>End listing</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell>
                      </TableRow>
                    );
                  })}</TableBody>
                </Table>
              </div>
            )}
          </Card>
          <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">{`Page ${page + 1} of ${Math.max(1, Math.ceil(rows.length / 50))}`}</span><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous listings" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Next listings" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
        </TabsContent>
        <TabsContent value="ended" className="mt-4">
          <Card className="overflow-hidden shadow-[var(--shadow-card)]">
            {endedLoading ? <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /><p className="mt-3 text-sm text-muted-foreground">Checking your ended listings… this takes a few minutes — the app checks every item in your inventory.</p></div> : ended.length === 0 ? (
              <div className="p-6"><EmptyState icon={RotateCcw} title="No ended listings found" help="eBay marks withdrawn listings as unpublished — this list also includes offers that were never published, because eBay doesn't distinguish the two. Relist creates a draft — it never publishes." /></div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead className="w-16" /><TableHead>Item</TableHead><TableHead className="hidden sm:table-cell">SKU</TableHead><TableHead>Price</TableHead><TableHead className="hidden md:table-cell">Category</TableHead><TableHead className="w-32" /></TableRow></TableHeader>
                  <TableBody>{ended.map((o: any) => (
                    <TableRow key={o.offerId}>
                      <TableCell><div className="h-12 w-12 rounded bg-muted overflow-hidden">{o.imageUrl ? <img src={o.imageUrl} alt={o.title} className="h-full w-full object-cover" loading="lazy" /> : null}</div></TableCell>
                      <TableCell className="max-w-xs"><span className="font-medium line-clamp-2">{o.title}</span><div className="text-xs text-muted-foreground">{o.listingId ? `eBay item ${o.listingId}` : "no listing ID (withdrawn)"}</div></TableCell>
                      <TableCell className="hidden sm:table-cell text-xs">{o.sku}</TableCell>
                      <TableCell>${Number(o.price || 0).toFixed(2)}</TableCell>
                      <TableCell className="hidden md:table-cell text-xs">{o.categoryId || "—"}</TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" disabled={relist.isPending} onClick={() => relist.mutate(o)} title="Rebuilds the draft from the CJ product with a fresh AI title and current pricing rules. Creates a draft only — never publishes.">
                          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Relist
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            )}
          </Card>
          <p className="mt-3 text-xs text-muted-foreground">Relist matches the SKU back to the CJ product and rebuilds the draft with a fresh AI title and the current pricing rules. It only creates a pending draft — you review it in Drafts and push it yourself.</p>
        </TabsContent>
      </Tabs>
    </div>
    <AlertDialog open={endId !== null} onOpenChange={(open) => !open && setEndId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End this listing?</AlertDialogTitle>
          <AlertDialogDescription>It is withdrawn from eBay right away and marked ended here. Buyers can no longer purchase it. This cannot be undone from the app — relist it from the draft if you change your mind.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it listed</AlertDialogCancel>
          <AlertDialogAction onClick={() => endId && end.mutate(endId)}>End listing</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </AppShell>;
}
