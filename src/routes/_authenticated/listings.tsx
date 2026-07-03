import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { syncEbayListings } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DownloadCloud, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/listings")({ component: ListingsPage });

function ListingsPage() {
  const syncFn = useServerFn(syncEbayListings);
  const { data = [], refetch, isLoading } = useQuery({ queryKey: ["ebay-listings"], queryFn: async () => {
    const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: false });
    if (error) throw error; return data || [];
  }});
  const sync = useMutation({ mutationFn: () => syncFn({ data: { entriesPerPage: 200 } }), onSuccess: (r: any) => { toast.success(`Synced ${r.synced || 0} of ${r.total || 0} active listings`); refetch(); }, onError: (e: Error) => toast.error(e.message) });
  return <AppShell title="Active listings" subtitle="Your live eBay listings, synced from your connected account">
    <div className="mb-4 flex items-center justify-between flex-wrap gap-3"><Button onClick={() => sync.mutate()} disabled={sync.isPending}><DownloadCloud className="h-4 w-4 mr-1" />{sync.isPending ? "Syncing…" : "Sync all from eBay"}</Button><div className="text-sm text-muted-foreground">{data.length} listing{data.length === 1 ? "" : "s"} stored</div></div>
    <Card className="overflow-hidden">
      {isLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : data.length === 0 ? (
        <div className="p-12 text-center text-sm text-muted-foreground">No synced listings yet. Click <strong>Sync from eBay</strong> to pull your active inventory.</div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead className="w-16" /><TableHead>Item</TableHead><TableHead className="hidden sm:table-cell">SKU</TableHead><TableHead>Price</TableHead><TableHead className="hidden md:table-cell">Sales</TableHead><TableHead className="hidden md:table-cell">Watch</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
            <TableBody>{data.map((l: any) => {
              const img = Array.isArray(l.images) ? l.images[0] : l.image_url || l.thumbnail_url;
              return (
                <TableRow key={l.id}>
                  <TableCell><div className="h-12 w-12 rounded bg-muted overflow-hidden">{img ? <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" /> : null}</div></TableCell>
                  <TableCell className="max-w-xs"><a className="font-medium hover:underline line-clamp-2" href={l.ebay_item_id ? `https://www.ebay.com/itm/${l.ebay_item_id}` : undefined} target="_blank" rel="noreferrer">{l.title}</a><div className="text-xs text-muted-foreground">{l.ebay_item_id}</div></TableCell>
                  <TableCell className="hidden sm:table-cell text-xs">{l.sku}</TableCell>
                  <TableCell>${Number(l.price).toFixed(2)}</TableCell>
                  <TableCell className="hidden md:table-cell">{l.sales}</TableCell>
                  <TableCell className="hidden md:table-cell">{l.views}</TableCell>
                  <TableCell>{l.status}</TableCell>
                </TableRow>
              );
            })}</TableBody>
          </Table>
        </div>
      )}
    </Card>
  </AppShell>;
}
