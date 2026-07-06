import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { optimizeDraftWithAi, repairDraftForEbay } from "@/lib/ai.functions";
import { aiDeepCategorySuggest, pushDraftsToEbay, suggestEbayCategories } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileEdit, Loader2, MoreHorizontal, Rocket, Search, Sparkles, Wrench } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/drafts")({ component: DraftsPage });

function DraftsPage() {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const optimizeFn = useServerFn(optimizeDraftWithAi);
  const repairFn = useServerFn(repairDraftForEbay);
  const suggestFn = useServerFn(suggestEbayCategories);
  const pushFn = useServerFn(pushDraftsToEbay);
  const aiCatFn = useServerFn(aiDeepCategorySuggest);

  const { data: drafts = [], refetch, isLoading } = useQuery({
    queryKey: ["listing-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_drafts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  const failedIds = useMemo(() => drafts.filter((d: any) => d.status === "failed").map((d: any) => d.id), [drafts]);

  const optimize = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await optimizeFn({ data: { draftId: id } });
    },
    onSuccess: () => { toast.success("AI item specifics filled"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const repair = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await repairFn({ data: { draftId: id } });
    },
    onSuccess: () => { toast.success("AI repaired CJ data for eBay"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggest = useMutation({
    mutationFn: async (draft: any) => ({ id: draft.id, rows: await suggestFn({ data: { q: draft.title } }) }),
    onSuccess: ({ id, rows }) => setSuggestions((s) => ({ ...s, [id]: rows })),
    onError: (e: Error) => toast.error(e.message),
  });

  const aiSuggest = useMutation({
    mutationFn: async (draft: any) => ({ id: draft.id, rows: await aiCatFn({ data: { title: draft.title, description: draft.description, hint: draft.category_id } }) }),
    onSuccess: ({ id, rows }: any) => { setSuggestions((s) => ({ ...s, [id]: rows })); toast.success("AI picked best-fit eBay categories"); },
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
        <Button disabled={!selectedIds.length || repair.isPending} onClick={() => repair.mutate(selectedIds)}><Wrench className="h-4 w-4 mr-1" />AI repair eBay data</Button>
        <Button disabled={!failedIds.length || repair.isPending} variant="outline" onClick={() => repair.mutate(failedIds)}><Wrench className="h-4 w-4 mr-1" />Repair failed drafts</Button>
        <Button disabled={!selectedIds.length || push.isPending} onClick={() => push.mutate(selectedIds)}><Rocket className="h-4 w-4 mr-1" />Push selected to eBay</Button>
      </div>
      <Card className="overflow-hidden">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : drafts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground"><FileEdit className="h-8 w-8 mx-auto mb-2" />No drafts yet. Select products from CJ research and send them here.</div>
        ) : (
          <Table className="w-full table-fixed">
            <TableHeader><TableRow>
              <TableHead className="w-10" />
              <TableHead>Product</TableHead>
              <TableHead className="w-20">Price</TableHead>
              <TableHead className="w-56 hidden md:table-cell">eBay category</TableHead>
              <TableHead className="w-28">Status</TableHead>
              <TableHead className="w-12 text-right" />
            </TableRow></TableHeader>
            <TableBody>{drafts.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell><Checkbox checked={!!selected[d.id]} onCheckedChange={(v) => setSelected((s) => ({ ...s, [d.id]: !!v }))} /></TableCell>
                <TableCell className="max-w-0">
                  <div className="flex gap-3 min-w-0">
                    <img src={(Array.isArray(d.images) ? d.images[0] : undefined) || ""} className="h-12 w-12 shrink-0 rounded object-cover bg-muted" />
                    <div className="min-w-0">
                      <div className="font-medium line-clamp-2 break-words">{d.title}</div>
                      <div className="md:hidden mt-1"><Input value={d.category_id || ""} onChange={(e) => updateDraft(d.id, { category_id: e.target.value })} placeholder="eBay category ID" className="h-8 text-xs" /></div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>${Number(d.price).toFixed(2)}</TableCell>
                <TableCell className="hidden md:table-cell">
                  <Input value={d.category_id || ""} onChange={(e) => updateDraft(d.id, { category_id: e.target.value })} placeholder="Required" className="h-8" />
                  {suggestions[d.id]?.slice(0, 2).map((c) => <button key={c.categoryId} className="block text-left text-xs mt-1 text-primary hover:underline truncate max-w-full" onClick={() => updateDraft(d.id, { category_id: c.categoryId })}>{c.path}</button>)}
                </TableCell>
                <TableCell>
                  <Badge variant={d.status === "failed" ? "destructive" : "secondary"}>{d.status}</Badge>
                  {d.audit_reason && <div className="text-xs text-destructive mt-1 line-clamp-2">{d.audit_reason}</div>}
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Actions</DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => aiSuggest.mutate(d)}>AI pick category</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => suggest.mutate(d)}>eBay category suggest</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => optimize.mutate([d.id])}>AI fill specifics</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => repair.mutate([d.id])}>AI repair for eBay</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => push.mutate([d.id])}>Push to eBay</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
