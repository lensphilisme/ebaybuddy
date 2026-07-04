import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjProduct, getCjFreight } from "@/lib/cj.functions";
import { useMemo, useState } from "react";
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

export const Route = createFileRoute("/_authenticated/products/$pid")({
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

const EBAY_FEE_PCT = 0.17;

function cleanImageList(...inputs: unknown[]) {
  const urls: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try { visit(JSON.parse(trimmed)); return; } catch { /* use as raw below */ }
    }
    try {
      const u = new URL(trimmed.replace(/^['"]|['"]$/g, ""));
      if (u.protocol === "https:" || u.protocol === "http:") urls.push(u.toString());
    } catch { /* ignore */ }
  };
  inputs.forEach(visit);
  return Array.from(new Set(urls));
}

function variantAxes(productKey?: string, firstVariant?: any) {
  const keyAxes = String(productKey || "").split(/[-,/|>]+/).map((p) => p.trim()).filter(Boolean);
  if (keyAxes.length) return keyAxes;
  const parts = String(firstVariant?.variantKey || firstVariant?.variantNameEn || "").split(/[-,/|]+/).filter(Boolean);
  return parts.length > 1 ? parts.map((_, i) => `Option ${i + 1}`) : ["Option"];
}

function variantOptionMap(variant: any, axes: string[]) {
  const label = String(variant?.variantKey || variant?.variantNameEn || variant?.variantSku || variant?.vid || "Option").trim();
  const parts = label.split(/[-,/|]+/).map((p) => p.trim()).filter(Boolean);
  const values = parts.length === axes.length ? parts : axes.length === 1 ? [label] : axes.map((_, i) => parts[i] || label);
  return Object.fromEntries(axes.map((axis, i) => [axis, values[i] || label]));
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
  const [markupPct, setMarkupPct] = useState(50);

  const activeVid = variantId || variants[0]?.vid || "";
  const activeVariant = variants.find((v) => v.vid === activeVid);
  const itemCost = Number(activeVariant?.variantSellPrice ?? p?.sellPrice ?? 0);

  const freight = useMutation({
    mutationFn: async () => {
      const vid = activeVid;
      if (!vid) throw new Error("No variant available for freight quote");
      return freightFn({ data: { endCountryCode: country, products: [{ vid, quantity: 1 }] } });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const [selectedCarrier, setSelectedCarrier] = useState<string>("");
  const carrier = freight.data?.find((o) => o.logisticName === selectedCarrier) ?? freight.data?.[0];
  const shipping = carrier?.logisticPrice ?? 0;

  const landed = itemCost + shipping;
  const desiredProfit = landed * (markupPct / 100);
  const preFeePrice = landed + desiredProfit;
  const ebayFee = preFeePrice * EBAY_FEE_PCT;
  const finalSell = preFeePrice + ebayFee;
  const profit = desiredProfit;
  const axes = useMemo(() => variantAxes(p?.productKeyEn, variants[0]), [p?.productKeyEn, variants]);
  const selectedOptions = activeVariant ? variantOptionMap(activeVariant, axes) : {};
  const priceForVariant = (rawCost: unknown) => {
    const variantCost = Number(rawCost ?? itemCost) || itemCost;
    const variantLanded = variantCost + shipping;
    const variantProfit = variantLanded * (markupPct / 100);
    const variantPreFee = variantLanded + variantProfit;
    return Number((variantPreFee + variantPreFee * EBAY_FEE_PCT).toFixed(2));
  };

  const sendToDraft = useMutation({
    mutationFn: async () => {
      if (!p) throw new Error("Loading…");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const allVariantRows = variants.map((v) => ({
        vid: v.vid,
        variantSku: v.variantSku || v.vid,
        variantKey: v.variantKey || v.variantNameEn || v.variantSku || v.vid,
        variantNameEn: v.variantNameEn,
        variantImage: cleanImageList(v.variantImage)[0] || images[0] || null,
        variantSellPrice: Number(v.variantSellPrice ?? p.sellPrice ?? 0),
        price: priceForVariant(v.variantSellPrice),
        inventory: Number(v.inventory || 1),
      }));
      const { error } = await supabase.from("listing_drafts").upsert({
        user_id: auth.user.id,
        cj_product_id: p.pid,
        cj_variant_id: activeVid || null,
        sku: activeVariant?.variantSku || p.productSku || p.pid,
        title: (p.productNameEn || "").slice(0, 80),
        price: Number(finalSell.toFixed(2)),
        images: cleanImageList(activeVariant?.variantImage, images).slice(0, 12),
        description: p.description ?? "",
        item_specifics: { Brand: "Unbranded", Condition: "New", ...selectedOptions },
        status: "pending" as const,
        profit: {
          item_cost: itemCost,
          shipping,
          carrier: carrier?.logisticName ?? null,
          carrier_days: carrier?.logisticAging ?? null,
          ebay_fee_pct: EBAY_FEE_PCT,
          ebay_fee: Number(ebayFee.toFixed(2)),
          desired_profit: Number(desiredProfit.toFixed(2)),
          markup_pct: markupPct,
          profit: Number(profit.toFixed(2)),
          end_country: country,
          start_country: "CN",
          product_key: p.productKeyEn || null,
          variant_axes: axes,
          variant_group: allVariantRows.length > 1 ? { variants: allVariantRows } : null,
        },
      }, { onConflict: "user_id,cj_product_id" });
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
                      <img src={src} alt={`${p.productNameEn} ${i + 1}`} className="w-full h-full object-contain" />
                    </div>
                  </CarouselItem>
                ))}
              </CarouselContent>
              {images.length > 1 && (<><CarouselPrevious className="left-2" /><CarouselNext className="right-2" /></>)}
            </Carousel>
            <div className="mt-3 grid grid-cols-6 gap-2 max-w-full">
              {images.slice(0, 12).map((src, i) => (
                <div key={`${src}-thumb-${i}`} className="aspect-square bg-muted rounded overflow-hidden">
                  <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
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
                <Badge variant="outline">{variants.length || 1} variant{variants.length === 1 ? "" : "s"}</Badge>
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
                        {v.variantNameEn || v.variantKey || v.variantSku} · ${Number(v.variantSellPrice ?? 0).toFixed(2)}
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
                <div className="space-y-1 max-h-48 overflow-auto">
                  {freight.data.map((o) => (
                    <button
                      key={o.logisticName}
                      type="button"
                      onClick={() => setSelectedCarrier(o.logisticName)}
                      className={`w-full text-left flex items-center justify-between gap-2 p-2 rounded-md text-sm border ${selectedCarrier === o.logisticName || (!selectedCarrier && o === freight.data![0]) ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"}`}
                    >
                      <div className="min-w-0">
                        <div className="font-medium truncate">{o.logisticName}</div>
                        <div className="text-xs text-muted-foreground">{o.logisticAging} days</div>
                      </div>
                      <div className="font-semibold text-primary">${Number(o.logisticPrice).toFixed(2)}</div>
                    </button>
                  ))}
                </div>
              )}
            </Card>

            <Card className="p-4 space-y-3">
              <div className="text-sm font-medium">Pricing</div>
              <div>
                <Label className="text-xs text-muted-foreground">Markup over landed cost: {markupPct}%</Label>
                <Input type="range" min={10} max={300} step={5} value={markupPct} onChange={(e) => setMarkupPct(Number(e.target.value))} />
              </div>
              <dl className="grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Item cost</dt><dd className="text-right">${itemCost.toFixed(2)}</dd>
                <dt className="text-muted-foreground">+ Shipping ({carrier?.logisticName ?? "—"})</dt><dd className="text-right">${shipping.toFixed(2)}</dd>
                <dt className="font-medium">Landed cost</dt><dd className="text-right font-medium">${landed.toFixed(2)}</dd>
                  <dt className="text-muted-foreground">Profit before fee</dt><dd className="text-right">${desiredProfit.toFixed(2)}</dd>
                  <dt className="text-muted-foreground">eBay fee ({Math.round(EBAY_FEE_PCT * 100)}% of ${preFeePrice.toFixed(2)})</dt><dd className="text-right">${ebayFee.toFixed(2)}</dd>
                <dt className="font-semibold">eBay sell price</dt><dd className="text-right font-semibold text-primary">${finalSell.toFixed(2)}</dd>
                <dt className="font-semibold">Profit</dt><dd className={`text-right font-semibold ${profit >= 0 ? "text-success" : "text-destructive"}`}>${profit.toFixed(2)}</dd>
              </dl>
              <Button className="w-full" onClick={() => sendToDraft.mutate()} disabled={sendToDraft.isPending}>
                <FileEdit className="h-4 w-4 mr-1" /> {sendToDraft.isPending ? "Saving…" : "Send to Drafts"}
              </Button>
            </Card>

            {p.description && (
              <Card className="p-4">
                <div className="text-sm font-medium mb-2">Description</div>
                <div className="prose prose-sm max-w-none text-sm overflow-hidden break-words [&_*]:max-w-full [&_img]:h-auto [&_table]:w-full" dangerouslySetInnerHTML={{ __html: p.description }} />
              </Card>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
