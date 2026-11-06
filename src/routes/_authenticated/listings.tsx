import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncEbayListings, endEbayListing } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DownloadCloud, Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export const Route = createFileRoute("/_authenticated/listings")({ head: () => pageHead("eBay listings", "Browse and sync Inventory-managed eBay listings."), component: ListingsPage });

function ListingsPage() {
  const [page, setPage] = useState(0);
  const [endId, setEndId] = useState<string | null>(null);
  const syncFn = useServerFn(syncEbayListings);
  const endFn = useServerFn(endEbayListing);
  const { data = [], refetch, isLoading } = useQuery({ queryKey: ["ebay-listings"], queryFn: async () => {
    const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: false });
    if (error) throw error; return data || [];
  }});
  const rows = Array.from(new Map(data.map((l: any) => [l.ebay_item_id || l.id, l])).values());
  const sync = useMutation({ mutationFn: () => syncFn({ data: { entriesPerPage: 200 } }), onSuccess: (r: any) => { toast.success(`Synced ${r.synced || 0} of ${r.total || 0} active listings`); refetch(); }, onError: (e: Error) => toast.error(e.message) });
  const end = useMutation({ mutationFn: (id: string) => endFn({ data: { listingId: id } }), onSuccess: () => { toast.success("Listing ended"); setEndId(null); refetch(); }, onError: (e: Error) => toast.error(e.message) });
  return <AppShell title="Active listings" subtitle="Your live eBay listings, synced from your connected account">
    <div className="mb-4 flex items-center justify-between flex-wrap gap-3"><Button onClick={() => sync.mutate()} disabled={sync.isPending}><DownloadCloud className="h-4 w-4 mr-1" />{sync.isPending ? "Syncing…" : "Sync all from eBay"}</Button><div className="text-sm text-muted-foreground">{rows.length} listing{rows.length === 1 ? "" : "s"} stored</div></div>
    <p className="text-xs text-muted-foreground mb-4">Sales and views are 30-day numbers from eBay Analytics — they refresh when you sync. "—" means traffic has never been fetched for that listing.</p>
    <Card className="overflow-hidden">
      {isLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : rows.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">No synced listings yet. Click <strong>Sync all from eBay</strong> to pull your active inventory.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="w-16" /><TableHead>Item</TableHead><TableHead className="hidden sm:table-cell">SKU</TableHead><TableHead>Price</TableHead><TableHead className="hidden md:table-cell">Sales (30d)</TableHead><TableHead className="hidden md:table-cell">Views (30d)</TableHead><TableHead>Status</TableHead><TableHead className="w-10" /></TableRow></TableHeader>
            <TableBody>{rows.slice(page * 50, (page + 1) * 50).map((l: any) => {
              const img = Array.isArray(l.images) ? l.images[0] : l.image_url || l.thumbnail_url;
              return (
                <TableRow key={l.id}>
                  <TableCell><div className="h-12 w-12 rounded bg-muted overflow-hidden">{img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</div></TableCell>
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
    <div className="mt-4 flex items-center justify-between"><span className="text-sm text-muted-foreground">Page {page + 1} of {Math.max(1, Math.ceil(rows.length / 50))}</span><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous listings" disabled={page === 0} onClick={() => setPage(page - 1)}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Next listings" disabled={(page + 1) * 50 >= rows.length} onClick={() => setPage(page + 1)}><ChevronRight className="h-4 w-4" /></Button></div></div>
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
