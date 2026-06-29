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
  const sync = useMutation({ mutationFn: () => syncFn({ data: { entriesPerPage: 100 } }), onSuccess: (r: any) => { toast.success(`Synced ${r.items?.length || 0} of ${r.total || 0} active listings`); refetch(); }, onError: (e: Error) => toast.error(e.message) });
  return <AppShell title="Active listings" subtitle="Your live eBay listings, synced from your connected account">
    <div className="mb-4"><Button onClick={() => sync.mutate()} disabled={sync.isPending}><DownloadCloud className="h-4 w-4 mr-1" />{sync.isPending ? "Syncing…" : "Sync from eBay"}</Button></div>
    <Card className="overflow-hidden">{isLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : <Table><TableHeader><TableRow><TableHead>Item</TableHead><TableHead>SKU</TableHead><TableHead>Price</TableHead><TableHead>Sales</TableHead><TableHead>Watch/views</TableHead><TableHead>Status</TableHead></TableRow></TableHeader><TableBody>{data.map((l: any) => <TableRow key={l.id}><TableCell><a className="font-medium hover:underline" href={l.ebay_item_id ? `https://www.ebay.com/itm/${l.ebay_item_id}` : undefined} target="_blank" rel="noreferrer">{l.title}</a><div className="text-xs text-muted-foreground">{l.ebay_item_id}</div></TableCell><TableCell>{l.sku}</TableCell><TableCell>${Number(l.price).toFixed(2)}</TableCell><TableCell>{l.sales}</TableCell><TableCell>{l.views}</TableCell><TableCell>{l.status}</TableCell></TableRow>)}</TableBody></Table>}</Card>
  </AppShell>;
}
