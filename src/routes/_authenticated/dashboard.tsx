import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { SyncButton } from "@/components/sync-button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntegrationStatus } from "@/lib/cj.functions";
import { syncEbayListings } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { FileEdit, Tag, KeyRound, TrendingUp, Loader2, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/dashboard")({ head: () => pageHead("Dashboard", "Your CJ-to-eBay listing pipeline, sales and activity."),
  component: DashboardPage,
});

const KNOWN_LOG_CATEGORIES = ["cj", "ebay", "ai", "optimizer"];

function DashboardPage() {
  const statusFn = useServerFn(getIntegrationStatus);
  const syncFn = useServerFn(syncEbayListings);
  const { data: status } = useQuery({ queryKey: ["integration-status"], queryFn: () => statusFn() });
  const [logCategory, setLogCategory] = useState("all");
  const [logLevel, setLogLevel] = useState("all");

  const { data: counts, refetch: refetchCounts } = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [drafts, listings] = await Promise.all([
        supabase.from("listing_drafts").select("id,status,price", { count: "exact" }),
        supabase.from("ebay_listings").select("id,status,sales,views,price,listed_at", { count: "exact" }),
      ]);
      const draftRows = drafts.data || [];
      const listingRows = listings.data || [];
      return {
        draftsTotal: drafts.count ?? draftRows.length,
        draftsPending: draftRows.filter((d) => d.status === "pending").length,
        draftsFailed: draftRows.filter((d) => d.status === "failed").length,
        listingsTotal: listings.count ?? listingRows.length,
        listingsActive: listingRows.filter((l) => l.status === "active").length,
        totalSales: listingRows.reduce((s, l) => s + (l.sales || 0), 0),
        totalViews: listingRows.reduce((s, l) => s + (l.views || 0), 0),
        gmv: listingRows.reduce((s, l) => s + Number(l.price || 0) * (l.sales || 0), 0),
        listingRows,
      };
    },
    refetchInterval: 30_000,
  });

  // Sales trend (sales feature #6): weekly revenue bars for the last 8
  // weeks, grouped by the week each listing went live (listed_at) — the
  // app has no per-sale dates, so revenue is attributed to the listing's
  // launch week and labelled honestly as "Revenue by listing week".
  const weeklyRevenue = useMemo(() => {
    const weeks: { label: string; revenue: number }[] = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const start = new Date(now);
      start.setDate(now.getDate() - (i + 1) * 7);
      const end = new Date(now);
      end.setDate(now.getDate() - i * 7);
      const revenue = (counts?.listingRows || [])
        .filter((l: any) => {
          const d = l.listed_at ? new Date(l.listed_at) : null;
          return d && d >= start && d < end;
        })
        .reduce((s: number, l: any) => s + Number(l.price || 0) * (l.sales || 0), 0);
      weeks.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, revenue });
    }
    return weeks;
  }, [counts]);
  const maxWeekRevenue = Math.max(1, ...weeklyRevenue.map((w) => w.revenue));

  // Full activity log lives here now (the old /logs page was merged in):
  // 200 rows, fetched unfiltered and filtered client-side with normalized
  // (lowercase) values. The old server-side .eq() filter could show
  // "No activity yet" while matching rows were visible — the category list
  // was derived from the already-filtered rows, so the filter and the rows
  // could disagree. Client-side filtering makes them match by construction.
  const { data: allLogs = [], isLoading: logsLoading } = useQuery({
    queryKey: ["dashboard-activity-logs"],
    queryFn: async () => {
      const { data, error } = await supabase.from("activity_logs").select("*").order("created_at", { ascending: false }).limit(200);
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30_000,
  });
  const logCategories = useMemo(() => {
    const extra = Array.from(new Set(allLogs.map((l: any) => String(l.category || "").toLowerCase().trim()).filter(Boolean)));
    return Array.from(new Set([...KNOWN_LOG_CATEGORIES, ...extra]));
  }, [allLogs]);
  const logs = useMemo(() => allLogs.filter((l: any) => {
    const cat = String(l.category || "").toLowerCase().trim();
    const lvl = String(l.level || "").toLowerCase().trim();
    if (logCategory !== "all" && cat !== logCategory.toLowerCase()) return false;
    if (logLevel !== "all" && lvl !== logLevel.toLowerCase()) return false;
    return true;
  }), [allLogs, logCategory, logLevel]);

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { entriesPerPage: 200 } }),
    onSuccess: (r: any) => {
      // 0 imported is a WARNING, not a success (audit #54) — the server
      // returns level + reason for exactly this.
      if (r.level === "warn") toast.warning(r.reason || "Sync finished — 0 listings imported.");
      else toast.success(`Synced ${r.synced || 0} of ${r.total || 0} active listings${r.skipped ? ` · ${r.skipped} skipped (bad data)` : ""}${r.trafficUpdated ? ` · traffic refreshed for ${r.trafficUpdated}` : ""}${r.trafficError ? " · traffic refresh failed, optimizer data may be stale" : ""}`);
      refetchCounts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const missingIntegrations = [
    !status?.cj.connected && "CJ",
    !status?.ebay.connected && "eBay",
    !status?.ai.connected && "AI",
  ].filter(Boolean) as string[];
  const integrations = 3 - missingIntegrations.length;

  const stats = [
    { Icon: FileEdit, label: "Drafts pending", v: counts?.draftsPending ?? 0, hint: `${counts?.draftsFailed ?? 0} failed`, to: "/drafts" },
    { Icon: Tag, label: "Active listings", v: counts?.listingsActive ?? 0, hint: `${counts?.listingsTotal ?? 0} tracked`, to: "/listings" },
    { Icon: TrendingUp, label: "Units sold", v: counts?.totalSales ?? 0, hint: `${counts?.totalViews ?? 0} views (30d)`, to: undefined },
    { Icon: KeyRound, label: "Integrations", v: `${integrations}/3`, hint: missingIntegrations.length ? `${missingIntegrations.join(", ")} not connected` : "all connected", to: "/settings" },
  ];

  return (
    <AppShell title="Dashboard" subtitle="Overview of your CJ → eBay pipeline" actions={<SyncButton onSync={() => sync.mutateAsync()} />}>
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map((s) => {
            const card = (
              <Card className="shadow-[var(--shadow-card)]" aria-label={`${s.v} ${s.label} — ${s.hint}`}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 p-3 sm:p-4">
                  <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
                  <s.Icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
                  <div className="text-2xl sm:text-3xl font-bold tabular-nums font-display">{s.v}</div>
                  <div className="text-xs text-muted-foreground mt-1">{s.hint}</div>
                </CardContent>
              </Card>
            );
            return s.to ? <Link key={s.label} to={s.to} className="block transition hover:opacity-90">{card}</Link> : <div key={s.label}>{card}</div>;
          })}
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2 shadow-[var(--shadow-card)]">
            <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
              <CardTitle>Activity</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Select value={logCategory} onValueChange={setLogCategory}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All categories</SelectItem>{logCategories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={logLevel} onValueChange={setLogLevel}>
                  <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value="all">All levels</SelectItem><SelectItem value="success">success</SelectItem><SelectItem value="info">info</SelectItem><SelectItem value="warn">warn</SelectItem><SelectItem value="error">error</SelectItem></SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6">
              {logsLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">{allLogs.length ? "No activity matches these filters." : "No activity yet. Sync eBay or push a draft to see events here."}</p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Level</TableHead><TableHead>Category</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
                    <TableBody>{logs.map((l: any) => (
                      <TableRow key={l.id}>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                        <TableCell><Badge variant={l.level === "error" ? "destructive" : "secondary"}>{l.level}</Badge></TableCell>
                        <TableCell className="text-xs text-muted-foreground">{l.category}</TableCell>
                        <TableCell className="min-w-64">
                          <div className="font-medium break-words">{l.message}</div>
                          {l.metadata?.error && (
                            <button
                              type="button"
                              title="Click to copy the full error"
                              className="mt-1 flex items-start gap-1 text-left text-xs text-destructive break-words hover:underline"
                              onClick={() => { navigator.clipboard?.writeText(String(l.metadata.error)); toast.info("Error copied to clipboard"); }}
                            >
                              <Copy className="mt-0.5 h-3 w-3 shrink-0" />
                              <span>{l.metadata.error}</span>
                            </button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}</TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-[var(--shadow-card)]">
            <CardHeader><CardTitle>Revenue by listing week</CardTitle></CardHeader>
            <CardContent className="p-4 sm:p-6">
              <p className="text-sm text-muted-foreground">Total revenue <span className="font-semibold text-foreground tabular-nums">${(counts?.gmv || 0).toFixed(2)}</span> · sales × price, grouped by the week each listing went live (last 8 weeks).</p>
              <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label={`Weekly revenue, last 8 weeks, total $${(counts?.gmv || 0).toFixed(2)}`}>
                {weeklyRevenue.map((w) => (
                  <div key={w.label} className="flex flex-1 flex-col items-center gap-1" title={`Week of ${w.label}: $${w.revenue.toFixed(2)}`}>
                    <span className="text-[10px] tabular-nums text-muted-foreground">{w.revenue > 0 ? `$${Math.round(w.revenue)}` : ""}</span>
                    <div className="w-full rounded-t bg-primary/80" style={{ height: `${Math.max(w.revenue > 0 ? 4 : 1, (w.revenue / maxWeekRevenue) * 96)}px` }} />
                    <span className="text-[10px] text-muted-foreground">{w.label}</span>
                  </div>
                ))}
              </div>
              {weeklyRevenue.every((w) => w.revenue === 0) && <p className="mt-2 text-xs text-muted-foreground">No sales yet — revenue bars appear once a listing sells.</p>}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
