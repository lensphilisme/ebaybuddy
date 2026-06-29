import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  return <AppShell title="Rules" subtitle="Pricing, profit floors, fee buffers and listing guardrails">
    {rule && <Card><CardHeader><CardTitle>Default listing guardrails</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2">
      <Field label="Markup %" value={rule.markup_percent} onSave={(v) => save({ markup_percent: v })} />
      <Field label="Minimum profit $" value={rule.min_profit_usd} onSave={(v) => save({ min_profit_usd: v })} />
      <Field label="eBay fee buffer %" value={rule.ebay_fee_buffer_percent} onSave={(v) => save({ ebay_fee_buffer_percent: v })} />
      <Field label="Max listing quantity" value={rule.max_listing_quantity} onSave={(v) => save({ max_listing_quantity: v })} />
      <div className="flex items-center justify-between rounded-lg border p-3"><Label>Live Push to eBay enabled</Label><Switch checked={rule.live_listing_enabled} onCheckedChange={(v) => save({ live_listing_enabled: v })} /></div>
      <div className="flex items-center justify-between rounded-lg border p-3"><Label>Require preflight approval</Label><Switch checked={rule.preflight_required} onCheckedChange={(v) => save({ preflight_required: v })} /></div>
    </CardContent></Card>}
  </AppShell>;
}

function Field({ label, value, onSave }: { label: string; value: number; onSave: (v: number) => void }) {
  const [local, setLocal] = useState(String(value));
  return <div className="space-y-1"><Label>{label}</Label><div className="flex gap-2"><Input type="number" value={local} onChange={(e) => setLocal(e.target.value)} /><Button variant="outline" onClick={() => onSave(Number(local))}>Save</Button></div></div>;
}
