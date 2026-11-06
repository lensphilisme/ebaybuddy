import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { connectEbayWithCode, getEbayConnectUrl, disconnectEbay, listEbayNotificationTopics, listEbayNotificationSubscriptions, createEbayNotificationSubscription } from "@/lib/ebay.functions";
import { saveCjApiKey, getIntegrationStatus, disconnectCj } from "@/lib/cj.functions";
import { saveAiProvider, removeAiProvider, getAiProviderStatus, testAiProvider } from "@/lib/ai-provider.functions";
import { supabase } from "@/integrations/supabase/client";
import { KeyRound, Boxes, Tag, ExternalLink, Bell } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/settings")({ head: () => pageHead("Integration settings", "Connect your CJ API key and eBay seller account."), component: SettingsPage });

function SettingsPage() {
  const [code, setCode] = useState("");
  const [cjApiKey, setCjApiKey] = useState("");
  const [aiProvider, setAiProvider] = useState("deepseek");
  const [aiModel, setAiModel] = useState("");
  const [aiKey, setAiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState("");
  const [notifTopic, setNotifTopic] = useState("");
  const [confirmDisconnect, setConfirmDisconnect] = useState<"cj" | "ebay" | null>(null);
  const [aiKeyTest, setAiKeyTest] = useState<"ok" | "invalid" | null>(null);
  const urlFn = useServerFn(getEbayConnectUrl);
  const connectFn = useServerFn(connectEbayWithCode);
  const disconnectEbayFn = useServerFn(disconnectEbay);
  const cjSaveFn = useServerFn(saveCjApiKey);
  const disconnectCjFn = useServerFn(disconnectCj);
  const statusFn = useServerFn(getIntegrationStatus);
  const aiSaveFn = useServerFn(saveAiProvider);
  const aiRemoveFn = useServerFn(removeAiProvider);
  const aiStatusFn = useServerFn(getAiProviderStatus);
  const aiTestFn = useServerFn(testAiProvider);
  const topicsFn = useServerFn(listEbayNotificationTopics);
  const subsFn = useServerFn(listEbayNotificationSubscriptions);
  const subscribeFn = useServerFn(createEbayNotificationSubscription);

  // Refetch on every mount (bug 14): after the OAuth callback lands on
  // Settings, the cached "not connected" status must not linger — the
  // callback invalidates this query AND mounting re-reads it, so the
  // connected state shows immediately without a manual reload.
  const { data: status, refetch } = useQuery({
    queryKey: ["integration-status"],
    queryFn: () => statusFn(),
    refetchOnMount: "always",
  });
  const { data: aiStatus, refetch: refetchAi } = useQuery({
    queryKey: ["ai-provider-status"],
    queryFn: () => aiStatusFn(),
  });
  const { data: topics, error: topicsError } = useQuery({
    queryKey: ["ebay-notification-topics"],
    queryFn: () => topicsFn(),
    retry: false,
  });
  const { data: subs, refetch: refetchSubs, error: subsError } = useQuery({
    queryKey: ["ebay-notification-subscriptions"],
    queryFn: () => subsFn(),
    retry: false,
  });
  const subscribe = useMutation({
    mutationFn: () => subscribeFn({ data: { topicId: notifTopic } }),
    onSuccess: (r: any) => { toast.success(`Subscribed to ${r.topicId}`); setNotifTopic(""); refetchSubs(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const subscribedTopicIds = new Set((subs?.subscriptions || []).map((s: any) => s.topicId));
  // The header bell links here with #notifications — scroll to the card.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#notifications") {
      document.getElementById("notifications")?.scrollIntoView({ behavior: "smooth" });
    }
  }, []);
  const ebayCred = { is_active: !!status?.ebay.connected, source: status?.ebay.source };
  const cjCred = { is_active: !!status?.cj.connected, source: status?.cj.source };
  const aiProviderMeta: Record<string, { label: string; defaultModel: string; keyUrl: string; hint: string }> = {
    deepseek: { label: "DeepSeek (cheapest)", defaultModel: "deepseek-v4-flash", keyUrl: "https://platform.deepseek.com/api_keys", hint: "About $0.14 in / $0.28 out per 1M tokens. Best value for listing work." },
    gemini: { label: "Google Gemini", defaultModel: "gemini-2.5-flash", keyUrl: "https://aistudio.google.com/apikey", hint: "About $0.30 in / $2.50 out per 1M tokens. Google AI Studio has a free tier." },
    openai: { label: "OpenAI", defaultModel: "gpt-4o-mini", keyUrl: "https://platform.openai.com/api-keys", hint: "gpt-4o-mini is about $0.15 in / $0.60 out per 1M tokens." },
    custom: { label: "Custom (OpenAI-compatible)", defaultModel: "", keyUrl: "", hint: "Any endpoint that speaks the OpenAI chat-completions format." },
  };
  const AI_LABELS: Record<string, string> = { deepseek: "DeepSeek", gemini: "Gemini", openai: "OpenAI", custom: "Custom" };
  const aiMeta = aiProviderMeta[aiProvider] || aiProviderMeta.deepseek;

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
    mutationFn: () => cjSaveFn({ data: { apiKey: cjApiKey } }),
    onSuccess: () => { toast.success("CJ API key verified and connected"); setCjApiKey(""); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const saveAi = useMutation({
    mutationFn: () => aiSaveFn({ data: { provider: aiProvider, model: aiModel || undefined, apiKey: aiKey, baseUrl: aiBaseUrl || undefined } }),
    onSuccess: (r: { provider: string; model: string }) => { toast.success(`AI provider connected: ${r.provider} (${r.model})`); setAiKey(""); refetchAi(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const removeAi = useMutation({
    mutationFn: () => aiRemoveFn(),
    onSuccess: () => { toast.success("AI provider removed — listing AI now uses local rules"); setAiKeyTest(null); refetchAi(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const testAi = useMutation({
    mutationFn: () => aiTestFn(),
    onSuccess: (r: { provider: string; model: string }) => { setAiKeyTest("ok"); toast.success(`Key works — ${r.provider} (${r.model})`); refetchAi(); },
    onError: (e: Error) => { setAiKeyTest("invalid"); toast.error(`Key invalid: ${e.message}`); },
  });
  const disconnectCjMut = useMutation({
    mutationFn: () => disconnectCjFn(),
    onSuccess: () => { toast.success("CJ disconnected — CJ calls stop; drafts and listings stay in the app"); setConfirmDisconnect(null); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const disconnectEbayMut = useMutation({
    mutationFn: () => disconnectEbayFn(),
    onSuccess: () => { toast.success("eBay disconnected — eBay calls stop; listings and drafts stay in the app"); setConfirmDisconnect(null); refetch(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="Settings" subtitle="Connect CJ, eBay and your AI provider">
      <div className="grid gap-4 lg:grid-cols-2">
        <IntegrationCard
          icon={Boxes}
          title="CJ Dropshipping"
          desc="Connect your CJ account with an API key. Access tokens renew automatically."
          status={cjCred.is_active ? (cjCred.source === "env" ? "Connected (workspace)" : "Connected") : "Not connected"}
          ready={cjCred.is_active}
        >
          <div className="space-y-2">
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" aria-label="CJ API key" value={cjApiKey} onChange={(e) => setCjApiKey(e.target.value)} placeholder="CJ API key" className="min-w-0 flex-1" />
              <Button onClick={() => saveCj.mutate()} disabled={!cjApiKey.trim() || saveCj.isPending}>{saveCj.isPending ? "Verifying…" : "Connect"}</Button>
            </div>
            {cjCred.is_active && (
              <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect("cj")}>Disconnect CJ</Button>
            )}
            <p className="text-xs text-muted-foreground">
              Get your API key at{" "}
              <a className="text-primary underline inline-flex items-center gap-1" href="https://developers.cjdropshipping.com" target="_blank" rel="noreferrer">
                developers.cjdropshipping.com <ExternalLink className="h-3 w-3" />
              </a>{" "}— My CJ → Authorization → API. Do not paste an access token.
            </p>
          </div>
        </IntegrationCard>

        <IntegrationCard
          icon={Tag}
          title="eBay"
          desc="Connect any seller account with eBay login. Your seller sign-in is stored server-side; the app's own eBay API keys live in the server settings, not here."
          status={ebayCred.is_active ? "Connected" : "Needs OAuth"}
          ready={ebayCred.is_active}
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => openOAuth.mutate()} disabled={openOAuth.isPending}>
                {ebayCred.is_active ? "Reconnect eBay" : "Open eBay OAuth"} <ExternalLink className="h-3 w-3 ml-1" />
              </Button>
              {ebayCred.is_active && (
                <Button variant="outline" size="sm" onClick={() => setConfirmDisconnect("ebay")}>Disconnect eBay</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              eBay redirects back here and stores the seller token automatically for the signed-in app user.
            </p>
            <p className="text-xs text-muted-foreground">
              If you connected eBay before Nov 2026, reconnect once — the app now also asks for notification and fulfillment access (returns and order updates).
            </p>
            <div className="flex gap-2">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Optional: paste authorization code" className="min-w-0 flex-1" />
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
          title="Listing AI (your own provider)"
          desc="Title rewrites, item-specifics, draft repair and category picks use your AI provider. Without one, the built-in local rules run instead — nothing breaks."
          status={aiStatus?.connected
            ? [AI_LABELS[String(aiStatus.provider || "deepseek")] || "AI", aiStatus.model || "", aiStatus.keyLast4 ? `••••${aiStatus.keyLast4}` : "", aiStatus.source === "env" ? "(workspace)" : ""].filter(Boolean).join(" · ")
            : aiStatus?.provider
              ? `${AI_LABELS[String(aiStatus.provider)] || "AI"} · no key saved`
              : "Local only"}
          ready={!!aiStatus?.connected}
        >
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              API key: <span className="font-medium text-foreground">{aiKeyTest === "invalid" ? "Key invalid" : aiStatus?.connected ? "Key saved · tested OK" : "No key saved"}</span>
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Select value={aiProvider} onValueChange={(v) => { setAiProvider(v); setAiModel(""); }}>
                <SelectTrigger aria-label="AI provider" className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(aiProviderMeta).map(([id, meta]) => (
                    <SelectItem key={id} value={id}>{meta.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                aria-label="AI model"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder={aiMeta.defaultModel || "model name"}
                className="min-w-0 flex-1"
              />
            </div>
            {aiProvider === "custom" && (
              <Input aria-label="Custom base URL" value={aiBaseUrl} onChange={(e) => setAiBaseUrl(e.target.value)} placeholder="https://your-endpoint.example/v1" />
            )}
            <div className="flex flex-wrap gap-2">
              <Input type="password" autoComplete="off" aria-label="AI API key" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder={aiStatus?.connected ? "Paste a new key to replace the saved one" : "Paste your API key"} className="min-w-0 flex-1" />
              <Button onClick={() => saveAi.mutate()} disabled={!aiKey.trim() || saveAi.isPending}>{saveAi.isPending ? "Testing…" : aiStatus?.connected ? "Replace key" : "Connect"}</Button>
              {aiStatus?.connected && (
                <Button variant="outline" onClick={() => testAi.mutate()} disabled={testAi.isPending}>{testAi.isPending ? "Testing…" : "Test key"}</Button>
              )}
              {aiStatus?.connected && aiStatus?.source === "user" && (
                <Button variant="outline" onClick={() => removeAi.mutate()} disabled={removeAi.isPending}>Remove key</Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {`${aiMeta.hint} `}
              {aiMeta.keyUrl ? (
                <>Get a key at{" "}
                  <a className="text-primary underline inline-flex items-center gap-1" href={aiMeta.keyUrl} target="_blank" rel="noreferrer">
                    {aiMeta.keyUrl.replace(/^https:\/\//, "")} <ExternalLink className="h-3 w-3" />
                  </a>{". "}
                </>
              ) : null}
              Your key is tested live, saved server-side, and never shown again. Prices change — check the provider's pricing page.
            </p>
          </div>
        </IntegrationCard>
      </div>

      <Card id="notifications" className="mt-4 shadow-[var(--shadow-card)]">
        <CardHeader className="flex flex-row items-start gap-4 space-y-0">
          <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center"><Bell className="h-5 w-5" /></div>
          <div className="flex-1">
            <CardTitle>eBay notifications</CardTitle>
            <CardDescription className="mt-1">
              eBay can push order, sale and return events to this app the moment they happen. The app receives them at its public webhook address; subscribing to a topic tells eBay to send that event here.
            </CardDescription>
          </div>
          <span className="rounded-full bg-muted text-muted-foreground text-xs px-2 py-0.5 font-medium">{`${(subs?.subscriptions || []).length} subscribed`}</span>
        </CardHeader>
        <CardContent className="space-y-4">
          {topicsError && <p className="text-sm text-destructive">Could not load eBay topics: {(topicsError as Error).message}</p>}
          {subsError && <p className="text-sm text-destructive">Could not load your subscriptions: {(subsError as Error).message}</p>}
          {(subs?.subscriptions || []).length > 0 && (
            <div>
              <div className="text-sm font-medium mb-2">Your subscriptions</div>
              <ul className="space-y-1 text-sm">
                {(subs?.subscriptions || []).map((s: any) => (
                  <li key={s.subscriptionId} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{s.topicId}</span>
                    <span className="rounded-full bg-success/10 text-success text-xs px-2 py-0.5 font-medium">{s.status || "ENABLED"}</span>
                    <span className="text-xs text-muted-foreground">destination {s.destinationId}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="text-sm font-medium mb-2">Subscribe to a topic</div>
            <div className="flex gap-2">
              <Select value={notifTopic} onValueChange={setNotifTopic}>
                <SelectTrigger aria-label="Notification topic" className="flex-1"><SelectValue placeholder="Choose a topic" /></SelectTrigger>
                <SelectContent>
                  {(topics?.topics || []).map((t: any) => (
                    <SelectItem key={t.topicId} value={t.topicId} disabled={t.status !== "ENABLED" || subscribedTopicIds.has(t.topicId)}>
                      {t.topicId}{subscribedTopicIds.has(t.topicId) ? " — subscribed" : t.status !== "ENABLED" ? ` — ${t.status}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={() => subscribe.mutate()} disabled={!notifTopic || subscribe.isPending}>{subscribe.isPending ? "Subscribing…" : "Subscribe"}</Button>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Recommended first: MARKETPLACE_CHECKOUT_ORDER_CLOSED (a buyer checked out), ITEM_SOLD (a sale) and RETURN_CREATED (a return was opened).
              Subscribing needs an eBay webhook destination pointing at this app — if it fails, create the destination in eBay first, then set its ID as EBAY_NOTIFICATION_DESTINATION_ID on the server.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Disconnect confirmations (audit #51): removing the saved key/token
          stops that integration's calls. Drafts and listings stay in the
          app; nothing is deleted or ended on eBay or CJ. */}
      <AlertDialog open={confirmDisconnect !== null} onOpenChange={(open) => !open && setConfirmDisconnect(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmDisconnect === "cj" ? "Disconnect CJ Dropshipping?" : "Disconnect eBay?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDisconnect === "cj"
                ? "Removes your saved CJ API key. CJ product search, quotes and stock checks stop working until you reconnect. Drafts and listings already in the app are kept."
                : "Removes your saved eBay seller token. Sync, push, orders and marketing stop working until you reconnect. Listings already on eBay are NOT ended, and drafts in the app are kept."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep connected</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (confirmDisconnect === "cj") disconnectCjMut.mutate(); else if (confirmDisconnect === "ebay") disconnectEbayMut.mutate(); }}
            >
              {confirmDisconnect === "cj" ? "Disconnect CJ" : "Disconnect eBay"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
