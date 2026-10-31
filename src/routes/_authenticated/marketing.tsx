import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEbayCampaigns, createEbayCampaign, changeEbayCampaign } from "@/lib/ebay.functions";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { AsyncResult } from "@/components/async-result";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Pause, Play, RefreshCw, Megaphone } from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/marketing")({ head: () => pageHead("Promoted listings", "Manage eBay promoted listing campaigns with fixed or dynamic ad rates."), component: MarketingPage });

function MarketingPage() {
  const listFn = useServerFn(listEbayCampaigns);
  const createFn = useServerFn(createEbayCampaign);
  const changeFn = useServerFn(changeEbayCampaign);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [strategy, setStrategy] = useState<"FIXED" | "DYNAMIC">("FIXED");
  const [rate, setRate] = useState(2);
  const [selected, setSelected] = useState<string[]>([]);
  const campaigns = useQuery({ queryKey: ["ebay-campaigns", offset], queryFn: () => listFn({ data: { offset } }), retry: false });
  const listings = useQuery({ queryKey: ["promotable-listings"], enabled: open, queryFn: async () => { const result = await supabase.from("ebay_listings").select("ebay_item_id,title").eq("status", "active").not("ebay_item_id", "is", null).limit(500); if (result.error) throw result.error; return result.data; } });
  const create = useMutation({ mutationFn: () => createFn({ data: { name, strategy, rate, listingIds: selected } }), onSuccess: (result) => { toast.success(`Campaign created · ${result.added} listings added${result.failed ? `, ${result.failed} failed` : ""}`); setOpen(false); setSelected([]); setName(""); campaigns.refetch(); }, onError: (error: Error) => toast.error(error.message) });
  const change = useMutation({ mutationFn: (data: { id: string; action: "pause" | "resume" | "end" }) => changeFn({ data }), onSuccess: () => { toast.success("Campaign updated"); campaigns.refetch(); }, onError: (error: Error) => toast.error(error.message) });
  const total = campaigns.data?.total || 0;
  return <AppShell title="Promoted listings" subtitle="Campaigns and eBay ad rates" actions={<Button variant="ghost" size="icon" aria-label="Refresh campaigns" onClick={() => campaigns.refetch()}><RefreshCw className="h-4 w-4" /></Button>}>
    <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="mb-5"><Plus className="mr-2 h-4 w-4" />Create campaign</Button></DialogTrigger><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>New promoted listings campaign</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="campaign-name">Campaign name</Label><Input id="campaign-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label>Ad rate</Label><Select value={strategy} onValueChange={(value) => setStrategy(value === "DYNAMIC" ? "DYNAMIC" : "FIXED")}><SelectTrigger aria-label="Ad rate strategy"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FIXED">Fixed rate</SelectItem><SelectItem value="DYNAMIC">eBay daily suggested rate</SelectItem></SelectContent></Select></div>{strategy === "FIXED" && <div className="space-y-2"><Label htmlFor="ad-rate">Sale ad fee (%)</Label><Input id="ad-rate" type="number" min={2} max={100} step={0.1} value={rate} onChange={(event) => setRate(Number(event.target.value))} /></div>}<p className="text-sm text-muted-foreground">Promoted sales incur an additional eBay advertising fee.{strategy === "DYNAMIC" ? " eBay adjusts the rate daily; the fee can increase." : " The chosen percentage applies to attributed sales."}</p><Label>Listings · {selected.length} selected</Label><div className="max-h-52 space-y-3 overflow-y-auto border-y py-3">{listings.isLoading && <p>Loading listings…</p>}{listings.error && <p role="alert">{listings.error.message}</p>}{(listings.data || []).map((item) => { const id = item.ebay_item_id; if (!id) return null; return <label key={id} className="flex items-center gap-3 text-sm"><Checkbox checked={selected.includes(id)} onCheckedChange={(checked) => setSelected(checked ? [...selected, id] : selected.filter((value) => value !== id))} /><span className="line-clamp-2">{item.title}</span></label>; })}</div><Button className="w-full" disabled={!name.trim() || !selected.length || create.isPending} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create paid campaign"}</Button></div></DialogContent></Dialog>
    <AsyncResult loading={campaigns.isLoading} error={campaigns.error} retry={() => campaigns.refetch()} />
    {!campaigns.error && !campaigns.isLoading && <div className="divide-y border-y">{(campaigns.data?.campaigns || []).map((campaign) => <article key={campaign.campaignId} className="flex flex-wrap items-center justify-between gap-3 py-5"><div><h2 className="font-semibold">{campaign.campaignName}</h2><p className="mt-1 text-sm text-muted-foreground">{campaign.fundingStrategy?.adRateStrategy === "DYNAMIC" ? "Daily suggested rate" : `${campaign.fundingStrategy?.bidPercentage || "—"}% fixed rate`}</p></div><div className="flex items-center gap-2"><Badge variant="secondary">{campaign.campaignStatus}</Badge><Button variant="outline" size="icon" aria-label={campaign.campaignStatus === "PAUSED" ? "Resume campaign" : "Pause campaign"} disabled={change.isPending || campaign.campaignStatus === "ENDED"} onClick={() => change.mutate({ id: campaign.campaignId, action: campaign.campaignStatus === "PAUSED" ? "resume" : "pause" })}>{campaign.campaignStatus === "PAUSED" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button></div></article>)}{!total && <div className="py-16 text-center text-muted-foreground"><Megaphone className="mx-auto mb-3 h-8 w-8" />No campaigns found.</div>}</div>}
    <div className="mt-5 flex items-center justify-between"><p className="text-sm text-muted-foreground">{total} campaigns</p><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Previous campaigns" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="outline" aria-label="Next campaigns" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}><ChevronRight className="h-4 w-4" /></Button></div></div>
  </AppShell>;
}