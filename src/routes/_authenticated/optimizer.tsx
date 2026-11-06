import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { runOptimizerRules, refreshEbayTraffic } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { LineChart, Play, Sparkles, Loader2, RefreshCw, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/optimizer")({ head: () => pageHead("Listing optimizer", "Preview and apply eBay listing optimization rules."), component: OptimizerPage });

function OptimizerPage() {
  const runFn = useServerFn(runOptimizerRules);
  const trafficFn = useServerFn(refreshEbayTraffic);
  const [actions, setActions] = useState<any[]>([]);
  // The last run's summary — drives the "Flagged to end" card and the
  // dry-run vs applied label. Status "flagged_end" is never written to the
  // database, so counting rows by it would always read 0.
  const [lastRun, setLastRun] = useState<{ dryRun: boolean; flaggedEnd: number; at: string } | null>(null);

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
  const livePushOn = rule?.live_listing_enabled !== false;

  const run = useMutation({
    mutationFn: (dryRun: boolean) => runFn({ data: { dryRun } }),
    onSuccess: (rows: any[], dryRun) => {
      setActions(rows);
      setLastRun({ dryRun, flaggedEnd: rows.filter((r: any) => r.action === "end_recommended" || r.action === "ended").length, at: new Date().toISOString() });
      const failed = rows.filter((row) => row.error).length;
      if (failed) toast.error(`${failed} action(s) failed; check the details below.`);
      else toast.success(`${dryRun ? "Preview" : "Applied"} · ${rows.length} action(s)`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const traffic = useMutation({
    mutationFn: () => trafficFn(),
    onSuccess: (r: any) => {
      if (r?.error) toast.error(`Traffic refresh failed: ${r.error}`);
      else toast.success(`Traffic refreshed for ${r?.updated ?? 0} listing${(r?.updated ?? 0) === 1 ? "" : "s"}`);
      refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Optimizer" subtitle="AI-driven rules that end dead listings and rewrite low-CTR titles">
      <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
        <Card className="p-3 sm:p-4 min-w-0">
          <div className="text-xs text-muted-foreground truncate">Active listings</div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums">{listings.filter((l: any) => l.status === "active").length}</div>
        </Card>
        <Card className="p-3 sm:p-4 min-w-0">
          <div className="text-xs text-muted-foreground truncate">Flagged to end</div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums">{lastRun ? lastRun.flaggedEnd : "—"}</div>
          <div className="text-[11px] text-muted-foreground">{lastRun ? "from latest run" : "run a preview first"}</div>
        </Card>
        <Card className="p-3 sm:p-4 min-w-0">
          <div className="text-xs text-muted-foreground truncate">Total sales</div>
          <div className="text-xl sm:text-2xl font-semibold tabular-nums">{listings.reduce((s: number, l: any) => s + (l.sales || 0), 0)}</div>
        </Card>
      </div>

      {!livePushOn && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
          <span><strong>Live Push is off</strong> in Rules — "Run now" is blocked until you enable it. Preview still works, and nothing is changed on eBay.</span>
        </div>
      )}

      <div className="flex flex-wrap gap-2 mb-4">
        <Button variant="outline" onClick={() => run.mutate(true)} disabled={run.isPending}>
          {run.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />} Preview AI actions
        </Button>
        <Button onClick={() => run.mutate(false)} disabled={run.isPending || !livePushOn}>
          <Play className="h-4 w-4 mr-1" /> Run now
        </Button>
        <Button variant="outline" onClick={() => traffic.mutate()} disabled={traffic.isPending}>
          <RefreshCw className={`h-4 w-4 mr-1 ${traffic.isPending ? "animate-spin" : ""}`} /> Refresh traffic
        </Button>
      </div>

      {lastRun && actions.length > 0 && (
        <div className="mb-3">
          <Badge variant={lastRun.dryRun ? "secondary" : "default"}>
            {lastRun.dryRun ? "Preview (dry run) — nothing was changed on eBay" : "Applied — changes are live on eBay"}
          </Badge>
        </div>
      )}

      <Card className="overflow-hidden">
        {actions.length === 0 ? (
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
            <TableHeader><TableRow><TableHead>Listing</TableHead><TableHead>Action</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {actions.map((a, i) => (
                <TableRow key={a.id + i}>
                  <TableCell className="max-w-md line-clamp-2">{a.title}</TableCell>
                  <TableCell><Badge variant={a.action.includes("end") ? "destructive" : "secondary"}>{a.action}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground break-words">{a.detail}{a.error && <div className="text-destructive mt-1">{a.error}</div>}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </AppShell>
  );
}
