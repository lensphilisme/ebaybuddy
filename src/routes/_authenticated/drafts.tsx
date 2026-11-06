import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { CompletenessBadge } from "@/components/completeness-badge";
import { completenessScore } from "@/lib/completeness";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { optimizeDraftCopyWithAi, optimizeDraftWithAi, repairDraftForEbay } from "@/lib/ai.functions";
import { aiDeepCategorySuggest, pushDraftsToEbay, suggestEbayCategories } from "@/lib/ebay.functions";
import { prepareMarketplaceListing } from "@/lib/marketplace.functions";
import { getSavedMarketplaceLocationLabel } from "@/lib/marketplace-location";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AlertCircle, ChevronDown, FileEdit, Loader2, MoreHorizontal, Rocket, Search, Sparkles, Trash2, Wrench } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import { roundMoney } from "@/lib/pricing";

export const Route = createFileRoute("/_authenticated/drafts")({ head: () => pageHead("Drafts", "Edit and repair CJ-to-eBay listing drafts."), component: DraftsPage });

function truncate(value: unknown, max = 60) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

/** Strip HTML (and embedded <img> tags) to clean plain text — descriptions
 * are edited as plain text; images live in the gallery, not the copy. */
function stripHtmlToText(html: unknown): string {
  const raw = String(html ?? "");
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<\/(p|div|li|br|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
}

/**
 * Category ID input that saves debounced (600ms after the last keystroke)
 * instead of firing one Supabase update + full list refetch per character.
 */
function CategoryInput({ draftId, value, onSave }: { draftId: string; value: string; onSave: (id: string, patch: any) => Promise<void> }) {
  const [local, setLocal] = useState(value);
  const [saving, setSaving] = useState(false);
  // Stay in sync when the category changes elsewhere (e.g. the category
  // suggester fills it in) instead of showing a stale value.
  useEffect(() => { setLocal(value); }, [value]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  function change(v: string) {
    setLocal(v);
    setSaving(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void onSave(draftId, { category_id: v }).finally(() => setSaving(false));
    }, 600);
  }
  return (
    <div className="relative">
      <Input value={local} onChange={(e) => change(e.target.value)} placeholder="eBay category ID" className="h-8 text-xs pr-14" aria-label="eBay category ID" />
      <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">{saving ? "Saving…" : local ? "Saved" : ""}</span>
    </div>
  );
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

/** CJ descriptions are third-party HTML: render sanitized HTML, never the
 * raw markup as text (bug 8). Same DOMPurify pattern as the product page.
 * Long descriptions collapse with a "Show more / Show less" toggle. */
function DraftDescription({ html }: { html: string }) {
  const [expanded, setExpanded] = useState(false);
  const clean = useMemo(() => {
    if (!html || typeof window === "undefined") return "";
    // Images live in the gallery, not the description — strip <img> tags.
    return DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ["img"] });
  }, [html]);
  const plainLen = useMemo(() => stripHtmlToText(html).length, [html]);
  if (!html) return <div className="text-xs text-muted-foreground">No description yet.</div>;
  return (
    <div>
      <div className={`${expanded ? "" : "line-clamp-3"} text-xs text-muted-foreground break-words [&_*]:max-w-full [&_img]:h-auto`} dangerouslySetInnerHTML={{ __html: clean }} />
      {plainLen > 240 && (
        <button type="button" className="mt-1 text-xs text-primary hover:underline" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

/**
 * Rank category suggestions so the most relevant leaf is first (bug 16):
 * score by token overlap with the draft title/description, drop
 * suggestions that share nothing with the product when better ones exist,
 * and dedupe identical-looking leaves so two buttons never look the same.
 * The `source` ("AI" / "eBay") and `reason` pass through untouched.
 */
function rankSuggestions(rows: any[], draft: any) {
  const hint = `${draft?.title || ""} ${draft?.description || ""} ${draft?.item_specifics?.Type || ""}`.toLowerCase();
  const tokens = new Set(hint.split(/[^a-z0-9]+/).filter((t) => t.length > 2));
  const scored = (rows || []).map((c) => {
    const path = String(c.path || c.categoryName || "");
    const leaf = path.split(">").map((s) => s.trim()).filter(Boolean).pop() || path;
    const pathTokens = new Set(path.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2));
    let overlap = 0;
    pathTokens.forEach((t) => { if (tokens.has(t)) overlap += 1; });
    return { ...c, path, leaf, overlap };
  });
  const best = Math.max(0, ...scored.map((s) => s.overlap));
  const filtered = best > 0 ? scored.filter((s) => s.overlap > 0) : scored;
  const seen = new Set<string>();
  return filtered
    .sort((a, b) => b.overlap - a.overlap || a.path.length - b.path.length)
    .filter((s) => {
      const key = s.leaf.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Why a push is blocked for one draft (null = pushable). Used by the
 * toolbar button tooltip, the per-draft menu item and the dialog. */
function pushBlockedReason(draft: any, livePushOn: boolean): string | null {
  if (!livePushOn) return "Live push is off in Rules — turn it on to publish";
  if (!draft.category_id) return "No eBay category — pick one first";
  if (!(Number(draft.profit?.shipping) > 0)) return "No shipping quote — get a shipping quote first, the price needs real freight";
  return null;
}

function DraftsPage() {
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [suggestions, setSuggestions] = useState<Record<string, any[]>>({});
  const [editDraft, setEditDraft] = useState<any | null>(null);
  const [confirmDeleteIds, setConfirmDeleteIds] = useState<string[] | null>(null);
  // Push confirmation (bug 3): the ids awaiting the "goes LIVE" dialog.
  const [confirmPushIds, setConfirmPushIds] = useState<string[] | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const optimizeFn = useServerFn(optimizeDraftWithAi);
  const optimizeCopyFn = useServerFn(optimizeDraftCopyWithAi);
  const repairFn = useServerFn(repairDraftForEbay);
  const suggestFn = useServerFn(suggestEbayCategories);
  const pushFn = useServerFn(pushDraftsToEbay);
  const aiCatFn = useServerFn(aiDeepCategorySuggest);
  const prepareMarketplaceFn = useServerFn(prepareMarketplaceListing);

  const { data: drafts = [], refetch, isLoading } = useQuery({
    queryKey: ["listing-drafts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_drafts").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });
  const selectedIds = useMemo(() => Object.keys(selected).filter((id) => selected[id]), [selected]);
  // Live Push + preflight state (bug 4): read the same automation_rules row
  // the Rules page uses. The server refuses to publish when Live Push is
  // off; the button mirrors that so the user is told before clicking.
  const { data: livePushRule } = useQuery({
    queryKey: ["automation-rules-live-push"],
    queryFn: async () => {
      const { data } = await supabase.from("automation_rules").select("live_listing_enabled,preflight_required").maybeSingle();
      return data || null;
    },
    staleTime: 60_000,
  });
  const livePushOn = livePushRule?.live_listing_enabled === true;
  const preflightOn = livePushRule?.preflight_required === true;
  const confirmPushDrafts = useMemo(
    () => (confirmPushIds || []).map((id) => drafts.find((d: any) => d.id === id)).filter(Boolean),
    [confirmPushIds, drafts],
  );
  const selectedDrafts = useMemo(() => selectedIds.map((id) => drafts.find((d: any) => d.id === id)).filter(Boolean), [selectedIds, drafts]);
  // Push blockers for the selection (tooltips explain WHY the button is
  // disabled — audit #32): no category, Live Push off, or no quote.
  const pushBlocker = useMemo(() => {
    if (!selectedDrafts.length) return null;
    if (!livePushOn) return "Live push is off in Rules — turn it on to publish";
    const noCat = selectedDrafts.filter((d: any) => !d.category_id).length;
    if (noCat) return `${noCat} selected draft${noCat === 1 ? "" : "s"} need${noCat === 1 ? "s" : ""} an eBay category ID`;
    const noQuote = selectedDrafts.filter((d: any) => !(Number(d.profit?.shipping) > 0)).length;
    if (noQuote) return `${noQuote} selected draft${noQuote === 1 ? "" : "s"} have no shipping quote — get a quote first`;
    return null;
  }, [selectedDrafts, livePushOn]);
  const filteredDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return drafts.filter((d: any) => {
      if (statusFilter !== "all" && d.status !== statusFilter) return false;
      if (q && !`${d.title || ""} ${d.sku || ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [drafts, search, statusFilter]);
  const statusOptions = useMemo(() => Array.from(new Set(drafts.map((d: any) => String(d.status || "pending")))), [drafts]);

  const optimize = useMutation({
    mutationFn: async (ids: string[]) => {
      const filled: string[] = [];
      for (const id of ids) {
        const r: any = await optimizeFn({ data: { draftId: id } });
        if (Array.isArray(r?.filledFields)) filled.push(...r.filledFields);
      }
      return Array.from(new Set(filled));
    },
    onSuccess: (filled) => { toast.success(filled.length ? `AI Fill completed — filled ${filled.join(", ")}` : "AI Fill completed — nothing new to fill"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const optimizeCopy = useMutation({
    mutationFn: async (ids: string[]) => {
      let summary = "";
      for (const id of ids) {
        const r: any = await optimizeCopyFn({ data: { draftId: id } });
        if (r?.summary) summary = r.summary;
      }
      return summary;
    },
    onSuccess: (summary) => { toast.success(`AI Optimized — ${summary || "updated listing copy"}`); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  const repair = useMutation({
    mutationFn: async (ids: string[]) => {
      let summary = "";
      for (const id of ids) {
        const r: any = await repairFn({ data: { draftId: id } });
        if (r?.summary) summary = r.summary;
      }
      return summary;
    },
    onSuccess: (summary) => { toast.success(summary || "Draft data repaired for eBay"); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  // ONE merged category suggester (audit #33/#34, removal B): the AI picks
  // and eBay's own suggestions in a single list, each labelled with its
  // source ("AI" / "eBay") and a rank. Clicking one applies it and
  // dismisses the list.
  const suggestCategory = useMutation({
    mutationFn: async (draft: any) => {
      const [aiPicks, ebayRows] = await Promise.all([
        aiCatFn({ data: { title: draft.title, description: draft.description, hint: draft.category_id } }).catch(() => []),
        suggestFn({ data: { q: draft.title } }).catch(() => []),
      ]);
      const aiIds = new Set((aiPicks || []).map((p: any) => String(p.categoryId)));
      const merged = [
        ...(aiPicks || []).map((p: any) => ({ categoryId: p.categoryId, path: p.path, source: "AI", reason: p.reason || "AI pick" })),
        ...(ebayRows || []).filter((c: any) => !aiIds.has(String(c.categoryId))).map((c: any) => ({ categoryId: c.categoryId, path: c.path, source: "eBay", reason: "eBay suggestion" })),
      ];
      return { id: draft.id, rows: merged };
    },
    onSuccess: ({ id, rows }) => setSuggestions((s) => ({ ...s, [id]: rows })),
    onError: (e: Error) => toast.error(e.message),
  });

  const push = useMutation({
    mutationFn: async (ids: string[]) => pushFn({ data: { draftIds: ids } }),
    onSuccess: (rows: any[]) => {
      // A failed push must never look like a success (bug 5): 0 of N is an
      // ERROR with the actual eBay reason, a partial push is a warning
      // with counts + reason, only all-succeed is a success toast.
      const okCount = rows.filter((r) => r.ok).length;
      const failed = rows.filter((r) => !r.ok);
      const firstError = failed[0]?.error;
      if (failed.length === 0) toast.success(`Pushed ${okCount} draft${okCount === 1 ? "" : "s"} to eBay`);
      else if (okCount === 0) toast.error(`Push failed: ${firstError || "eBay rejected the draft"}`);
      else toast.warning(`Pushed ${okCount} of ${rows.length} draft(s). Failed: ${firstError || "unknown error"}`);
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

  // Facebook Marketplace (prepare only — the app never posts to Facebook;
  // Muse posts the prepared listing from chat with an approval card).
  const prepareMarketplace = useMutation({
    mutationFn: async (draftId: string) => prepareMarketplaceFn({ data: { draftId, locationLabel: getSavedMarketplaceLocationLabel() } }),
    onSuccess: () => { toast.success("Prepared for Marketplace — ready to post"); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function updateDraft(id: string, patch: any) {
    const { error } = await supabase.from("listing_drafts").update(patch).eq("id", id);
    if (error) toast.error(error.message); else refetch();
  }

  /** Apply a suggestion: saves the category ID and the full path (stored
   * in profit so the push dialog can show it) and dismisses the list. */
  async function applyCategory(draft: any, c: { categoryId: string; path: string }) {
    await updateDraft(draft.id, { category_id: c.categoryId, profit: { ...(draft.profit || {}), category_path: c.path } });
    setSuggestions((s) => ({ ...s, [draft.id]: [] }));
  }

  return (
    <AppShell title="Drafts" subtitle="Compact queue for fixing, editing and bulk-pushing to eBay">
      <div className="space-y-6">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm"><Link to="/products"><Search className="h-4 w-4 mr-1" />Research</Link></Button>
          <Button size="sm" disabled={!selectedIds.length || optimize.isPending} onClick={() => optimize.mutate(selectedIds)}><Sparkles className="h-4 w-4 mr-1" />{optimize.isPending ? "Filling specifics…" : "AI Fill specifics"}</Button>
          <Button size="sm" disabled={!selectedIds.length || repair.isPending} onClick={() => repair.mutate(selectedIds)}><Wrench className="h-4 w-4 mr-1" />{repair.isPending ? "Repairing…" : "Repair"}</Button>
          <Button size="sm" disabled={!selectedIds.length || push.isPending || !!pushBlocker} title={pushBlocker || undefined} onClick={() => setConfirmPushIds(selectedIds)}><Rocket className="h-4 w-4 mr-1" />{push.isPending ? "Pushing…" : "Push"}</Button>
          <Button size="sm" disabled={!selectedIds.length || bulkDelete.isPending} variant="destructive" onClick={() => setConfirmDeleteIds(selectedIds)}><Trash2 className="h-4 w-4 mr-1" />Delete</Button>
        </div>
        {!livePushOn && (
          <p className="text-xs text-amber-600">Live push is off in Rules — drafts can be prepared but nothing will be published. Turn on “Live Push to eBay” in Rules to enable Push.</p>
        )}
        {pushBlocker && livePushOn && (
          <p className="text-xs text-amber-600">{pushBlocker} — expand the draft and use "Suggest category", then Push unlocks.</p>
        )}

        <div className="flex flex-wrap gap-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drafts by title or SKU…" className="h-9 w-full sm:w-72" aria-label="Search drafts" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36" aria-label="Filter by status"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {statusOptions.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          {isLoading ? <div className="p-10 text-center"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : drafts.length === 0 ? (
            <div className="p-6"><EmptyState icon={FileEdit} title="No drafts yet" help="Select products from CJ research and send them here." actionLabel="Search CJ Products" actionTo="/products" /></div>
          ) : filteredDrafts.length === 0 ? (
            <div className="p-6"><EmptyState icon={FileEdit} title="No drafts match" help="Try a different search or status filter." /></div>
          ) : (
            <div className="divide-y">
              {filteredDrafts.map((d: any) => {
                const checked = !!selected[d.id];
                const image = (Array.isArray(d.images) ? d.images[0] : undefined) || "";
                const blocker = pushBlockedReason(d, livePushOn);
                const completeness = completenessScore({ title: d.title, itemSpecifics: d.item_specifics, images: d.images, description: d.description });
                const appliedPath = d.profit?.category_path || null;
                return (
                  <Collapsible key={d.id}>
                    <div className={`relative grid grid-cols-[42px_52px_1fr_auto] items-center gap-2 p-2 ${checked ? "bg-primary/5" : "bg-card"}`}>
                      <button type="button" onClick={() => setSelected((s) => ({ ...s, [d.id]: !s[d.id] }))} className={`h-6 w-6 rounded-full border text-xs font-bold ${checked ? "bg-primary text-primary-foreground" : "bg-background"}`} aria-label={checked ? "Clear selection" : "Select draft"}>{checked ? "✓" : ""}</button>
                      <img src={image} alt={d.title || "Draft product"} className="h-12 w-12 rounded-md object-cover bg-muted" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-semibold text-sm line-clamp-2 leading-snug">{truncate(d.title)}</span>
                          {d.status === "failed" ? <StatusErrorPopover draft={d} /> : <Badge variant="secondary" className="shrink-0 text-[10px]">{d.status}</Badge>}
                          <CompletenessBadge score={completeness.score} parts={completeness.parts} />
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>${Number(d.price || 0).toFixed(2)}</span>
                          <span>{`${variantCount(d)} variant${variantCount(d) === 1 ? "" : "s"}`}</span>
                          <span>{profitText(d)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <CollapsibleTrigger asChild><Button size="icon" variant="ghost" aria-label="Show draft details"><ChevronDown className="h-4 w-4" /></Button></CollapsibleTrigger>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" aria-label="Draft actions"><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="z-50">
                            <DropdownMenuLabel>Actions</DropdownMenuLabel>
                            <DropdownMenuItem onClick={() => setEditDraft(d)}>Edit draft</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => suggestCategory.mutate(d)}>Suggest category</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => optimize.mutate([d.id])}>AI Fill item specifics</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => optimizeCopy.mutate([d.id])}>AI Optimized copy</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => repair.mutate([d.id])} title="Repairs this draft's title, description, images and item specifics from CJ data. Use it when a push failed or a draft is missing fields.">Repair for eBay</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem disabled={!!blocker} title={blocker || undefined} onClick={() => setConfirmPushIds([d.id])}>Push to eBay</DropdownMenuItem>
                            <DropdownMenuItem disabled={prepareMarketplace.isPending} onClick={() => prepareMarketplace.mutate(d.id)}>Prepare for Marketplace</DropdownMenuItem>
                            <DropdownMenuItem className="text-destructive" onClick={() => setConfirmDeleteIds([d.id])}>Delete draft</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                    <CollapsibleContent>
                      <div className="relative z-0 grid gap-3 border-t bg-muted/25 p-3 md:grid-cols-[1fr_280px]">
                        <div className="min-w-0 space-y-2">
                          <div className="text-sm font-medium break-words">{d.title}</div>
                          <DraftDescription html={d.description || ""} />
                        </div>
                        <div className="space-y-2">
                          <CategoryInput draftId={d.id} value={d.category_id || ""} onSave={updateDraft} />
                          {appliedPath && d.category_id ? (
                            <div className="text-xs break-words">
                              <span className="text-muted-foreground">Category: </span>{appliedPath} <span className="text-muted-foreground">({d.category_id})</span>{" "}
                              <button type="button" className="text-primary hover:underline" onClick={() => { void updateDraft(d.id, { profit: { ...(d.profit || {}), category_path: null } }); suggestCategory.mutate(d); }}>Change</button>
                            </div>
                          ) : (
                            <>
                              <Button size="sm" variant="outline" disabled={suggestCategory.isPending} onClick={() => suggestCategory.mutate(d)}>
                                {suggestCategory.isPending ? "Suggesting…" : "Suggest category"}
                              </Button>
                              {rankSuggestions(suggestions[d.id], d).slice(0, 3).map((c: any, i: number) => {
                                // Full path with a space after each › (audit #34).
                                const parts = String(c.path).split(">").map((s: string) => s.trim()).filter(Boolean);
                                const displayPath = parts.join(" › ");
                                return (
                                  <button key={c.categoryId} title={`${displayPath} — ${c.source} suggestion #${i + 1}${c.reason ? ` · ${c.reason}` : ""}`} className="block w-full text-left text-xs text-primary hover:underline break-words whitespace-normal" onClick={() => void applyCategory(d, c)}>
                                    <span className="font-semibold">{displayPath}</span>{" "}
                                    <span className="text-muted-foreground">({c.categoryId}) · {c.source} #{i + 1}</span>
                                  </button>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </Card>
      </div>
      <AlertDialog open={confirmDeleteIds !== null} onOpenChange={(open) => !open && setConfirmDeleteIds(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{`Delete ${confirmDeleteIds?.length ?? 0} draft${(confirmDeleteIds?.length ?? 0) === 1 ? "" : "s"}?`}</AlertDialogTitle>
            <AlertDialogDescription>{`This permanently removes the selected draft${(confirmDeleteIds?.length ?? 0) === 1 ? "" : "s"} from the queue. Listings already pushed to eBay are not affected.`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (confirmDeleteIds) bulkDelete.mutate(confirmDeleteIds); setConfirmDeleteIds(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {/* Push confirmation (bug 3): publishing goes LIVE on eBay — show
          exactly what is about to publish and require an explicit Publish.
          When "Require preflight approval" is ON in Rules, the full
          preflight checklist is shown; when OFF, a compact confirm. */}
      <AlertDialog open={confirmPushIds !== null} onOpenChange={(open) => !open && setConfirmPushIds(null)}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>{`Publish ${confirmPushDrafts.length} draft${confirmPushDrafts.length === 1 ? "" : "s"} to eBay?`}</AlertDialogTitle>
            <AlertDialogDescription>
              {livePushOn
                ? "This will go LIVE on eBay immediately — the listing will be visible to buyers and charged eBay fees."
                : "Live push is OFF in Rules, so publishing is blocked. Turn on “Live Push to eBay” in Rules, then come back to publish."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="max-h-80 space-y-3 overflow-y-auto rounded-md border p-3">
            {confirmPushDrafts.map((d: any) => {
              const profit = d.profit || {};
              const fee = Number(profit.ebay_fee ?? 0);
              const shipping = Number(profit.shipping ?? 0);
              const checks = [
                { label: "Category", ok: !!d.category_id, detail: d.category_id ? `${d.category_id}${profit.category_path ? ` · ${profit.category_path}` : ""}` : "missing" },
                { label: "Brand", ok: !!((d.item_specifics?.Brand || d.brand) && String(d.item_specifics?.Brand || d.brand) !== ""), detail: String(d.item_specifics?.Brand || d.brand || "missing") },
                { label: "Images", ok: Array.isArray(d.images) && d.images.length > 0, detail: `${Array.isArray(d.images) ? d.images.length : 0} image(s)` },
                { label: "Price", ok: Number(d.price) > 0, detail: `$${Number(d.price || 0).toFixed(2)}` },
                { label: "Fees", ok: fee > 0, detail: fee > 0 ? `$${fee.toFixed(2)}` : "not calculated" },
                { label: "Shipping quoted", ok: shipping > 0, detail: shipping > 0 ? `${profit.carrier ? `${profit.carrier} · ` : ""}$${shipping.toFixed(2)}` : "no quote — push is blocked" },
              ];
              return (
                <div key={d.id} className="space-y-1 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0 break-words font-medium">{d.title}</span>
                    <span className="shrink-0 font-semibold tabular-nums">${Number(d.price || 0).toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {variantCount(d)} variant{variantCount(d) === 1 ? "" : "s"} · {profitText(d)}
                  </div>
                  {preflightOn ? (
                    <ul className="space-y-0.5 text-xs">
                      {checks.map((c) => (
                        <li key={c.label} className={c.ok ? "text-foreground" : "text-destructive"}>
                          {c.ok ? "✓" : "✗"} {c.label}: {c.detail}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      Category {d.category_id || "missing"} · {variantCount(d)} variant{variantCount(d) === 1 ? "" : "s"} · Shipping {shipping > 0 ? `${profit.carrier ? `${profit.carrier} ` : ""}$${shipping.toFixed(2)}` : "not quoted"} · Fees {fee > 0 ? `$${fee.toFixed(2)}` : "—"} · Sell ${Number(d.price || 0).toFixed(2)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!livePushOn || push.isPending}
              onClick={() => { if (confirmPushIds) push.mutate(confirmPushIds); setConfirmPushIds(null); }}
            >
              {push.isPending ? "Publishing…" : preflightOn ? "Confirm preflight & publish" : "Publish"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <EditDraftDialog draft={editDraft} onOpenChange={(open) => !open && setEditDraft(null)} onSaved={() => { setEditDraft(null); refetch(); }} />
    </AppShell>
  );
}

function EditDraftDialog({ draft, onOpenChange, onSaved }: { draft: any | null; onOpenChange: (open: boolean) => void; onSaved: () => void }) {
  const [form, setForm] = useState<any>({});
  const [specificsRows, setSpecificsRows] = useState<{ key: string; value: string }[]>([]);

  useEffect(() => {
    if (!draft) return;
    setForm({
      id: draft.id,
      title: draft.title || "",
      // Plain-text editor for the clean description (<img> stripped; the
      // rendered HTML preview below shows what it looks like).
      description: stripHtmlToText(draft.description || ""),
      // Money fields must display at 2 decimals — a raw DB float renders
      // as "15.989999771118164" otherwise (bug 11).
      price: draft.price != null ? Number(draft.price).toFixed(2) : "",
      category_id: draft.category_id || "",
      brand: draft.brand || "",
      model: draft.model || "",
      images: Array.isArray(draft.images) ? draft.images.join("\n") : "",
    });
    const entries = Object.entries(draft.item_specifics || {}).map(([key, v]) => ({ key, value: Array.isArray(v) ? v.join(", ") : String(v ?? "") }));
    setSpecificsRows(entries.length ? entries : [{ key: "Brand", value: draft.brand || "Unbranded" }]);
  }, [draft]);

  const save = useMutation({
    mutationFn: async () => {
      const specifics: Record<string, string> = {};
      for (const row of specificsRows) {
        const k = row.key.trim();
        const v = row.value.trim();
        if (k && v) specifics[k] = v;
      }
      if (Object.keys(specifics).length === 0) throw new Error("Add at least one item specific (e.g. Brand).");
      const patch = {
        title: String(form.title || "").slice(0, 80),
        description: String(form.description || "").slice(0, 500000),
        price: roundMoney(Number(form.price || 0)),
        category_id: String(form.category_id || "").trim() || null,
        brand: String(form.brand || "").trim() || null,
        model: String(form.model || "").trim() || null,
        images: String(form.images || "").split(/\n+/).map((s) => s.trim()).filter(Boolean),
        item_specifics: specifics,
        status: "pending" as const,
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
      {/* One close control only (audit #27e): the footer's Cancel. The X is
          hidden, and nothing auto-focuses (or auto-selects) on open. */}
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto [&>button]:hidden" onOpenAutoFocus={(e) => e.preventDefault()}>
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
          <div className="space-y-1 md:col-span-2">
            <span className="text-xs font-medium">Description — rendered preview</span>
            <div className="rounded-md border bg-muted/25 p-3 text-xs text-muted-foreground break-words [&_*]:max-w-full">
              {draft?.description ? <div dangerouslySetInnerHTML={{ __html: typeof window === "undefined" ? "" : DOMPurify.sanitize(draft.description, { USE_PROFILES: { html: true }, FORBID_TAGS: ["img"] }) }} /> : "No description yet."}
            </div>
            <label className="block space-y-1 pt-2"><span className="text-xs font-medium">Description — plain text (edit this; images are not in the description)</span><Textarea rows={5} value={form.description || ""} onChange={(e) => setForm((f: any) => ({ ...f, description: e.target.value }))} /></label>
          </div>
          <label className="space-y-1 md:col-span-2"><span className="text-xs font-medium">Image URLs, one per line</span><Textarea rows={4} value={form.images || ""} onChange={(e) => setForm((f: any) => ({ ...f, images: e.target.value }))} /></label>
          <div className="space-y-2 md:col-span-2">
            <span className="text-xs font-medium">Item specifics</span>
            <p className="text-xs text-muted-foreground">Keys must match eBay aspect names for the category (e.g. Brand, Model, Type). Values are at most 65 characters. Empty rows are ignored.</p>
            {specificsRows.map((row, i) => (
              <div key={i} className="flex gap-2">
                <Input value={row.key} placeholder="Name (e.g. Brand)" aria-label={`Specific name ${i + 1}`} onChange={(e) => setSpecificsRows((rows) => rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))} />
                <Input value={row.value} placeholder="Value" maxLength={65} aria-label={`Specific value ${i + 1}`} onChange={(e) => setSpecificsRows((rows) => rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove specific ${i + 1}`} onClick={() => setSpecificsRows((rows) => rows.filter((_, j) => j !== i))}>✕</Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setSpecificsRows((rows) => [...rows, { key: "", value: "" }])}>Add specific</Button>
          </div>
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
