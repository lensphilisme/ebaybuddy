import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjCategories, getCjWarehouses, getCjProduct, getCjFreight, searchCjProducts } from "@/lib/cj.functions";
import { priceFromRules, PRICING_DEFAULTS } from "@/lib/pricing";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, ChevronLeft, ChevronRight, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products/")({ head: () => pageHead("CJ product research", "Search CJ products, categories and warehouse inventory."),
  component: ProductsPage,
});

const PAGE_SIZES = [10, 20, 40, 50, 100] as const;

type SearchQuery = { keyword: string; pageNum: number; pageSize: number; categoryId?: string; countryCode?: string; minPrice?: number; maxPrice?: number };

function ProductsPage() {
  const initial = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(sessionStorage.getItem("cj-products-search") || "null"); } catch { return null; }
  })();
  const [keyword, setKeyword] = useState<string>(initial?.keyword ?? "");
  const [query, setQuery] = useState<SearchQuery>(
    initial?.query ?? { keyword: "", pageNum: 1, pageSize: 20 },
  );
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? "all");
  const [countryCode, setCountryCode] = useState<string>(initial?.countryCode ?? "all");
  const [minPrice, setMinPrice] = useState<string>(initial?.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState<string>(initial?.maxPrice ?? "");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const searchFn = useServerFn(searchCjProducts);
  const categoriesFn = useServerFn(getCjCategories);
  const warehousesFn = useServerFn(getCjWarehouses);
  const productFn = useServerFn(getCjProduct);
  const freightFn = useServerFn(getCjFreight);
  const { data: categories } = useQuery({
    queryKey: ["cj-categories"],
    queryFn: () => categoriesFn(),
    staleTime: 24 * 60 * 60_000,
  });
  const { data: warehouses } = useQuery({
    queryKey: ["cj-warehouses"],
    queryFn: () => warehousesFn(),
    staleTime: 24 * 60 * 60_000,
  });
  // Category tree grouped by 1st/2nd level so the user can navigate it;
  // only 3rd-level categories carry an ID the search API accepts.
  const categoryGroups = useMemo(() => (categories ?? []).map((first: any) => ({
    name: first.categoryFirstName,
    seconds: (first.categoryFirstList ?? []).map((second: any) => ({
      name: second.categorySecondName,
      thirds: (second.categorySecondList ?? []).map((third: any) => ({ id: third.categoryId, name: third.categoryName })),
    })).filter((s: any) => s.thirds.length > 0),
  })).filter((g: any) => g.seconds.length > 0), [categories]);
  const flatCategories = useMemo(() => categoryGroups.flatMap((g: any) =>
    g.seconds.flatMap((s: any) => s.thirds.map((t: any) => ({ id: t.id, name: `${g.name} / ${s.name} / ${t.name}` }))),
  ), [categoryGroups]);
  const warehouseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of warehouses ?? []) {
      const code = String(w.countryCode || "").toUpperCase();
      if (!code || w.disabled) continue;
      if (!seen.has(code)) seen.set(code, w.areaEn || w.nameEn || code);
    }
    return Array.from(seen.entries()).map(([code, label]) => ({ code, label }));
  }, [warehouses]);
  const hasCriteria = query.keyword.length > 0 || !!query.categoryId || !!query.countryCode || query.minPrice != null || query.maxPrice != null;
  const { data, isFetching, error } = useQuery({
    queryKey: ["cj-search", query],
    queryFn: () => searchFn({ data: query }),
    enabled: hasCriteria,
    staleTime: 60_000,
  });

  const items = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  // Persist search state so navigation back to /products preserves results.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("cj-products-search", JSON.stringify({ keyword, query, categoryId, countryCode, minPrice, maxPrice })); } catch { /* ignore */ }
  }, [keyword, query, categoryId, countryCode, minPrice, maxPrice]);

  // Which visible products are already listed or in draft?
  const pids = items.map((p) => p.pid);
  const { data: statusMap = {} } = useQuery({
    queryKey: ["cj-listed-map", pids.join(",")],
    enabled: pids.length > 0,
    queryFn: async () => {
      const map: Record<string, "listed" | "draft"> = {};
      const [listings, drafts] = await Promise.all([
        supabase.from("ebay_listings").select("cj_product_id,status").in("cj_product_id", pids),
        supabase.from("listing_drafts").select("cj_product_id").in("cj_product_id", pids),
      ]);
      for (const r of listings.data || []) if (r.cj_product_id) map[r.cj_product_id] = "listed";
      for (const r of drafts.data || []) if (r.cj_product_id && !map[r.cj_product_id]) map[r.cj_product_id] = "draft";
      return map;
    },
  });

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const min = minPrice.trim() === "" ? undefined : Number(minPrice);
    const max = maxPrice.trim() === "" ? undefined : Number(maxPrice);
    setQuery((q) => ({
      ...q,
      keyword,
      categoryId: categoryId === "all" ? undefined : categoryId,
      countryCode: countryCode === "all" ? undefined : countryCode,
      minPrice: Number.isFinite(min) ? min : undefined,
      maxPrice: Number.isFinite(max) ? max : undefined,
      pageNum: 1,
    }));
    setSelected({});
  }

  const bulkDraft = useMutation({
    mutationFn: async () => {
      const chosen = items.filter((p) => selected[p.pid]);
      if (chosen.length === 0) throw new Error("Nothing selected");
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Not signed in");
      const { data: rule } = await supabase.from("automation_rules").select("markup_percent,min_profit_usd,ebay_fee_buffer_percent,payment_fee_buffer_percent,round_to,max_listing_quantity").maybeSingle();
      const rules = rule ?? PRICING_DEFAULTS;
      const rows = [];
      for (const p of chosen) {
        const itemCost = Number(p.sellPrice) || 0;
        // Real shipping from a live CJ freight quote for the first variant
        // (US destination). Falls back to a flagged 20% estimate only when
        // the quote fails, so the price is never silently guessed.
        let shipping = itemCost * 0.2;
        let shippingNote = "Estimated; refine on product detail with live freight quote.";
        let variantGroup: { variants: any[] } | null = null;
        try {
          const detail: any = await productFn({ data: { pid: p.pid } });
          const variants = detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
          if (Array.isArray(variants) && variants.length > 1) {
            variantGroup = {
              variants: variants.map((v: any, i: number) => ({
                vid: v.vid,
                variantSku: v.variantSku || v.vid,
                variantKey: v.variantKey || v.variantNameEn || v.variantSku || v.vid,
                variantNameEn: v.variantNameEn,
                variantSellPrice: Number(v.variantSellPrice ?? p.sellPrice ?? 0),
                inventory: Number(v.inventory || 1),
              })),
            };
          }
          const firstVid = variants[0]?.vid;
          if (firstVid) {
            const quote = await freightFn({ data: { endCountryCode: "US", products: [{ vid: firstVid, quantity: 1 }] } });
            const cheapest = (quote || []).map((o: any) => Number(o.logisticPrice || 0)).filter((n: number) => n > 0).sort((a: number, b: number) => a - b)[0];
            if (cheapest) { shipping = cheapest; shippingNote = "Live CJ freight quote (cheapest carrier, US)."; }
          }
        } catch { /* keep the flagged estimate */ }
        const priced = priceFromRules(itemCost, shipping, rules);
        rows.push({
          user_id: auth.user!.id,
          cj_product_id: p.pid,
          sku: p.productSku || p.pid,
          title: (p.productNameEn || "").slice(0, 80),
          price: priced.finalSell,
          quantity: priced.quantity,
          images: [p.productImage].filter(Boolean),
          status: "pending" as const,
          profit: {
            item_cost: itemCost,
            shipping: Number(shipping.toFixed(2)),
            shipping_estimate: Number(shipping.toFixed(2)),
            markup_pct: Number(rules.markup_percent ?? PRICING_DEFAULTS.markup_percent),
            min_profit_usd: Number(rules.min_profit_usd ?? PRICING_DEFAULTS.min_profit_usd),
            ebay_fee_pct: priced.feeRate,
            ebay_fee: priced.ebayFee,
            profit: priced.profit,
            variant_group: variantGroup,
            note: shippingNote,
          },
        });
      }
      const { data: inserted, error } = await supabase.from("listing_drafts").upsert(rows, {
        onConflict: "user_id,cj_product_id",
        ignoreDuplicates: true,
      }).select("id");
      if (error) throw error;
      return { added: inserted?.length ?? 0, skipped: rows.length - (inserted?.length ?? 0) };
    },
    onSuccess: ({ added, skipped }) => {
      toast.success(added > 0 ? `Added ${added} product${added === 1 ? "" : "s"} to drafts${skipped > 0 ? ` (${skipped} already in drafts)` : ""}` : "All selected products were already in drafts");
      setSelected({});
      navigate({ to: "/drafts" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="CJ Products" subtitle="Search inventory and send winners to your draft queue">
      <form onSubmit={submit} className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search CJ Dropshipping (e.g. wireless earbuds, kitchen gadget…)"
            className="pl-9"
          />
        </div>
        <Select value={countryCode} onValueChange={setCountryCode}>
          <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any warehouse</SelectItem>
            {warehouseOptions.map((w) => <SelectItem key={w.code} value={w.code}>{w.code} stock · {w.label}</SelectItem>)}
            {warehouseOptions.length === 0 && (<>
              <SelectItem value="CN">CN stock</SelectItem>
              <SelectItem value="US">US stock</SelectItem>
            </>)}
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="md:w-72"><SelectValue placeholder="CJ category tree" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">All CJ categories</SelectItem>
            {categoryGroups.map((g: any) => (
              <SelectGroup key={g.name}>
                <SelectLabel>{g.name}</SelectLabel>
                {g.seconds.map((s: any) => s.thirds.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{s.name} / {t.name}</SelectItem>
                )))}
              </SelectGroup>
            ))}
            {categoryGroups.length === 0 && flatCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input
          type="number" min={0} step="0.01" value={minPrice} onChange={(e) => setMinPrice(e.target.value)}
          placeholder="Min $" className="md:w-24" aria-label="Minimum price"
        />
        <Input
          type="number" min={0} step="0.01" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)}
          placeholder="Max $" className="md:w-24" aria-label="Maximum price"
        />
        <Select
          value={String(query.pageSize)}
          onValueChange={(v) => setQuery((q) => ({ ...q, pageSize: Number(v), pageNum: 1 }))}
        >
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{n} / page</SelectItem>)}
          </SelectContent>
        </Select>
        <Button type="submit" disabled={isFetching}>
          {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </form>

      {error ? (
        <Card className="p-6 border-destructive/40 bg-destructive/5 text-sm text-destructive">
          {(error as Error).message}
        </Card>
      ) : null}

      {selectedIds.length > 0 && (
        <div className="sticky top-16 z-20 mb-4 flex items-center gap-3 bg-card border rounded-lg px-4 py-2 shadow-sm">
          <span className="text-sm font-medium">{selectedIds.length} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected({})}>Clear</Button>
          <div className="flex-1" />
          <Button size="sm" onClick={() => bulkDraft.mutate()} disabled={bulkDraft.isPending}>
            <FileEdit className="h-4 w-4 mr-1" />
            {bulkDraft.isPending ? "Adding…" : "Send to Drafts"}
          </Button>
        </div>
      )}

      {isFetching && items.length === 0 ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {Array.from({ length: query.pageSize > 12 ? 12 : query.pageSize }).map((_, i) => (
            <Card key={i} className="aspect-[3/4] animate-pulse bg-muted/40" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <Card className="p-12 text-center text-sm text-muted-foreground">
          {hasCriteria ? "No products matched your search." : "Enter a search term, choose a CJ category, a warehouse, or a price range to browse inventory."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {items.map((p) => {
              const checked = !!selected[p.pid];
              const status = (statusMap as any)[p.pid];
              return (
                <Card key={p.pid} className={`group relative overflow-hidden border-0 bg-[var(--gradient-hero)] shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] ${checked ? "ring-2 ring-primary" : ""}`}>
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.pid]: !!v }))}
                      className="bg-background/90 border-border"
                      aria-label={`Select ${p.productNameEn}`}
                    />
                  </div>
                  {status && (
                    <div className="absolute top-2 right-2 z-10">
                      <Badge variant={status === "listed" ? "default" : "secondary"} className="text-[10px]">
                        {status === "listed" ? "Listed on eBay" : "In draft"}
                      </Badge>
                    </div>
                  )}
                  <Link to="/products/$pid" params={{ pid: p.pid }} className="block w-full text-left" aria-label={`Open ${p.productNameEn}`}>
                    <div className="aspect-square bg-muted overflow-hidden">
                      {p.productImage && (
                        <img
                          src={p.productImage}
                          alt={p.productNameEn}
                          loading="lazy"
                          className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                        />
                      )}
                    </div>
                  </Link>
                   <div className="p-3 bg-card/90 backdrop-blur">
                     <Link to="/products/$pid" params={{ pid: p.pid }} title={p.productNameEn} className="block min-h-[2.5rem] text-sm font-extrabold font-display leading-snug hover:underline line-clamp-2">
                       {p.productNameEn}
                    </Link>
                     <div className="mt-2 flex items-start justify-between gap-2">
                      {p.categoryName && (
                         <Badge variant="secondary" className="min-w-0 flex-1 justify-start truncate text-[10px]" title={p.categoryName}>{p.categoryName}</Badge>
                      )}
                       <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-extrabold text-primary-foreground shadow-sm">${Number(p.sellPrice).toFixed(2)}</span>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-muted-foreground">
              Page {query.pageNum} of {totalPages} · {total.toLocaleString()} results
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm"
                disabled={query.pageNum <= 1 || isFetching}
                onClick={() => setQuery((q) => ({ ...q, pageNum: q.pageNum - 1 }))}
              >
                <ChevronLeft className="h-4 w-4" /> Prev
              </Button>
              <Button
                variant="outline" size="sm"
                disabled={query.pageNum >= totalPages || isFetching}
                onClick={() => setQuery((q) => ({ ...q, pageNum: q.pageNum + 1 }))}
              >
                Next <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </AppShell>
  );
}
