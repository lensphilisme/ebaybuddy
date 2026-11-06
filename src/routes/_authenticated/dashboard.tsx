import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntegrationStatus } from "@/lib/cj.functions";
import { syncEbayListings } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Boxes, DownloadCloud, FileEdit, Tag, KeyRound, PackageSearch, TrendingUp, Loader2 } from "lucide-react";
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
        supabase.from("ebay_listings").select("id,status,sales,views,price", { count: "exact" }),
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
      };
    },
    refetchInterval: 30_000,
  });

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
      toast.success(`Synced ${r.synced || 0} of ${r.total || 0} active listings${r.skipped ? ` · ${r.skipped} skipped (bad data)` : ""}${r.trafficUpdated ? ` · traffic refreshed for ${r.trafficUpdated}` : ""}${r.trafficError ? " · traffic refresh failed, optimizer data may be stale" : ""}`);
      refetchCounts();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const integrations = [status?.cj.connected, status?.ebay.connected, status?.ai.connected].filter(Boolean).length;

  const stats = [
    { Icon: FileEdit, label: "Drafts pending", v: counts?.draftsPending ?? 0, hint: `${counts?.draftsFailed ?? 0} failed` },
    { Icon: Tag, label: "Active listings", v: counts?.listingsActive ?? 0, hint: `${counts?.listingsTotal ?? 0} tracked` },
    { Icon: TrendingUp, label: "Units sold", v: counts?.totalSales ?? 0, hint: `${counts?.totalViews ?? 0} views (30d)` },
    { Icon: KeyRound, label: "Integrations", v: `${integrations}/3`, hint: status?.ebay.connected ? "eBay OK" : "connect eBay" },
  ];

  return (
    <AppShell title="Dashboard" subtitle="Overview of your CJ → eBay pipeline">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-[var(--shadow-card)]" aria-label={`${s.v} ${s.label} — ${s.hint}`}>
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0 p-3 sm:p-4">
              <CardTitle className="text-xs sm:text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-4 sm:pt-0">
              <div className="text-2xl sm:text-3xl font-bold tracking-tight">{s.v}</div>
              <div className="text-xs text-muted-foreground mt-1">{s.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
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
                <SelectContent><SelectItem value="all">All levels</SelectItem><SelectItem value="success">Success</SelectItem><SelectItem value="info">Info</SelectItem><SelectItem value="warn">Warn</SelectItem><SelectItem value="error">Error</SelectItem></SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            {logsLoading ? <div className="p-10"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div> : logs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet. Sync eBay or push a draft to see events here.</p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader><TableRow><TableHead>Time</TableHead><TableHead>Level</TableHead><TableHead>Category</TableHead><TableHead>Message</TableHead></TableRow></TableHeader>
                  <TableBody>{logs.map((l: any) => (
                    <TableRow key={l.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</TableCell>
                      <TableCell><Badge variant={l.level === "error" ? "destructive" : "secondary"}>{l.level}</Badge></TableCell>
                      <TableCell className="text-xs uppercase text-muted-foreground">{l.category}</TableCell>
                      <TableCell className="min-w-64"><div className="font-medium">{l.message}</div>{l.metadata?.error && <div className="text-xs text-destructive mt-1 break-words">{l.metadata.error}</div>}</TableCell>
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full justify-between"><Link to="/products">Search CJ <PackageSearch className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/drafts">Review drafts <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button variant="outline" className="w-full justify-between" onClick={() => sync.mutate()} disabled={sync.isPending}>
              {sync.isPending ? "Syncing…" : "Sync eBay"} <DownloadCloud className="h-4 w-4" />
            </Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/optimizer">Run optimizer <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="ghost" className="w-full justify-between"><Link to="/settings">Integrations <Boxes className="h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
