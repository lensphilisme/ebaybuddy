import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAiProviderStatus } from "@/lib/ai-provider.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rules")({ head: () => pageHead("Automation rules", "Manage pricing and optimizer guardrails."), component: RulesPage });

const AI_LABELS: Record<string, string> = { deepseek: "DeepSeek", gemini: "Gemini", openai: "OpenAI", custom: "your custom AI provider" };

function RulesPage() {
  const aiStatusFn = useServerFn(getAiProviderStatus);
  const { data: user } = useQuery({ queryKey: ["user"], queryFn: async () => (await supabase.auth.getUser()).data.user });
  const { data: aiStatus } = useQuery({ queryKey: ["ai-provider-status"], queryFn: () => aiStatusFn() });
  const { data: rule, refetch, isLoading, error } = useQuery({ queryKey: ["automation-rules"], enabled: !!user, queryFn: async () => {
    const { data } = await supabase.from("automation_rules").select("*").maybeSingle();
    if (data) return data;
    if (!user) throw new Error("Sign in first.");
    const { data: created, error } = await supabase.from("automation_rules").insert({ user_id: user.id }).select().single();
    if (error) throw error; return created;
  }});
  async function save(patch: any) { if (!rule) return; const { error } = await supabase.from("automation_rules").update(patch).eq("id", rule.id); if (error) toast.error(error.message); else { toast.success("Rule saved"); refetch(); } }
  const aiName = aiStatus?.connected ? (AI_LABELS[String(aiStatus.provider || "")] || "your AI provider") : "local rules (no AI provider connected)";
  return <AppShell title="Rules" subtitle="Pricing, profit floors and the AI optimizer guardrails">
    {isLoading ? (
      <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    ) : error ? (
      <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
        Could not load your rules: {(error as Error).message}
        <div className="mt-3"><Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
      </Card>
    ) : rule && <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Pricing & guardrails</CardTitle><CardDescription>Applied when CJ products are pushed to eBay drafts.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Markup %" value={rule.markup_percent} onSave={(v) => save({ markup_percent: v })} />
        <Field label="Minimum profit $" value={rule.min_profit_usd} onSave={(v) => save({ min_profit_usd: v })} />
        <Field label="eBay fee buffer %" value={rule.ebay_fee_buffer_percent} onSave={(v) => save({ ebay_fee_buffer_percent: v })} />
        <Field label="Payment fee buffer %" value={rule.payment_fee_buffer_percent} onSave={(v) => save({ payment_fee_buffer_percent: v })} />
        <Field label="Round to (.99)" value={rule.round_to} onSave={(v) => save({ round_to: v })} step={0.01} />
        <Field label="Max listing quantity" value={rule.max_listing_quantity} onSave={(v) => save({ max_listing_quantity: v })} />
        <div className="rounded-lg border p-3 sm:col-span-2">
          <div className="flex items-center justify-between"><Label>Live Push to eBay enabled</Label><Switch checked={rule.live_listing_enabled} onCheckedChange={(v) => save({ live_listing_enabled: v })} /></div>
          <p className="text-xs text-muted-foreground mt-1">When off, drafts can be prepared but nothing is pushed to eBay and the Optimizer cannot apply changes — previews still work.</p>
        </div>
        <div className="rounded-lg border p-3 sm:col-span-2">
          <div className="flex items-center justify-between"><Label>Require preflight approval</Label><Switch checked={rule.preflight_required} onCheckedChange={(v) => save({ preflight_required: v })} /></div>
          <p className="text-xs text-muted-foreground mt-1">Marks drafts for a manual review step before they can be pushed. There is no separate preflight screen yet — drafts stay in the queue until you push them.</p>
        </div>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>AI Optimizer thresholds</CardTitle><CardDescription>The optimizer uses these numbers. Tune them, then Preview / Run on the Optimizer page.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="End if no sales after (days)" value={rule.optimizer_no_sales_days} onSave={(v) => save({ optimizer_no_sales_days: v })} />
        <Field label="Rewrite title if low views after (days)" value={rule.optimizer_low_views_days} onSave={(v) => save({ optimizer_low_views_days: v })} />
        <Field label="Flag poor exposure after (days)" value={rule.optimizer_poor_exposure_days} onSave={(v) => save({ optimizer_poor_exposure_days: v })} />
        <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2"><Label>End test listings after first sale</Label><Switch checked={rule.end_test_listings_after_success} onCheckedChange={(v) => save({ end_test_listings_after_success: v })} /></div>
        <div className="text-xs text-muted-foreground sm:col-span-2 leading-relaxed">
          <strong>How the AI applies these:</strong>
          <ul className="list-disc ml-4 mt-1 space-y-0.5">
            <li>Age &ge; <em>{rule.optimizer_no_sales_days}d</em> with 0 sales → flagged to end.</li>
            <li>Age &ge; <em>{rule.optimizer_low_views_days}d</em> with &lt; 5 views → {aiName} rewrites the title.</li>
            <li>Preflight and Live-Push switches gate the whole pipeline.</li>
          </ul>
        </div>
      </CardContent></Card>
    </div>}
  </AppShell>;
}

function Field({ label, value, onSave, step = 1 }: { label: string; value: number; onSave: (v: number) => Promise<void> | void; step?: number }) {
  const [local, setLocal] = useState(String(value));
  const [saving, setSaving] = useState(false);
  // Keep the input in sync when the saved value changes elsewhere (e.g.
  // after a save + refetch) instead of showing a stale number.
  useEffect(() => { setLocal(String(value)); }, [value]);
  return <div className="space-y-1"><Label>{label}</Label><div className="flex gap-2"><Input type="number" step={step} value={local} onChange={(e) => setLocal(e.target.value)} /><Button variant="outline" disabled={saving || Number(local) === Number(value)} onClick={() => { setSaving(true); void Promise.resolve(onSave(Number(local))).finally(() => setSaving(false)); }}>{saving ? "Saving…" : "Save"}</Button></div></div>;
}
