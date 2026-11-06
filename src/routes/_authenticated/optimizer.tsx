import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/empty-state";
import { CompletenessBadge } from "@/components/completeness-badge";
import { completenessScore } from "@/lib/completeness";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runOptimizerRules } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Play, Sparkles, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/optimizer")({ head: () => pageHead("Optimizer", "Preview and apply eBay listing optimization rules."), component: OptimizerPage });

function OptimizerPage() {
  const runFn = useServerFn(runOptimizerRules);
  const [actions, setActions] = useState<any[]>([]);
  // The last run's summary — drives the "Flagged to end" card and the
  // dry-run vs applied label. Status "flagged_end" is never written to the
  // database, so counting rows by it would always read 0.
  const [lastRun, setLastRun] = useState<{ dryRun: boolean; flaggedEnd: number; at: string } | null>(null);
  // "Run now" is gated behind a completed preview this session (audit #39):
  // the destructive action must not be the prominent one.
  const [previewDone, setPreviewDone] = useState(false);

  const { data: listings = [], refetch } = useQuery({
    queryKey: ["ebay-listings-optimizer"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ebay_listings").select("*").order("listed_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
  });
  const { data: rule } = useQuery({
    queryKey: ["optimizer-rule"],
    queryFn: async () => {
      const { data } = await supabase.from("automation_rules").select("live_listing_enabled").maybeSingle();
      return data;
    },
  });
  const livePushOn = rule?.live_listing_enabled === true;

  // Completeness (sales feature #7): join each action's listing to its
  // draft (via draft_id) for description/specifics/images, falling back
  // to the listing row's own title + image when there is no draft.
  const draftIds = useMemo(() => Array.from(new Set((listings as any[]).map((l) => l.draft_id).filter(Boolean))), [listings]);
  const { data: draftsById = {} } = useQuery({
    queryKey: ["optimizer-drafts", draftIds.join(",")],
    enabled: draftIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.from("listing_drafts").select("id,title,item_specifics,images,description").in("id", draftIds);
      if (error) throw error;
      return Object.fromEntries((data || []).map((d: any) => [d.id, d]));
    },
  });
  const completenessByListingId = useMemo(() => {
    const map: Record<string, { score: number; parts: { title: number; specifics: number; images: number; description: number } }> = {};
    for (const l of listings as any[]) {
      const d = l.draft_id ? draftsById[l.draft_id] : null;
      map[l.id] = completenessScore({
        title: d?.title || l.title,
        itemSpecifics: d?.item_specifics || null,
        images: d?.images || (l.image_url ? [l.image_url] : []),
        description: d?.description || null,
      });
    }
    return map;
  }, [listings, draftsById]);

  const run = useMutation({
    mutationFn: (dryRun: boolean) => runFn({ data: { dryRun } }),
    onSuccess: (rows: any[], dryRun) => {
      setActions(rows);
      if (dryRun) setPreviewDone(true);
      setLastRun({ dryRun, flaggedEnd: rows.filter((r: any) => r.action === "end_recommended" || r.action === "ended").length, at: new Date().toISOString() });
      const failed = rows.filter((row) => row.error).length;
      if (failed) toast.error(`${failed} action(s) failed; check the details below.`);
      else if (rows.length === 0) toast.info(`${dryRun ? "Preview" : "Run"} · 0 actions — nothing to do right now.`);
      else toast.success(`${dryRun ? "Preview" : "Applied"} · ${rows.length} action(s)`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const activeListings = listings.filter((l: any) => l.status === "active");

  return (
    <AppShell title="Optimizer" subtitle="AI-driven rules that end dead listings and rewrite low-CTR titles">
      <div className="space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Card className="p-4 sm:p-6 min-w-0 shadow-[var(--shadow-card)]">
            <div className="text-xs text-muted-foreground truncate">Active listings</div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums font-display">{activeListings.length}</div>
          </Card>
          <Card className="p-4 sm:p-6 min-w-0 shadow-[var(--shadow-card)]">
            <div className="text-xs text-muted-foreground truncate">Flagged to end</div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums font-display">{lastRun ? lastRun.flaggedEnd : "—"}</div>
            <div className="text-[11px] text-muted-foreground">{lastRun ? "from latest run" : "run a preview first"}</div>
          </Card>
          <Card className="p-4 sm:p-6 min-w-0 shadow-[var(--shadow-card)]">
            <div className="text-xs text-muted-foreground truncate">Total sales</div>
            <div className="text-2xl sm:text-3xl font-bold tabular-nums font-display">{listings.reduce((s: number, l: any) => s + (l.sales || 0), 0)}</div>
          </Card>
        </div>

        {!livePushOn && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
            <span><strong>Live Push is off</strong> in Rules — "Run now" is blocked until you enable it. Preview still works, and nothing is changed on eBay.</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run.mutate(true)} disabled={run.isPending}>
            {run.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Preview AI actions
          </Button>
          <Button variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending || !livePushOn || !previewDone} title={!previewDone ? "Run a preview first — the destructive action needs a completed preview this session." : undefined}>
            <Play className="h-4 w-4 mr-1" /> Run now
          </Button>
        </div>

        {lastRun && actions.length > 0 && (
          <div>
            <Badge variant={lastRun.dryRun ? "secondary" : "default"}>
              {lastRun.dryRun ? "Preview (dry run) — nothing was changed on eBay" : "Applied — changes are live on eBay"}
            </Badge>
          </div>
        )}

        <Card className="overflow-hidden shadow-[var(--shadow-card)]">
          {activeListings.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={LineChart}
                title="No active listings to optimize"
                help="Push a draft or relist an ended listing first — the optimizer only works on live listings."
                actionLabel="Review drafts"
                actionTo="/drafts"
              />
              <p className="mt-3 text-center text-sm text-muted-foreground">
                Ended listings can be relisted from the <Link to="/listings" className="underline">Listings → Ended</Link> tab.
              </p>
            </div>
          ) : actions.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              <LineChart className="h-8 w-8 mx-auto mb-2 opacity-60" />
              {lastRun ? (
                // A scan ran and found nothing to do (bug 20) — say so with
                // the scan time instead of the pre-scan prompt.
                <span>{`Scan complete — no actions needed right now${lastRun.dryRun ? " (preview)" : ""}. Last scan ${new Date(lastRun.at).toLocaleString()}.`}</span>
              ) : (
                <span>No actions yet. Click <strong>Preview AI actions</strong> to scan active listings for bad titles, low exposure, no views, no clicks and no sales.</span>
              )}
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Action</TableHead><TableHead>Detail</TableHead><TableHead>Completeness</TableHead></TableRow></TableHeader>
              <TableBody>
                {actions.map((a, i) => {
                  const c = completenessByListingId[a.id];
                  return (
                    <TableRow key={a.id + i}>
                      <TableCell className="max-w-md line-clamp-2">{a.title}</TableCell>
                      <TableCell><Badge variant={a.action.includes("end") ? "destructive" : "secondary"}>{a.action}</Badge></TableCell>
                      <TableCell className="text-xs text-muted-foreground break-words">{a.detail}{a.error && <div className="text-destructive mt-1">{a.error}</div>}</TableCell>
                      <TableCell>{c ? <CompletenessBadge score={c.score} parts={c.parts} /> : "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
