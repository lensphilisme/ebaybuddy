import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { connectEbayWithCode, getEbayConnectUrl } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound, Boxes, Tag } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [code, setCode] = useState("");
  const urlFn = useServerFn(getEbayConnectUrl);
  const connectFn = useServerFn(connectEbayWithCode);
  const { data: ebayCred, refetch } = useQuery({ queryKey: ["ebay-credential"], queryFn: async () => {
    const { data } = await supabase.from("integration_credentials").select("last_validated_at,is_active").eq("provider", "ebay").eq("label", "default").maybeSingle();
    return data;
  }});
  const openOAuth = useMutation({ mutationFn: () => urlFn(), onSuccess: (url: string) => window.open(url, "_blank", "noopener,noreferrer"), onError: (e: Error) => toast.error(e.message) });
  const connect = useMutation({ mutationFn: () => connectFn({ data: { code } }), onSuccess: () => { toast.success("eBay connected"); setCode(""); refetch(); }, onError: (e: Error) => toast.error(e.message) });
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
          status={ebayCred?.is_active ? "Connected" : "Needs OAuth"}
          ready={!!ebayCred?.is_active}
        >
          <div className="space-y-2">
            <Button variant="outline" onClick={() => openOAuth.mutate()} disabled={openOAuth.isPending}>Open eBay OAuth</Button>
            <div className="flex gap-2"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Paste eBay authorization code" /><Button onClick={() => connect.mutate()} disabled={!code || connect.isPending}>Save</Button></div>
            <p className="text-xs text-muted-foreground">Use your RuName redirect, then paste the returned code here so every user connects their own eBay account.</p>
          </div>
        </IntegrationCard>
        <IntegrationCard
          icon={KeyRound}
          title="Lovable AI (built-in)"
          desc="Powers title rewrites, item-specific guessing and image hooks. No key needed — included with your workspace."
          status="Ready"
          ready
        />
      </div>

    </AppShell>
  );
}

function IntegrationCard({ icon: Icon, title, desc, status, ready, children }: {
  icon: typeof KeyRound; title: string; desc: string; status: string; ready?: boolean; children?: ReactNode;
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
        {children ?? <Button variant="outline" disabled={ready}>{ready ? "Built-in" : "Configured"}</Button>}
      </CardContent>
    </Card>
  );
}
