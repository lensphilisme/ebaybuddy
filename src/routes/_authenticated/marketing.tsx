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
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, ChevronRight, Plus, Pause, Play, RefreshCw, Megaphone, Square, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { pageHead } from "@/lib/page-head";

export const Route = createFileRoute("/_authenticated/marketing")({ head: () => pageHead("Marketing", "Manage eBay promoted listing campaigns with fixed or dynamic ad rates."), component: MarketingPage });

/**
 * eBay auto-names a campaign "Campaign MM/DD/YYYY HH:MM:SS" when no name
 * was given — a bare timestamp is not a readable name. Show a readable
 * label with the start date instead; real names pass through untouched.
 */
function displayCampaignName(campaign: any): string {
  const name = String(campaign.campaignName || "").trim();
  const m = name.match(/^Campaign\s+(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    const started = campaign.startDate ? new Date(campaign.startDate) : d;
    const label = Number.isNaN(started.getTime())
      ? "Promoted Listings"
      : `Promoted Listings · started ${started.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
    return label;
  }
  return name || "Promoted Listings campaign";
}

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
  const [pickerSearch, setPickerSearch] = useState("");
  const [endId, setEndId] = useState<string | null>(null);
  const campaigns = useQuery({ queryKey: ["ebay-campaigns", offset], queryFn: () => listFn({ data: { offset } }), retry: false });
  const listings = useQuery({ queryKey: ["promotable-listings"], enabled: open, queryFn: async () => { const result = await supabase.from("ebay_listings").select("ebay_item_id,title").eq("status", "active").not("ebay_item_id", "is", null).limit(500); if (result.error) throw result.error; return result.data; } });
  const create = useMutation({ mutationFn: () => createFn({ data: { name, strategy, rate, listingIds: selected } }), onSuccess: (result) => { toast.success(`Campaign created · ${result.added} listings added${result.failed ? `, ${result.failed} failed` : ""}`); setOpen(false); setSelected([]); setName(""); campaigns.refetch(); }, onError: (error: Error) => toast.error(error.message) });
  const change = useMutation({ mutationFn: (data: { id: string; action: "pause" | "resume" | "end" }) => changeFn({ data }), onSuccess: () => { toast.success("Campaign updated"); campaigns.refetch(); }, onError: (error: Error) => toast.error(error.message) });
  const total = campaigns.data?.total || 0;
  // The old icon-only refresh gave no feedback at all (bug 19): label it,
  // spin while fetching, and toast the outcome with count + time.
  const refreshCampaigns = async () => {
    const result = await campaigns.refetch();
    if (result.isError) toast.error(`Refresh failed: ${(result.error as Error)?.message || "eBay request failed"}`);
    else {
      const count = campaigns.data?.campaigns?.length || 0;
      const time = new Date().toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      toast.success(`Campaigns refreshed · ${count} campaign${count === 1 ? "" : "s"} · ${time}`);
    }
  };
  const promotableCount = listings.data?.length ?? 0;
  return <AppShell title="Marketing" subtitle="Promoted listings campaigns" actions={<Button variant="outline" size="sm" onClick={refreshCampaigns} disabled={campaigns.isFetching}>{campaigns.isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}Refresh</Button>}>
    <div className="space-y-6">
    <p className="text-xs text-muted-foreground">Performance (clicks, impressions, spend, sales, revenue) is not returned by eBay's campaign list API — it lives in eBay's Seller Hub advertising reports.</p>
    <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button><Plus className="mr-2 h-4 w-4" />Create campaign</Button></DialogTrigger><DialogContent className="max-h-[85dvh] overflow-y-auto"><DialogHeader><DialogTitle>New promoted listings campaign</DialogTitle></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="campaign-name">Campaign name</Label><Input id="campaign-name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></div><div className="space-y-2"><Label>Ad rate</Label><Select value={strategy} onValueChange={(value) => setStrategy(value === "DYNAMIC" ? "DYNAMIC" : "FIXED")}><SelectTrigger aria-label="Ad rate strategy"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="FIXED">Fixed rate</SelectItem><SelectItem value="DYNAMIC">eBay daily suggested rate</SelectItem></SelectContent></Select></div>{strategy === "FIXED" && <div className="space-y-2"><Label htmlFor="ad-rate">Sale ad fee (%)</Label><Input id="ad-rate" type="number" min={2} max={100} step={0.1} value={rate} onChange={(event) => setRate(Number(event.target.value))} /></div>}<p className="text-sm text-muted-foreground">{`Promoted sales incur an additional eBay advertising fee.${strategy === "DYNAMIC" ? " eBay adjusts the rate daily; the fee can increase." : " The chosen percentage applies to attributed sales."}`}</p><Label>{`Listings · ${selected.length} selected`}</Label><Input placeholder="Search listings by title or item ID…" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)} /><div className="max-h-52 space-y-3 overflow-y-auto border-y py-3">{listings.isLoading && <p>Loading listings…</p>}{listings.error && <p role="alert">{listings.error.message}</p>}{!listings.isLoading && !listings.error && promotableCount === 0 && <p className="text-sm text-muted-foreground">No listings available — sync or push a draft first.</p>}{(listings.data || []).filter((item) => { const q = pickerSearch.trim().toLowerCase(); return !q || (item.title || "").toLowerCase().includes(q) || String(item.ebay_item_id || "").includes(q); }).map((item) => { const id = item.ebay_item_id; if (!id) return null; return <label key={id} className="flex items-center gap-3 text-sm"><Checkbox checked={selected.includes(id)} onCheckedChange={(checked) => setSelected(checked ? [...selected, id] : selected.filter((value) => value !== id))} /><span className="line-clamp-2">{item.title}</span></label>; })}</div>{promotableCount === 0 && !listings.isLoading && <p className="text-xs text-muted-foreground">Create paid campaign is disabled because there are no active listings to promote. Sync eBay or push a draft first.</p>}<Button className="w-full" disabled={!name.trim() || !selected.length || create.isPending || promotableCount === 0} title={promotableCount === 0 ? "No listings available — sync or push a draft first" : undefined} onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create paid campaign"}</Button></div></DialogContent></Dialog>
    <AsyncResult loading={campaigns.isLoading} error={campaigns.error} retry={() => campaigns.refetch()} />
    {!campaigns.error && !campaigns.isLoading && <div className="divide-y border-y">{(campaigns.data?.campaigns || []).map((campaign) => <article key={campaign.campaignId} className="flex flex-wrap items-center justify-between gap-3 py-5"><div className="min-w-0"><h2 className="font-semibold break-words">{displayCampaignName(campaign)}</h2><p className="mt-1 text-sm text-muted-foreground">{campaign.fundingStrategy?.adRateStrategy === "DYNAMIC" ? "Daily suggested rate" : `${campaign.fundingStrategy?.bidPercentage || "—"}% fixed rate`}</p><p className="mt-1 text-xs text-muted-foreground">Campaign ID {campaign.campaignId}{campaign.adCount != null ? ` · ${campaign.adCount} listing${campaign.adCount === 1 ? "" : "s"} included` : ""}</p></div><div className="flex items-center gap-2"><Badge variant="secondary">{campaign.campaignStatus}</Badge><Button variant="outline" size="icon" aria-label={campaign.campaignStatus === "PAUSED" ? "Resume campaign" : "Pause campaign"} title={campaign.campaignStatus === "PAUSED" ? "Resume — ads start running again" : "Pause — ads stop running but the campaign can be resumed"} disabled={change.isPending || campaign.campaignStatus === "ENDED"} onClick={() => change.mutate({ id: campaign.campaignId, action: campaign.campaignStatus === "PAUSED" ? "resume" : "pause" })}>{campaign.campaignStatus === "PAUSED" ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}</Button><Button variant="outline" size="sm" title="End — stops the campaign permanently; it cannot be resumed" disabled={change.isPending || campaign.campaignStatus === "ENDED"} onClick={() => setEndId(campaign.campaignId)}><Square className="h-3 w-3 mr-1" />End</Button></div></article>)}{!total && <div className="py-16 text-center text-muted-foreground"><Megaphone className="mx-auto mb-3 h-8 w-8" />No campaigns found.</div>}</div>}
    <AlertDialog open={endId !== null} onOpenChange={(open) => !open && setEndId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End this campaign?</AlertDialogTitle>
          <AlertDialogDescription>Ending stops all promoted listings in the campaign right away. It cannot be resumed — you would need to create a new campaign.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (endId) change.mutate({ id: endId, action: "end" }); setEndId(null); }}>End campaign</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    <div className="flex items-center justify-between"><p className="text-sm text-muted-foreground">{`${total} campaign${total === 1 ? "" : "s"}`}</p><div className="flex gap-2"><Button size="icon" variant="outline" aria-label="Previous campaigns" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="h-4 w-4" /></Button><Button size="icon" variant="outline" aria-label="Next campaigns" disabled={offset + 50 >= total} onClick={() => setOffset(offset + 50)}><ChevronRight className="h-4 w-4" /></Button></div></div>
    </div>
  </AppShell>;
}