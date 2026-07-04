import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getIntegrationStatus } from "@/lib/cj.functions";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Boxes, FileEdit, Tag, KeyRound, PackageSearch, TrendingUp } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  const statusFn = useServerFn(getIntegrationStatus);
  const { data: status } = useQuery({ queryKey: ["integration-status"], queryFn: () => statusFn() });

  const { data: counts } = useQuery({
    queryKey: ["dashboard-counts"],
    queryFn: async () => {
      const [drafts, listings, logs] = await Promise.all([
        supabase.from("listing_drafts").select("id,status,price", { count: "exact" }),
        supabase.from("ebay_listings").select("id,status,sales,views,price", { count: "exact" }),
        supabase.from("activity_logs").select("id,message,level,created_at").order("created_at", { ascending: false }).limit(6),
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
        logs: logs.data || [],
      };
    },
    refetchInterval: 30_000,
  });

  const integrations = [status?.cj.connected, status?.ebay.connected, true].filter(Boolean).length;

  const stats = [
    { Icon: FileEdit, label: "Drafts pending", v: counts?.draftsPending ?? 0, hint: `${counts?.draftsFailed ?? 0} failed` },
    { Icon: Tag, label: "Active listings", v: counts?.listingsActive ?? 0, hint: `${counts?.listingsTotal ?? 0} tracked` },
    { Icon: TrendingUp, label: "Units sold", v: counts?.totalSales ?? 0, hint: `${counts?.totalViews ?? 0} watchers` },
    { Icon: KeyRound, label: "Integrations", v: `${integrations}/3`, hint: status?.ebay.connected ? "eBay OK" : "connect eBay" },
  ];

  return (
    <AppShell title="Dashboard" subtitle="Overview of your CJ → eBay pipeline">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-[var(--shadow-card)]">
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
          <CardHeader><CardTitle>Recent activity</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(counts?.logs || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet. Sync eBay or push a draft to see events here.</p>
            ) : counts!.logs.map((l: any) => (
              <div key={l.id} className="flex items-start gap-3 text-sm border-b border-border/60 last:border-0 py-2">
                <span className={`mt-1 h-2 w-2 rounded-full shrink-0 ${l.level === "success" ? "bg-success" : l.level === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
                <div className="flex-1">
                  <div>{l.message}</div>
                  <div className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full justify-between"><Link to="/products">Search CJ <PackageSearch className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/drafts">Review drafts <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/listings">Sync eBay <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/optimizer">Run optimizer <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="ghost" className="w-full justify-between"><Link to="/settings">Integrations <Boxes className="h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
