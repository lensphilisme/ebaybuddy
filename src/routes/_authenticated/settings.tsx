import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { connectEbayWithCode, getEbayConnectUrl } from "@/lib/ebay.functions";
import { saveCjToken, getIntegrationStatus } from "@/lib/cj.functions";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound, Boxes, Tag, ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/settings")({ component: SettingsPage });

function SettingsPage() {
  const [code, setCode] = useState("");
  const [cjToken, setCjToken] = useState("");
  const urlFn = useServerFn(getEbayConnectUrl);
  const connectFn = useServerFn(connectEbayWithCode);
  const cjSaveFn = useServerFn(saveCjToken);
  const statusFn = useServerFn(getIntegrationStatus);

  const { data: status, refetch } = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => statusFn(),
  });
  const ebayCred = { is_active: !!status?.ebay.connected, source: status?.ebay.source };
  const cjCred = { is_active: !!status?.cj.connected, source: status?.cj.source };

  const openOAuth = useMutation({
    mutationFn: () => urlFn(),
    onSuccess: (url: string) => { window.open(url, "_blank", "noopener,noreferrer"); toast.info("Complete sign-in on eBay; you'll be redirected back automatically."); },
    onError: (e: Error) => toast.error(e.message),
  });
  const connect = useMutation({
    mutationFn: () => connectFn({ data: { code } }),
    onSuccess: () => { toast.success("eBay connected"); setCode(""); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveCj = useMutation({
    mutationFn: () => cjSaveFn({ data: { accessToken: cjToken } }),
    onSuccess: () => { toast.success("CJ Dropshipping token saved"); setCjToken(""); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Settings" subtitle="Integrations, profile and workspace preferences">
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          icon={Boxes}
          title="CJ Dropshipping"
          desc="Personal access token from your CJ developer account — powers product search, freight quotes, categories and warehouses."
          status={cjCred.is_active ? (cjCred.source === "env" ? "Connected (workspace token)" : "Connected") : "Not connected"}
          ready={cjCred.is_active}
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input value={cjToken} onChange={(e) => setCjToken(e.target.value)} placeholder="Paste CJ access token" />
              <Button onClick={() => saveCj.mutate()} disabled={!cjToken || saveCj.isPending}>Save</Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Get a token at{" "}
              <a className="text-primary underline inline-flex items-center gap-1" href="https://developers.cjdropshipping.com" target="_blank" rel="noreferrer">
                developers.cjdropshipping.com <ExternalLink className="h-3 w-3" />
              </a>{" "}— API → personal token.
            </p>
          </div>
        </IntegrationCard>

        <IntegrationCard
          icon={Tag}
          title="eBay"
          desc="Connect your seller account via OAuth. Push only enabled after you flip the Live switch in Rules."
          status={ebayCred.is_active ? (ebayCred.source === "env" ? "Connected (workspace token)" : "Connected") : "Needs OAuth"}
          ready={ebayCred.is_active}
        >
          <div className="space-y-2">
            <Button variant="outline" onClick={() => openOAuth.mutate()} disabled={openOAuth.isPending}>
              Open eBay OAuth <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
            <p className="text-xs text-muted-foreground">
              eBay will redirect back to this app at <code className="px-1 py-0.5 rounded bg-muted">/ebay/callback</code> and store the token automatically.
              If you completed sign-in in a tab where you weren't logged into this app, paste the code below.
            </p>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional: paste authorization code" />
              <Button onClick={() => connect.mutate()} disabled={!code || connect.isPending}>Save</Button>
            </div>
            <div className="mt-2 rounded-md border bg-muted/40 p-3 text-xs space-y-1">
              <div className="font-medium">Before bulk push you must:</div>
              <ul className="list-disc ml-4 space-y-0.5">
                <li>Opt in to eBay Business Policies → <a className="text-primary underline" target="_blank" rel="noreferrer" href="https://www.bizpolicy.ebay.com/businesspolicy/manage">bizpolicy.ebay.com</a></li>
                <li>Create a default payment, shipping and return policy</li>
                <li>Enable the Live Push switch on the Rules page</li>
              </ul>
            </div>
          </div>
        </IntegrationCard>

        <IntegrationCard
          icon={KeyRound}
          title="Lovable AI (built-in)"
          desc="Powers title rewrites, item-specifics guessing and category suggestions. No key needed — included with your workspace."
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
      <CardContent>{children ?? <Button variant="outline" disabled>{ready ? "Built-in" : "Configured"}</Button>}</CardContent>
    </Card>
  );
}
