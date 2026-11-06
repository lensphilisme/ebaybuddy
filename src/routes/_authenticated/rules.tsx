import { pageHead } from "@/lib/page-head";
import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getAiProviderStatus } from "@/lib/ai-provider.functions";
import { moneyInputValue } from "@/lib/pricing";
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

// Numeric rules edited together and saved with ONE "Save all" (audit #47).
// Switches stay immediate-save — they are single toggles, not form fields.
const NUMBER_FIELDS = [
  "markup_percent",
  "min_profit_usd",
  "ebay_fee_buffer_percent",
  "payment_fee_buffer_percent",
  "round_to",
  "max_listing_quantity",
  "optimizer_no_sales_days",
  "optimizer_low_views_days",
  "optimizer_poor_exposure_days",
  "best_offer_min_percent",
  "optimizer_price_drop_max_percent",
  "promoted_auto_max_rate_percent",
] as const;

type NumberFieldKey = (typeof NUMBER_FIELDS)[number];

const FIELD_META: Record<NumberFieldKey, { label: string; step: number; hint?: string }> = {
  markup_percent: { label: "Markup %", step: 1 },
  min_profit_usd: { label: "Minimum profit $", step: 0.01 },
  ebay_fee_buffer_percent: { label: "eBay fee buffer %", step: 1 },
  payment_fee_buffer_percent: { label: "Payment fee buffer %", step: 1 },
  round_to: { label: "Round to (.99)", step: 0.01 },
  max_listing_quantity: { label: "Max listing quantity", step: 1 },
  optimizer_no_sales_days: { label: "End if no sales after (days)", step: 1 },
  optimizer_low_views_days: { label: "Rewrite title if low views after (days)", step: 1 },
  optimizer_poor_exposure_days: { label: "Flag poor exposure after (days)", step: 1, hint: "Flag day must be less than End day — flagging only helps if it happens before the listing is ended." },
  best_offer_min_percent: { label: "Best Offer — auto-decline below % of sell price", step: 1 },
  optimizer_price_drop_max_percent: { label: "Price-drop — max total cut %", step: 1 },
  promoted_auto_max_rate_percent: { label: "Promoted auto — max ad rate %", step: 1 },
};

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
  // Local draft of the numeric fields, so nine per-field Save buttons are
  // replaced by one "Save all" (audit #47). Switches save immediately.
  const [draft, setDraft] = useState<Record<NumberFieldKey, string> | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  useEffect(() => {
    if (!rule) return;
    setDraft(Object.fromEntries(NUMBER_FIELDS.map((k) => [k, formatValue(rule[k] ?? defaultFor(k), FIELD_META[k].step)])) as Record<NumberFieldKey, string>);
  }, [rule?.id]);
  async function save(patch: any) {
    if (!rule) return;
    const { error } = await supabase.from("automation_rules").update(patch).eq("id", rule.id);
    if (error) toast.error(error.message);
    else { toast.success("Rule saved"); refetch(); }
  }
  const dirty = Boolean(rule && draft && NUMBER_FIELDS.some((k) => normalize(Number(draft[k]), FIELD_META[k].step) !== normalize(Number(rule[k] ?? defaultFor(k)), FIELD_META[k].step) || storedNeedsRewrite(rule[k], FIELD_META[k].step)));
  async function saveAll() {
    if (!rule || !draft || !dirty) return;
    setSavingAll(true);
    const patch: { [K in NumberFieldKey]?: number } = {};
    for (const k of NUMBER_FIELDS) {
      const v = normalize(Number(draft[k]), FIELD_META[k].step);
      const stored = normalize(Number(rule[k] ?? defaultFor(k)), FIELD_META[k].step);
      if (Number.isFinite(v) && (v !== stored || storedNeedsRewrite(rule[k], FIELD_META[k].step))) patch[k] = v;
    }
    const { error } = await supabase.from("automation_rules").update(patch).eq("id", rule.id);
    setSavingAll(false);
    if (error) toast.error(error.message);
    else { toast.success("Rules saved"); refetch(); }
  }
  // Dynamic AI copy (audit #45): name the SELECTED provider from the DB,
  // not just "connected" — getAiConfigStatus now returns the provider even
  // when no key is saved yet, so DeepSeek selected reads "DeepSeek".
  const aiName = aiStatus?.provider ? (AI_LABELS[String(aiStatus.provider)] || "your AI provider") : "local rules";
  const aiNote = aiStatus?.connected ? `AI provider: ${aiName}` : aiStatus?.provider ? `AI provider: ${aiName} (key not saved yet — AI actions use local rules)` : "AI provider: none selected — AI actions use local rules";
  return <AppShell title="Rules" subtitle="Pricing, profit floors and the AI optimizer guardrails">
    {isLoading ? (
      <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
    ) : error ? (
      <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive shadow-[var(--shadow-card)]">
        Could not load your rules: {(error as Error).message}
        <div className="mt-3"><Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button></div>
      </Card>
    ) : rule && draft && <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-[var(--shadow-card)]"><CardHeader><CardTitle>Pricing & guardrails</CardTitle><CardDescription>Applied when CJ products are pushed to eBay drafts.</CardDescription></CardHeader><CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
          <Field label={FIELD_META.markup_percent.label} value={draft.markup_percent} onChange={(v) => setDraft({ ...draft, markup_percent: v })} />
          <Field label={FIELD_META.min_profit_usd.label} value={draft.min_profit_usd} onChange={(v) => setDraft({ ...draft, min_profit_usd: v })} step={0.01} />
          <Field label={FIELD_META.ebay_fee_buffer_percent.label} value={draft.ebay_fee_buffer_percent} onChange={(v) => setDraft({ ...draft, ebay_fee_buffer_percent: v })} />
          <Field label={FIELD_META.payment_fee_buffer_percent.label} value={draft.payment_fee_buffer_percent} onChange={(v) => setDraft({ ...draft, payment_fee_buffer_percent: v })} />
          <Field label={FIELD_META.round_to.label} value={draft.round_to} onChange={(v) => setDraft({ ...draft, round_to: v })} step={0.01} />
          <Field label={FIELD_META.max_listing_quantity.label} value={draft.max_listing_quantity} onChange={(v) => setDraft({ ...draft, max_listing_quantity: v })} />
          <div className="rounded-lg border p-3 sm:col-span-2">
            <div className="flex items-center justify-between"><Label>Live Push to eBay enabled</Label><Switch checked={rule.live_listing_enabled} onCheckedChange={(v) => save({ live_listing_enabled: v })} /></div>
            <p className="text-xs text-muted-foreground mt-1">When off, drafts can be prepared but nothing is pushed to eBay and the Optimizer cannot apply changes — previews still work.</p>
          </div>
          <div className="rounded-lg border p-3 sm:col-span-2">
            <div className="flex items-center justify-between"><Label>Require preflight approval</Label><Switch checked={rule.preflight_required} onCheckedChange={(v) => save({ preflight_required: v })} /></div>
            <p className="text-xs text-muted-foreground mt-1">When on, the push dialog shows the full preflight checklist (category, Brand, images, price, fees, shipping quoted) and needs your explicit confirm. When off, the dialog is a compact confirm.</p>
          </div>
        </CardContent></Card>

        <Card className="shadow-[var(--shadow-card)]"><CardHeader><CardTitle>AI Optimizer thresholds</CardTitle><CardDescription>The optimizer uses these numbers. Tune them, then Preview / Run on the Optimizer page.</CardDescription></CardHeader><CardContent className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
          <Field label={FIELD_META.optimizer_no_sales_days.label} value={draft.optimizer_no_sales_days} onChange={(v) => setDraft({ ...draft, optimizer_no_sales_days: v })} />
          <Field label={FIELD_META.optimizer_low_views_days.label} value={draft.optimizer_low_views_days} onChange={(v) => setDraft({ ...draft, optimizer_low_views_days: v })} />
          <Field label={FIELD_META.optimizer_poor_exposure_days.label} value={draft.optimizer_poor_exposure_days} onChange={(v) => setDraft({ ...draft, optimizer_poor_exposure_days: v })} hint={FIELD_META.optimizer_poor_exposure_days.hint} />
          <div className="text-xs text-muted-foreground sm:col-span-2 leading-relaxed">
            <strong>How the AI applies these:</strong>
            <ul className="list-disc ml-4 mt-1 space-y-0.5">
              <li>Age &ge; <em>{rule.optimizer_no_sales_days ?? 30}d</em> with 0 sales → price-drop first, then flagged to end.</li>
              <li>Age &ge; <em>{rule.optimizer_low_views_days ?? 14}d</em> with &lt; 5 views → {aiName} rewrites the title.</li>
              <li>{aiNote}.</li>
              <li>Preflight and Live-Push switches gate the whole pipeline.</li>
            </ul>
          </div>
        </CardContent></Card>

        <Card className="shadow-[var(--shadow-card)]"><CardHeader><CardTitle>Best Offer</CardTitle><CardDescription>Let buyers make offers on new pushes.</CardDescription></CardHeader><CardContent className="grid gap-4 p-4 sm:p-6">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between"><Label>Best Offer on new pushes</Label><Switch checked={rule.best_offer_enabled ?? true} onCheckedChange={(v) => save({ best_offer_enabled: v })} /></div>
            <p className="text-xs text-muted-foreground mt-1">When on, new listings accept offers. Offers at or above the minimum below are declined automatically; offers in between wait for you to accept or decline. Only affects NEW pushes — existing listings are never changed.</p>
          </div>
          <Field label={FIELD_META.best_offer_min_percent.label} value={draft.best_offer_min_percent} onChange={(v) => setDraft({ ...draft, best_offer_min_percent: v })} />
        </CardContent></Card>

        <Card className="shadow-[var(--shadow-card)]"><CardHeader><CardTitle>Price-drop ladder</CardTitle><CardDescription>Give slow listings one more chance before ending them.</CardDescription></CardHeader><CardContent className="grid gap-4 p-4 sm:p-6">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between"><Label>Price-drop after 30 days with no sale</Label><Switch checked={rule.optimizer_price_drop_enabled ?? true} onCheckedChange={(v) => save({ optimizer_price_drop_enabled: v })} /></div>
            <p className="text-xs text-muted-foreground mt-1">When on, the optimizer cuts a listing&apos;s price by 5% instead of ending it — never below the landed cost + minimum profit, and never more than the total cap below the original price. Single-variant listings only; variant listings are skipped.</p>
          </div>
          <Field label={FIELD_META.optimizer_price_drop_max_percent.label} value={draft.optimizer_price_drop_max_percent} onChange={(v) => setDraft({ ...draft, optimizer_price_drop_max_percent: v })} />
        </CardContent></Card>

        <Card className="shadow-[var(--shadow-card)]"><CardHeader><CardTitle>Promoted auto-rules</CardTitle><CardDescription>Let the optimizer run ads for you — off by default.</CardDescription></CardHeader><CardContent className="grid gap-4 p-4 sm:p-6">
          <div className="rounded-lg border p-3">
            <div className="flex items-center justify-between"><Label>Auto-promote listings with views but no sales</Label><Switch checked={rule.promoted_auto_enabled ?? false} onCheckedChange={(v) => save({ promoted_auto_enabled: v })} /></div>
            <p className="text-xs text-muted-foreground mt-1">When on, the optimizer creates ONE Promoted Listings campaign (FIXED rate, at most the rate below) for a listing with views but no sales after the end-days threshold, and pauses campaigns whose listings get views but no sales. Ads spend real money — this is off by default and only runs when you turn it on.</p>
          </div>
          <Field label={FIELD_META.promoted_auto_max_rate_percent.label} value={draft.promoted_auto_max_rate_percent} onChange={(v) => setDraft({ ...draft, promoted_auto_max_rate_percent: v })} />
        </CardContent></Card>
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={saveAll} disabled={!dirty || savingAll}>{savingAll ? "Saving…" : "Save all"}</Button>
        {dirty
          ? <span className="text-sm text-amber-600">You have unsaved changes.</span>
          : <span className="text-sm text-muted-foreground">All changes saved.</span>}
      </div>
    </div>}
  </AppShell>;
}

function defaultFor(key: NumberFieldKey): number {
  switch (key) {
    case "best_offer_min_percent": return 80;
    case "optimizer_price_drop_max_percent": return 20;
    case "promoted_auto_max_rate_percent": return 10;
    case "optimizer_poor_exposure_days": return 14;
    case "optimizer_no_sales_days": return 30;
    case "optimizer_low_views_days": return 14;
    default: return 0;
  }
}

function formatValue(v: number, step: number) {
  return step < 1 ? moneyInputValue(v) : String(v);
}

function normalize(v: number, step: number) {
  return step < 1 ? Math.round(v * 100) / 100 : v;
}

// A stored value carrying a float32 artifact (0.9900000095367432) reads
// back different from its clean 2dp form — it needs a rewrite even when
// the user changed nothing, or the artifact lives in the row forever.
// (The column-type migration is the durable fix; this makes one Save-all
// click clean the stored value in the meantime.)
function storedNeedsRewrite(raw: unknown, step: number): boolean {
  const n = Number(raw);
  return Number.isFinite(n) && n !== normalize(n, step);
}

function Field({ label, value, onChange, step = 1, hint }: { label: string; value: string; onChange: (v: string) => void; step?: number; hint?: string }) {
  // Money-style fields (step < 1, e.g. Round to .99) come back from the DB
  // as float32 artifacts like 0.9900000095367432 — display and save them at
  // 2 decimals so the artifact never leaks into the input (bug 11).
  return <div className="space-y-1"><Label>{label}</Label><Input type="number" step={step} value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1" />{hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}</div>;
}
