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
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle, ChevronDown, FileEdit, Loader2, MoreHorizontal, Rocket, Search, Sparkles, Trash2, Wrench } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/drafts")({ component: DraftsPage });

function truncate(value: unknown, max = 20) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function variantCount(draft: any) {
  const variants = draft?.variants || draft?.variant_group?.variants || draft?.profit?.variants || draft?.profit?.variant_group?.variants || [];
  return Array.isArray(variants) ? variants.length : 0;
}

function profitText(draft: any) {
  const profit = draft?.profit || {};
  const amount = Number(profit.profit ?? profit.desired_profit ?? 0);
  const fee = Number(profit.ebay_fee ?? 0);
  if (!amount && !fee) return "Profit n/a";
  return `$${amount.toFixed(2)} profit${fee ? ` · $${fee.toFixed(2)} fee` : ""}`;
}

function DraftsPage() {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const [editDraft, setEditDraft] = useState<any | null>(null);
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
    mutationFn: async (ids: string[]) => { for (const id of ids) await optimizeFn({ data: { draftId: id } }); },
    onSuccess: () => { toast.success("AI item specifics filled"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const repair = useMutation({
    mutationFn: async (ids: string[]) => { for (const id of ids) await repairFn({ data: { draftId: id } }); },
    onSuccess: () => { toast.success("Draft data repaired for eBay"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggest = useMutation({
    mutationFn: async (draft: any) => ({ id: draft.id, rows: await suggestFn({ data: { q: draft.title } }) }),
    onSuccess: ({ id, rows }) => setSuggestions((s) => ({ ...s, [id]: rows })),
    onError: (e: Error) => toast.error(e.message),
  });

  const aiSuggest = useMutation({
    mutationFn: async (draft: any) => ({ id: draft.id, rows: await aiCatFn({ data: { title: draft.title, description: draft.description, hint: draft.category_id } }) }),
    onSuccess: ({ id, rows }: any) => { setSuggestions((s) => ({ ...s, [id]: rows })); toast.success("Best-fit eBay categories ready"); },
    onError: (e: Error) => toast.error(e.message),
  });

  const push = useMutation({
    mutationFn: async (ids: string[]) => pushFn({ data: { draftIds: ids } }),
    onSuccess: (rows: any[]) => {
      toast.success(`Pushed ${rows.filter((r) => r.ok).length}/${rows.length} draft(s)`);
      setSelected({});
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkDelete = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from("listing_drafts").delete().in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count) => { toast.success(`Deleted ${count} draft${count === 1 ? "" : "s"}`); setSelected({}); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function updateDraft(id: string, patch: any) {
    const { error } = await supabase.from("listing_drafts").update(patch).eq("id", id);
    if (error) toast.error(error.message); else refetch();
  }

  return (
    <AppShell title="Drafts" subtitle="Compact queue for fixing, editing and bulk-pushing to eBay">
      <div className="mb-3 flex flex-wrap gap-2">
        <Button asChild variant="outline" size="sm"><Link to="/products"><Search className="h-4 w-4 mr-1" />Research</Link></Button>
        <Button size="sm" disabled={!selectedIds.length || optimize.isPending} onClick={() => optimize.mutate(selectedIds)}><Sparkles className="h-4 w-4 mr-1" />Optimize</Button>
        <Button size="sm" disabled={!selectedIds.length || repair.isPending} onClick={() => repair.mutate(selectedIds)}><Wrench className="h-4 w-4 mr-1" />Repair</Button>
        <Button size="sm" disabled={!failedIds.length || repair.isPending} variant="outline" onClick={() => repair.mutate(failedIds)}><Wrench className="h-4 w-4 mr-1" />Repair failed</Button>
        <Button size="sm" disabled={!selectedIds.length || push.isPending} onClick={() => push.mutate(selectedIds)}><Rocket className="h-4 w-4 mr-1" />Push</Button>
        <Button size="sm" disabled={!selectedIds.length || bulkDelete.isPending} variant="destructive" onClick={() => bulkDelete.mutate(selectedIds)}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
      </div>

      <Card className="overflow-hidden border shadow-sm">
        {isLoading ? <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : drafts.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground"><FileEdit className="h-8 w-8 mx-auto mb-2" />No drafts yet. Select products from CJ research and send them here.</div>
        ) : (
          <div className="divide-y">
            {drafts.map((d: any) => {
              const checked = !!selected[d.id];
              const image = (Array.isArray(d.images) ? d.images[0] : undefined) || "";
              return (
                <Collapsible key={d.id}>
                  <div className={`grid grid-cols-[42px_52px_1fr_auto] items-center gap-2 p-2 ${checked ? "bg-primary/5" : "bg-card"}`}>
                    <button type="button" onClick={() => setSelected((s) => ({ ...s, [d.id]: !s[d.id] }))} className={`h-6 w-6 rounded-full border text-xs font-bold ${checked ? "bg-primary text-primary-foreground" : "bg-background"}`} aria-label={checked ? "Deselect draft" : "Select draft"}>{checked ? "✓" : ""}</button>
                    <img src={image} alt={d.title || "Draft product"} className="h-12 w-12 rounded-md object-cover bg-muted" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-semibold text-sm truncate">{truncate(d.title, 22)}</span>
                        {d.status === "failed" ? <StatusErrorPopover draft={d} /> : <Badge variant="secondary" className="shrink-0 text-[10px]">{d.status}</Badge>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>${Number(d.price || 0).toFixed(2)}</span>
                        <span>{variantCount(d)} variants</span>
                        <span>{profitText(d)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <CollapsibleTrigger asChild><Button size="icon" variant="ghost" aria-label="Show draft details"><ChevronDown className="h-4 w-4" /></Button></CollapsibleTrigger>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Draft actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Actions</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => setEditDraft(d)}>Edit draft</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => aiSuggest.mutate(d)}>AI pick category</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => suggest.mutate(d)}>eBay category suggest</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => optimize.mutate([d.id])}>AI fill specifics</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => repair.mutate([d.id])}>Repair for eBay</DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => push.mutate([d.id])}>Push to eBay</DropdownMenuItem>
                          <DropdownMenuItem className="text-destructive" onClick={() => bulkDelete.mutate([d.id])}>Delete draft</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <div className="grid gap-3 border-t bg-muted/25 p-3 md:grid-cols-[1fr_280px]">
                      <div className="min-w-0 space-y-2">
                        <div className="text-sm font-medium break-words">{d.title}</div>
                        <div className="line-clamp-3 text-xs text-muted-foreground break-words">{d.description || "No description yet."}</div>
                      </div>
                      <div className="space-y-2">
                        <Input value={d.category_id || ""} onChange={(e) => updateDraft(d.id, { category_id: e.target.value })} placeholder="eBay category ID" className="h-8 text-xs" />
                        {suggestions[d.id]?.slice(0, 3).map((c) => <button key={c.categoryId} className="block w-full truncate text-left text-xs text-primary hover:underline" onClick={() => updateDraft(d.id, { category_id: c.categoryId })}>{c.path}</button>)}
                      </div>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
            })}
          </div>
        )}
      </Card>
      <EditDraftDialog draft={editDraft} onOpenChange={(open) => !open && setEditDraft(null)} onSaved={() => { setEditDraft(null); refetch(); }} />
    </AppShell>
  );
}

function EditDraftDialog({ draft, onOpenChange, onSaved }: { draft: any | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({});

  if (draft && form.id !== draft.id) {
    setForm({
      id: draft.id,
      title: draft.title || "",
      description: draft.description || "",
      price: draft.price || 0,
      category_id: draft.category_id || "",
      brand: draft.brand || "",
      model: draft.model || "",
      images: Array.isArray(draft.images) ? draft.images.join("\n") : "",
      item_specifics: JSON.stringify(draft.item_specifics || {}, null, 2),
    });
  }

  const save = useMutation({
    mutationFn: async () => {
      let specifics = {};
      try { specifics = JSON.parse(form.item_specifics || "{}"); } catch { throw new Error("Item specifics must be valid JSON"); }
      const patch = {
        title: String(form.title || "").slice(0, 80),
        description: String(form.description || "").slice(0, 500000),
        price: Number(form.price || 0),
        category_id: String(form.category_id || "").trim() || null,
        brand: String(form.brand || "").trim() || null,
        model: String(form.model || "").trim() || null,
        images: String(form.images || "").split(/\n+/).map((s) => s.trim()).filter(Boolean),
        item_specifics: specifics,
        status: "pending",
        audit_reason: "Edited manually. Ready to retry push.",
      };
      const { error } = await supabase.from("listing_drafts").update(patch).eq("id", draft.id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Draft saved"); onSaved(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Dialog open={!!draft} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit draft</DialogTitle>
          <DialogDescription>Adjust eBay-ready title, price, category, images and item specifics.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Title</span><Input value={form.title || ""} onChange={(e) => setForm((f: any) => ({ ...f, title: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium">Price</span><Input type="number" step="0.01" value={form.price || ""} onChange={(e) => setForm((f: any) => ({ ...f, price: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium">eBay category ID</span><Input value={form.category_id || ""} onChange={(e) => setForm((f: any) => ({ ...f, category_id: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium">Brand</span><Input value={form.brand || ""} onChange={(e) => setForm((f: any) => ({ ...f, brand: e.target.value }))} /></label>
          <label className="space-y-1"><span className="text-xs font-medium">Model</span><Input value={form.model || ""} onChange={(e) => setForm((f: any) => ({ ...f, model: e.target.value }))} /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Description</span><Textarea rows={5} value={form.description || ""} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))} /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Image URLs, one per line</span><Textarea rows={4} value={form.images || ""} onChange={(e) => setForm((f: any) => ({ ...f, images: e.target.value }))} /></label>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Item specifics JSON</span><Textarea rows={7} className="font-mono text-xs" value={form.item_specifics || ""} onChange={(e) => setForm((f: any) => ({ ...f, item_specifics: e.target.value }))} /></label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save draft"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusErrorPopover({ draft }: { draft: any }) {
  const reason: string = draft.audit_reason || draft.error_message || draft.last_error || "";
  const details = draft.error_details ?? draft.last_error_details ?? draft.audit_details ?? null;
  const failedAt = draft.failed_at || draft.updated_at || draft.last_attempt_at || null;
  let parsedDetails: any = details;
  if (typeof details === "string") try { parsedDetails = JSON.parse(details); } catch { /* keep */ }
  const detailsText = parsedDetails ? (typeof parsedDetails === "string" ? parsedDetails : JSON.stringify(parsedDetails, null, 2)) : "";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="inline-flex items-center rounded-md focus:outline-none focus:ring-2 focus:ring-ring" aria-label="Show error details">
          <Badge variant="destructive" className="cursor-pointer text-[10px]"><AlertCircle className="h-3 w-3 mr-1" />failed<ChevronDown className="h-3 w-3 ml-1" /></Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[92vw] p-0">
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive"><AlertCircle className="h-4 w-4" /> Push failed</div>
          {failedAt && <div className="text-xs text-muted-foreground mt-0.5">{new Date(failedAt).toLocaleString()}</div>}
        </div>
        <div className="p-3 space-y-3 max-h-80 overflow-auto">
          {reason ? <div><div className="text-xs uppercase text-muted-foreground mb-1">Reason</div><div className="text-sm whitespace-pre-wrap break-words">{reason}</div></div> : <div className="text-sm text-muted-foreground">No reason recorded.</div>}
          {detailsText && <div><div className="text-xs uppercase text-muted-foreground mb-1">Details</div><pre className="text-xs bg-muted rounded p-2 whitespace-pre-wrap break-words">{detailsText}</pre></div>}
          <div className="text-xs text-muted-foreground">ID: <span className="font-mono">{draft.id}</span></div>
        </div>
      </PopoverContent>
    </Popover>
  );
}