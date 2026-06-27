import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { KeyRound, Boxes, Tag } from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <AppShell title="Settings" subtitle="Integrations, profile and workspace preferences">
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          icon={Boxes}
          title="CJ Dropshipping"
          desc="Access token for the CJ Open API — used for product search, freight quotes, categories and warehouses."
          status="Not connected"
        />
        <IntegrationCard
          icon={Tag}
          title="eBay"
          desc="Client ID, secret and refresh token from your eBay developer app. Listings push only when the safety switch is enabled."
          status="Not connected"
        />
        <IntegrationCard
          icon={KeyRound}
          title="Lovable AI (built-in)"
          desc="Powers title rewrites, item-specific guessing and image hooks. No key needed — included with your workspace."
          status="Ready"
          ready
        />
      </div>

      <p className="mt-6 text-sm text-muted-foreground">
        Connection forms become available in the next build step, together with the CJ search and eBay
        OAuth flow.
      </p>
    </AppShell>
  );
}

function IntegrationCard({ icon: Icon, title, desc, status, ready }: {
  icon: typeof KeyRound; title: string; desc: string; status: string; ready?: boolean;
}) {
  return (
    <Card className="shadow-[var(--shadow-card)]">
      <CardHeader className="flex flex-row items-start gap-4 space-y-0">
        <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Icon className="h-5 w-5" /></div>
        <div className="flex-1">
          <CardTitle>{title}</CardTitle>
          <CardDescription className="mt-1">{desc}</CardDescription>
        </div>
        <span className={ready ? "rounded-full bg-success/10 text-success text-xs px-2 py-0.5 font-medium" : "rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-medium"}>{status}</span>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={ready}>{ready ? "Built-in" : "Connect (coming next)"}</Button>
      </CardContent>
    </Card>
  );
}
