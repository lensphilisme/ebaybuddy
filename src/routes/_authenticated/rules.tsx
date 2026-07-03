import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/rules")({ component: RulesPage });

function RulesPage() {
  const { data: user } = useQuery({ queryKey: ["user"], queryFn: async () => (await supabase.auth.getUser()).data.user });
  const { data: rule, refetch } = useQuery({ queryKey: ["automation-rules"], enabled: !!user, queryFn: async () => {
    const { data } = await supabase.from("automation_rules").select("*").maybeSingle();
    if (data) return data;
    const { data: created, error } = await supabase.from("automation_rules").insert({ user_id: user!.id }).select().single();
    if (error) throw error; return created;
  }});
  async function save(patch: any) { const { error } = await supabase.from("automation_rules").update(patch).eq("id", rule!.id); if (error) toast.error(error.message); else { toast.success("Rule saved"); refetch(); } }
  return <AppShell title="Rules" subtitle="Pricing, profit floors and the AI optimizer guardrails">
    {rule && <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Pricing & guardrails</CardTitle><CardDescription>Applied when CJ products are pushed to eBay drafts.</CardDescription></CardHeader><CardContent className="grid gap-4 sm:grid-cols-2">
        <Field label="Markup %" value={rule.markup_percent} onSave={(v) => save({ markup_percent: v })} />
        <Field label="Minimum profit $" value={rule.min_profit_usd} onSave={(v) => save({ min_profit_usd: v })} />
        <Field label="eBay fee buffer %" value={rule.ebay_fee_buffer_percent} onSave={(v) => save({ ebay_fee_buffer_percent: v })} />
        <Field label="Payment fee buffer %" value={rule.payment_fee_buffer_percent} onSave={(v) => save({ payment_fee_buffer_percent: v })} />
        <Field label="Round to (.99)" value={rule.round_to} onSave={(v) => save({ round_to: v })} step={0.01} />
        <Field label="Max listing quantity" value={rule.max_listing_quantity} onSave={(v) => save({ max_listing_quantity: v })} />
        <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2"><Label>Live Push to eBay enabled</Label><Switch checked={rule.live_listing_enabled} onCheckedChange={(v) => save({ live_listing_enabled: v })} /></div>
        <div className="flex items-center justify-between rounded-lg border p-3 sm:col-span-2"><Label>Require preflight approval</Label><Switch checked={rule.preflight_required} onCheckedChange={(v) => save({ preflight_required: v })} /></div>
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
            <li>Age &ge; <em>{rule.optimizer_low_views_days}d</em> with &lt; 5 watchers → Gemini rewrites the title.</li>
            <li>Preflight and Live-Push switches gate the whole pipeline.</li>
          </ul>
        </div>
      </CardContent></Card>
    </div>}
  </AppShell>;
}

function Field({ label, value, onSave, step = 1 }: { label: string; value: number; onSave: (v: number) => void; step?: number }) {
  const [local, setLocal] = useState(String(value));
  return <div className="space-y-1"><Label>{label}</Label><div className="flex gap-2"><Input type="number" step={step} value={local} onChange={(e) => setLocal(e.target.value)} /><Button variant="outline" onClick={() => onSave(Number(local))}>Save</Button></div></div>;
}

