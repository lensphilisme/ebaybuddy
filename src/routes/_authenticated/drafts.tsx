import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { optimizeDraftWithAi } from "@/lib/ai.functions";
import { aiDeepCategorySuggest, pushDraftsToEbay, suggestEbayCategories } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileEdit, Loader2, Rocket, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/drafts")({ component: DraftsPage });

function DraftsPage() {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const optimizeFn = useServerFn(optimizeDraftWithAi);
  const suggestFn = useServerFn(suggestEbayCategories);
  const pushFn = useServerFn(pushDraftsToEbay);

  const { data: drafts = [], refetch, isLoading } = useQuery({
    queryKey: ["listing-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_drafts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);

  const optimize = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await optimizeFn({ data: { draftId: id } });
    },
    onSuccess: () => { toast.success("AI item specifics filled"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggest = useMutation({
    mutationFn: async (draft: any) => ({ id: draft.id, rows: await suggestFn({ data: { q: draft.title } }) }),
    onSuccess: ({ id, rows }) => setSuggestions((s) => ({ ...s, [id]: rows })),
    onError: (e: Error) => toast.error(e.message),
  });

  const push = useMutation({
    mutationFn: async (ids: string[]) => pushFn({ data: { draftIds: ids } }),
    onSuccess: (rows: any[]) => { toast.success(`Pushed ${rows.filter((r) => r.ok).length}/${rows.length} draft(s)`); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function updateDraft(id: string, patch: any) {
    const { error } = await supabase.from("listing_drafts").update(patch).eq("id", id);
    if (error) toast.error(error.message); else refetch();
  }

  return (
    <AppShell title="Drafts" subtitle="Review, optimize and bulk-push CJ products to eBay">
      <div className="mb-4 flex flex-wrap gap-2">
        <Button asChild variant="outline"><Link to="/products"><Search className="h-4 w-4 mr-1" />Research CJ products</Link></Button>
        <Button disabled={!selectedIds.length || optimize.isPending} onClick={() => optimize.mutate(selectedIds)}><Sparkles className="h-4 w-4 mr-1" />AI optimize selected</Button>
        <Button disabled={!selectedIds.length || push.isPending} onClick={() => push.mutate(selectedIds)}><Rocket className="h-4 w-4 mr-1" />Push selected to eBay</Button>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : drafts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground"><FileEdit className="h-8 w-8 mx-auto mb-2" />No drafts yet. Select products from CJ research and send them here.</div>
        ) : (
          <Table>
            <TableHeader><TableRow><TableHead /><TableHead>Product</TableHead><TableHead>Price</TableHead><TableHead>eBay category</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>{drafts.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell><Checkbox checked={!!selected[d.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [d.id]: !!v }))} /></TableCell>
                <TableCell className="max-w-md"><div className="flex gap-3"><img src={(Array.isArray(d.images) ? d.images[0] : undefined) || ""} className="h-14 w-14 rounded object-cover bg-muted" /><div><div className="font-medium line-clamp-2">{d.title}</div><div className="text-xs text-muted-foreground">{d.sku}</div></div></div></TableCell>
                <TableCell>${Number(d.price).toFixed(2)}</TableCell>
                <TableCell className="min-w-64"><Input value={d.category_id || ""} onChange={(e) => updateDraft(d.id, { category_id: e.target.value })} placeholder="Required category ID" />{suggestions[d.id]?.slice(0, 3).map((c) => <button key={c.categoryId} className="block text-left text-xs mt-1 text-primary hover:underline" onClick={() => updateDraft(d.id, { category_id: c.categoryId })}>{c.path}</button>)}</TableCell>
                <TableCell><Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{d.status}</Badge>{d.audit_reason && <div className="text-xs text-destructive mt-1">{d.audit_reason}</div>}</TableCell>
                <TableCell className="text-right space-x-2"><Button size="sm" variant="outline" onClick={() => suggest.mutate(d)}>Suggest category</Button><Button size="sm" variant="outline" onClick={() => optimize.mutate([d.id])}>AI fill</Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
