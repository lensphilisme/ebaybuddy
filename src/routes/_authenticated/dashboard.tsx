import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowRight, Boxes, FileEdit, Tag, AlertTriangle, KeyRound, PackageSearch } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

function DashboardPage() {
  return (
    <AppShell title="Dashboard" subtitle="Overview of your CJ → eBay pipeline">
      <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-5 mb-6 flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
        <div className="text-sm">
          <div className="font-semibold">Connect your APIs to bring this dashboard alive.</div>
          <p className="text-muted-foreground mt-1">
            Add your CJ Dropshipping access token and eBay refresh token in <Link to="/settings" className="underline">Settings</Link>.
            Until then, stats below show zeros.
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { Icon: Boxes, label: "CJ products cached", v: "0" },
          { Icon: FileEdit, label: "Drafts pending", v: "0" },
          { Icon: Tag, label: "Active listings", v: "0" },
          { Icon: KeyRound, label: "Integrations", v: "0/3" },
        ].map((s) => (
          <Card key={s.label} className="shadow-[var(--shadow-card)]">
            <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
              <s.Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent><div className="text-3xl font-bold tracking-tight">{s.v}</div></CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle>Get started</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Step n={1} title="Connect CJ Dropshipping" to="/settings" desc="Paste your CJ access token (or email + password) so DropList can search products and quote freight." />
            <Step n={2} title="Connect eBay" to="/settings" desc="Add your eBay client ID, secret and refresh token. Listings push only when the safety switch is on." />
            <Step n={3} title="Find products" to="/products" desc="Search CJ by category, country, price, weight. Approved products become drafts." />
            <Step n={4} title="Approve & bulk push" to="/drafts" desc="Review pricing, item specifics, duplicate signals — then push approved drafts in one click." />
          </CardContent>
        </Card>

        <Card className="shadow-[var(--shadow-card)]">
          <CardHeader><CardTitle>Quick actions</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <Button asChild className="w-full justify-between"><Link to="/products">Search CJ <PackageSearch className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/drafts">Review drafts <ArrowRight className="h-4 w-4" /></Link></Button>
            <Button asChild variant="outline" className="w-full justify-between"><Link to="/optimizer">Run optimizer <ArrowRight className="h-4 w-4" /></Link></Button>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Step({ n, title, desc, to }: { n: number; title: string; desc: string; to: string }) {
  return (
    <Link to={to} className="flex items-start gap-4 rounded-lg border border-border p-4 hover:bg-secondary/50 transition-colors">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-sm font-semibold">{n}</div>
      <div className="flex-1">
        <div className="font-medium">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="h-4 w-4 text-muted-foreground mt-1.5" />
    </Link>
  );
}
