import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjProduct, getCjFreight } from "@/lib/cj.functions";
import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { ArrowLeft, Loader2, Truck, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import { priceFromRules, parseMoney, roundMoney, floorBindsNote, roundingNote, PRICING_DEFAULTS } from "@/lib/pricing";
import { buildCjDraftRow, cleanImageList, variantAxes, variantOptionMap } from "@/lib/draft-from-cj";

export const Route = createFileRoute("/_authenticated/products/$pid")({ head: () => pageHead("CJ product details", "Inspect CJ variants, images and live freight pricing."),
  component: ProductDetailPage,
});

const COUNTRIES = [
  { code: "US", name: "United States" },
  { code: "GB", name: "United Kingdom" },
  { code: "CA", name: "Canada" },
  { code: "AU", name: "Australia" },
  { code: "DE", name: "Germany" },
  { code: "FR", name: "France" },
];

/** Image with a loading skeleton (audit #15) — no blank boxes while it loads. */
function DetailImage({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative h-full w-full">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" aria-label="Loading image" />}
      <img src={src} alt={alt} loading="lazy" onLoad={() => setLoaded(true)} className={`${className || ""} ${loaded ? "" : "opacity-0"}`} />
    </div>
  );
}

function ProductDetailPage() {
  const { pid } = Route.useParams();
  const productFn = useServerFn(getCjProduct);
  const freightFn = useServerFn(getCjFreight);
  const navigate = useNavigate();

  const { data: p, isLoading, error } = useQuery({
    queryKey: ["cj-product", pid],
    queryFn: () => productFn({ data: { pid } }),
    staleTime: 5 * 60_000,
  });

  // The user's own pricing rules — the single source of fee/markup numbers.
  const { data: rules } = useQuery({
    queryKey: ["automation-rules-pricing"],
    queryFn: async () => {
      const { data } = await supabase.from("automation_rules").select("markup_percent,min_profit_usd,ebay_fee_buffer_percent,payment_fee_buffer_percent,round_to,max_listing_quantity").maybeSingle();
      return data || null;
    },
    staleTime: 5 * 60_000,
  });

  // CJ descriptions are third-party HTML: sanitize before rendering so a
  // compromised listing cannot run script in the user's session.
  const cleanDescription = useMemo(() => {
    if (!p?.description || typeof window === "undefined") return "";
    return DOMPurify.sanitize(p.description, { USE_PROFILES: { html: true } });
  }, [p?.description]);

  const variants = useMemo(() => {
    if (!p) return [];
    return p.variants ?? p.variantList ?? p.productVariants ?? [];
  }, [p]);

  const images = useMemo(() => {
    if (!p) return [] as string[];
    const all = new Set<string>();
    if (p.bigImage) all.add(p.bigImage);
    if (p.productImage) all.add(p.productImage);
    (Array.isArray(p.productImageSet) ? p.productImageSet : []).forEach((u) => u && all.add(u));
    (Array.isArray(p.productImages) ? p.productImages : []).forEach((u) => u && all.add(u));
    variants.forEach((v) => v.variantImage && all.add(v.variantImage));
    return cleanImageList(Array.from(all));
  }, [p, variants]);

  const [country, setCountry] = useState("US");
  const [variantId, setVariantId] = useState<string>("");
  // Markup slider: null means "use the Rules page value" (default 35%).
  const [markupOverride, setMarkupOverride] = useState<number | null>(null);
  const markupPct = markupOverride ?? Number(rules?.markup_percent ?? PRICING_DEFAULTS.markup_percent);

  const activeVid = variantId || variants[0]?.vid || "";
  const activeVariant = variants.find((v) => v.vid === activeVid);
  const itemCost = parseMoney(activeVariant?.variantSellPrice ?? p?.sellPrice ?? 0);

  const freight = useMutation({
    mutationFn: async () => {
      const vid = activeVid;
      if (!vid) throw new Error("No variant available for freight quote");
      const result = await freightFn({ data: { endCountryCode: country, products: [{ vid, quantity: 1 }] } });
      setQuotedVid(vid);
      return result;
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [selectedCarrier, setSelectedCarrier] = useState<string>("");
  const [carrierResetNote, setCarrierResetNote] = useState<string>("");
  // The variant a quote was fetched for. When the variant changes, the
  // quote is CLEARED (audit #20b) — the old shipping must not carry over
  // to a different variant, and a fresh quote is required.
  const [quotedVid, setQuotedVid] = useState<string>("");
  useEffect(() => {
    if (quotedVid && quotedVid !== activeVid) {
      freight.reset();
      setQuotedVid("");
      setSelectedCarrier("");
      setCarrierResetNote("");
    }
  }, [activeVid]); // eslint-disable-line react-hooks/exhaustive-deps
  // A quote only counts for the variant it was fetched for.
  const hasQuote = Boolean(freight.data?.length) && quotedVid === activeVid;
  const carrier = freight.data?.find((o) => o.logisticName === selectedCarrier) ?? freight.data?.[0];
  const shipping = parseMoney(carrier?.logisticPrice ?? 0);
  // Never silently switch carriers: if the user's pick vanished from a
  // fresh quote, say so instead of quietly showing the cheapest.
  useEffect(() => {
    if (!freight.data?.length) return;
    if (selectedCarrier && !freight.data.some((o) => o.logisticName === selectedCarrier)) {
      setCarrierResetNote(`"${selectedCarrier}" wasn't in the new quote — showing ${freight.data[0].logisticName} instead.`);
    } else {
      setCarrierResetNote("");
    }
  }, [freight.data, selectedCarrier]);

  // One pricing formula for the whole app (see src/lib/pricing.ts): the
  // fee rate comes from the user's Rules, never a hardcoded percent.
  const priced = priceFromRules(itemCost, shipping, rules, markupPct);
  const landed = priced.landed;
  const desiredProfit = priced.profit;
  const ebayFee = priced.ebayFee;
  const finalSell = priced.finalSell;
  // Reconciling figures (bug 9): the model profit is the TARGET, but the
  // ladder-rounded sell price leaves a different ACTUAL profit. Show the
  // actual one, and say plainly when the min-profit floor binds. The fee
  // is on the FINAL sell price (audit #19), not the pre-fee subtotal.
  const markupProfit = roundMoney(landed * (markupPct / 100));
  const minProfit = Number(rules?.min_profit_usd ?? PRICING_DEFAULTS.min_profit_usd);
  const floorBinds = desiredProfit > markupProfit + 0.004;
  const actualProfit = priced.actualProfit;
  const roundingGain = roundMoney(actualProfit - desiredProfit);
  const axes = useMemo(() => variantAxes(p?.productKeyEn, variants[0], p?.productProEnSet), [p?.productKeyEn, p?.productProEnSet, variants]);
  const selectedOptions = activeVariant ? variantOptionMap(activeVariant, axes) : {};

  const sendToDraft = useMutation({
    mutationFn: async () => {
      if (!p) throw new Error("Loading…");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      // One shared builder for single + bulk draft creation (bugs 2, 13):
      // Brand, description, variants, variant prices and profit all come
      // from the same place, so both paths store the same data.
      const row = buildCjDraftRow({
        userId: auth.user.id,
        detail: p,
        itemCost,
        shipping,
        shippingNote: freight.data?.length ? null : "No freight quote yet — price uses $0 shipping",
        carrier,
        rules: rules ?? null,
        markupPct,
        endCountry: country,
        primaryVariant: activeVariant ?? null,
      });
      const { error } = await supabase.from("listing_drafts").upsert(row, { onConflict: "user_id,cj_product_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Draft saved");
      navigate({ to: "/drafts" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title={p?.productNameEn ?? "Product"} subtitle={p?.categoryName}>
      <div className="mb-4">
        <Button asChild variant="ghost" size="sm"><Link to="/products"><ArrowLeft className="h-4 w-4 mr-1" />Back to search</Link></Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">{(error as Error).message}</Card>
      ) : !p ? null : (
        <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] gap-6 max-w-full overflow-hidden">
          {/* Image carousel */}
          <div className="min-w-0 max-w-full overflow-hidden">
            <Carousel className="w-full max-w-full overflow-hidden">
              <CarouselContent>
                {images.length === 0 ? (
                  <CarouselItem><div className="aspect-square bg-muted rounded-lg" /></CarouselItem>
                ) : images.map((src, i) => (
                  <CarouselItem key={`${src}-${i}`}>
                    <div className="aspect-square bg-muted rounded-lg overflow-hidden">
                      <DetailImage src={src} alt={`${p.productNameEn} ${i + 1}`} className="w-full h-full object-contain" />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {images.length > 1 && (<><CarouselPrevious className="left-2" /><CarouselNext className="right-2" /></>)}
            </Carousel>
            <div className="mt-3 grid grid-cols-6 gap-2 max-w-full">
              {images.slice(0, 12).map((src, i) => (
                <div key={`${src}-thumb-${i}`} className="aspect-square bg-muted rounded overflow-hidden">
                  <DetailImage src={src} alt={`${p.productNameEn} thumbnail ${i + 1}`} className="w-full h-full object-cover" />
                </div>
              ))}
            </div>
          </div>

          {/* Details + pricing */}
          <div className="space-y-5 min-w-0 max-w-full overflow-hidden">
            <div>
              <h2 className="text-xl font-semibold leading-snug break-words">{p.productNameEn}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <Badge variant="secondary">SKU: {p.productSku}</Badge>
                {p.categoryName && <Badge variant="secondary">{p.categoryName}</Badge>}
                {p.productWeight && <Badge variant="outline">{p.productWeight}g</Badge>}
                <Badge variant="outline">{`${variants.length || 1} variant${variants.length === 1 ? "" : "s"}`}</Badge>
              </div>
            </div>

            {variants.length > 0 && (
              <div>
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">Variant</Label>
                <Select value={activeVid} onValueChange={setVariantId}>
                  <SelectTrigger className="mt-1 max-w-full"><SelectValue placeholder="Select variant" /></SelectTrigger>
                  <SelectContent>
                    {variants.map((v) => (
                      <SelectItem key={v.vid} value={v.vid}>
                        {v.variantNameEn || v.variantKey || v.variantSku} · ${parseMoney(v.variantSellPrice ?? 0).toFixed(2)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(selectedOptions).map(([axis, value]) => (
                    <Badge key={axis} variant="secondary" className="max-w-full whitespace-normal break-words">{axis}: {String(value)}</Badge>
                  ))}
                </div>
              </div>
            )}

            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium"><Truck className="h-4 w-4" /> CJ Freight</div>
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
                <div>
                  <Label className="text-xs text-muted-foreground">Ship to</Label>
                  <Select value={country} onValueChange={setCountry}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COUNTRIES.map((c) => <SelectItem key={c.code} value={c.code}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={() => freight.mutate()} disabled={freight.isPending || !activeVid}>
                  {freight.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Quote"}
                </Button>
              </div>
              {freight.error && <p className="text-xs text-destructive">{(freight.error as Error).message}</p>}
              {freight.data && freight.data.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Carrier</Label>
                  <Select value={selectedCarrier || freight.data[0].logisticName} onValueChange={setSelectedCarrier}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {freight.data.map((o) => (
                        <SelectItem key={o.logisticName} value={o.logisticName}>
                          {o.logisticName} · {o.logisticAging}d · ${parseMoney(o.logisticPrice).toFixed(2)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </Card>

            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Pricing</div>
              <div>
                <Label className="text-xs text-muted-foreground">Markup over landed cost: {markupPct}% = ${markupProfit.toFixed(2)}{markupOverride === null ? " (from Rules)" : ""}</Label>
                <Input type="range" min={10} max={300} step={5} value={markupPct} onChange={(e) => setMarkupOverride(Number(e.target.value))} />
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Item cost</dt><dd className="text-right">${itemCost.toFixed(2)}</dd>
                <dt className="text-muted-foreground">+ Shipping ({carrier?.logisticName ?? "—"})</dt><dd className="text-right">${shipping.toFixed(2)}</dd>
                {carrierResetNote && <dd className="col-span-2 text-xs text-amber-600">{carrierResetNote}</dd>}
                <dt className="font-medium">Landed cost</dt><dd className="text-right font-medium">${landed.toFixed(2)}</dd>
                <dt className="text-muted-foreground">{markupPct}% markup on landed cost</dt><dd className="text-right">${markupProfit.toFixed(2)}</dd>
                {floorBinds && <dd className="col-span-2 text-xs text-amber-600">{floorBindsNote(minProfit, markupPct, markupProfit)}</dd>}
                <dt className="text-muted-foreground">Profit before fee</dt><dd className="text-right">${desiredProfit.toFixed(2)}</dd>
                <dt className="text-muted-foreground">eBay + payment fees ({Math.round(priced.feeRate * 100)}% of ${finalSell.toFixed(2)} final sell price)</dt><dd className="text-right">${ebayFee.toFixed(2)}</dd>
                <dt className="font-semibold">eBay sell price</dt><dd className="text-right font-semibold text-primary">${finalSell.toFixed(2)}{!hasQuote && <span className="block text-xs font-normal text-amber-600">estimate — shipping not quoted yet</span>}</dd>
                <dt className="font-semibold">Profit</dt><dd className={`text-right font-semibold ${actualProfit >= 0 ? "text-success" : "text-destructive"}`}>${actualProfit.toFixed(2)}</dd>
                {roundingGain > 0.005 && <dd className="col-span-2 text-xs text-muted-foreground">{roundingNote(roundingGain, finalSell, actualProfit)}</dd>}
              </dl>
              {!hasQuote && <p className="text-xs text-amber-600">Get a shipping quote first — the price needs real freight. The sell price above is an estimate with $0 shipping.</p>}
              <Button className="w-full" onClick={() => sendToDraft.mutate()} disabled={sendToDraft.isPending || !hasQuote} title={!hasQuote ? "Get a shipping quote first — the price needs real freight" : undefined}>
                <FileEdit className="h-4 w-4 mr-1" /> {sendToDraft.isPending ? "Saving…" : "Send to Drafts"}
              </Button>
            </Card>

            {p.description && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-2">Description</div>
                <div className="prose prose-sm max-w-none text-sm overflow-hidden break-words [&_*]:max-w-full [&_img]:h-auto [&_table]:w-full" dangerouslySetInnerHTML={{ __html: cleanDescription }} />
              </Card>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
