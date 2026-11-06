import { pageHead } from "@/lib/page-head";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjCategories, getCjWarehouses, getCjProduct, getCjFreight, searchCjProducts } from "@/lib/cj.functions";
import { parseMoney, PRICING_DEFAULTS } from "@/lib/pricing";
import { buildCjDraftRow } from "@/lib/draft-from-cj";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, ChevronLeft, ChevronRight, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products/")({ head: () => pageHead("CJ Products", "Search CJ products, categories and warehouse inventory."),
  component: ProductsPage,
});

const PAGE_SIZES = [10, 20, 40, 50, 100] as const;

type SearchQuery = { keyword: string; pageNum: number; pageSize: number; categoryId?: string; countryCode?: string; minPrice?: number; maxPrice?: number };

/** Product image with a loading skeleton (audit #15): no more blank grey
 * boxes with no spinner while the image loads. */
function ProductImage({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="relative h-full w-full">
      {!loaded && <div className="absolute inset-0 animate-pulse bg-muted" aria-label="Loading image" />}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onLoad={() => setLoaded(true)}
        className={`h-full w-full object-cover transition-transform group-hover:scale-105 ${loaded ? "" : "opacity-0"}`}
      />
    </div>
  );
}

function ProductsPage() {
  const initial = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(sessionStorage.getItem("cj-products-search") || "null"); } catch { return null; }
  })();
  // Default browse view (audit #11): on first load with no saved search,
  // run a "home" search instead of an empty prompt.
  const [keyword, setKeyword] = useState<string>(initial?.keyword ?? "home");
  const [query, setQuery] = useState<SearchQuery>(
    initial?.query ?? { keyword: "home", pageNum: 1, pageSize: 20 },
  );
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? "all");
  const [countryCode, setCountryCode] = useState<string>(initial?.countryCode ?? "all");
  const [minPrice, setMinPrice] = useState<string>(initial?.minPrice ?? "");
  const [maxPrice, setMaxPrice] = useState<string>(initial?.maxPrice ?? "");
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [filtersApplying, setFiltersApplying] = useState(false);
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
/** Warehouse labels come from CJ in raw form ("North China storage
 * library") — normalize them to plain English warehouse names. */
function normalizeWarehouseLabel(label: string, code: string): string {
  let l = String(label || "")
    .replace(/storage library/gi, "warehouse")
    .replace(/\bstock\b/gi, "warehouse")
    .replace(/\s+/g, " ")
    .trim();
  l = l.replace(/warehouse warehouse/gi, "warehouse");
  if (!l) return `${code} warehouse`;
  return l.toLowerCase().startsWith(code.toLowerCase()) ? l : `${code} ${l}`;
}

const warehouseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const w of warehouses ?? []) {
      const code = String(w.countryCode || "").toUpperCase();
      if (!code || w.disabled) continue;
      if (!seen.has(code)) seen.set(code, normalizeWarehouseLabel(w.areaEn || w.nameEn || code, code));
    }
    return Array.from(seen.entries()).map(([code, label]) => ({ code, label }));
  }, [warehouses]);
  const filteredWarehouses = useMemo(() => {
    const q = warehouseFilter.trim().toLowerCase();
    if (!q) return warehouseOptions;
    return warehouseOptions.filter((w) => `${w.code} ${w.label}`.toLowerCase().includes(q));
  }, [warehouseOptions, warehouseFilter]);
  const hasCriteria = query.keyword.length > 0 || !!query.categoryId || !!query.countryCode || query.minPrice != null || query.maxPrice != null;
  const { data, isFetching, error } = useQuery({
    queryKey: ["cj-search", query],
    queryFn: () => searchFn({ data: query }),
    enabled: hasCriteria,
    staleTime: 60_000,
  });

  const items = data?.list ?? [];
  const total = data?.total ?? 0;
  // Hide results whose image/title clearly mismatches (audit #18): a card
  // with no image AND no price is skipped. When a price filter is set,
  // items with no price are excluded — they cannot be verified against it.
  const visibleItems = useMemo(() => {
    const priceFilterSet = query.minPrice != null || query.maxPrice != null;
    return items.filter((p) => {
      const price = parseMoney(p.sellPrice);
      if (!p.productImage && !(price > 0)) return false;
      if (priceFilterSet && !(price > 0)) return false;
      return true;
    });
  }, [items, query.minPrice, query.maxPrice]);
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  // Persist search state so navigation back to /products preserves results.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("cj-products-search", JSON.stringify({ keyword, query, categoryId, countryCode, minPrice, maxPrice })); } catch { /* ignore */ }
  }, [keyword, query, categoryId, countryCode, minPrice, maxPrice]);

  // Filters auto-apply (audit #16): changing warehouse/price/category
  // re-runs the search automatically (debounced 500ms) — no silent
  // "change the dropdown but results don't change until Search".
  const filtersDirty = keyword !== query.keyword || categoryId !== (query.categoryId ?? "all") || countryCode !== (query.countryCode ?? "all") || minPrice !== (query.minPrice != null ? String(query.minPrice) : "") || maxPrice !== (query.maxPrice != null ? String(query.maxPrice) : "");
  useEffect(() => {
    if (!filtersDirty) return;
    setFiltersApplying(true);
    const t = setTimeout(() => {
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
      setFiltersApplying(false);
    }, 500);
    return () => clearTimeout(t);
  }, [keyword, categoryId, countryCode, minPrice, maxPrice]); // eslint-disable-line react-hooks/exhaustive-deps

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
      const failed: string[] = [];
      for (const p of chosen) {
        try {
          // Full CJ detail, exactly like the single-send path (bug 13) —
          // the list row alone has no description, variants or brand, so
          // bulk drafts built from it arrived empty.
          const detail: any = await productFn({ data: { pid: p.pid } });
          const variants = detail?.variants ?? detail?.variantList ?? detail?.productVariants ?? [];
          const firstVariant = variants[0] ?? null;
          const itemCost = parseMoney(firstVariant?.variantSellPrice ?? detail?.sellPrice ?? p.sellPrice ?? 0);
          // Real shipping from a live CJ freight quote for the first variant
          // (US destination). Falls back to a flagged 20% estimate only when
          // the quote fails, so the price is never silently guessed.
          let shipping = itemCost * 0.2;
          let shippingNote = "Estimated; refine on product detail with live freight quote.";
          let carrier: { logisticName?: string; logisticAging?: string } | null = null;
          try {
            const firstVid = firstVariant?.vid;
            if (firstVid) {
              const quote = await freightFn({ data: { endCountryCode: "US", products: [{ vid: firstVid, quantity: 1 }] } });
              const options = (quote || []).map((o: any) => ({ ...o, price: parseMoney(o.logisticPrice) })).filter((o: any) => o.price > 0).sort((a: any, b: any) => a.price - b.price);
              if (options[0]) { shipping = options[0].price; carrier = options[0]; shippingNote = "Live CJ freight quote (cheapest carrier, US)."; }
            }
          } catch { /* keep the flagged estimate */ }
          // One shared builder for single + bulk (bugs 2, 13): Brand,
          // description, variants, variant prices and profit all come from
          // the same place, so both paths store the same data.
          rows.push(buildCjDraftRow({
            userId: auth.user.id,
            detail,
            itemCost,
            shipping,
            shippingNote,
            carrier,
            rules,
            endCountry: "US",
            primaryVariant: firstVariant,
          }));
        } catch (e) {
          failed.push(p.productNameEn || p.pid);
        }
      }
      if (rows.length === 0) throw new Error(`Could not load CJ details for: ${failed.join(", ")}`);
      // No ignoreDuplicates: re-sending a product refreshes its draft with
      // the full detail instead of silently keeping the old incomplete row.
      const { error } = await supabase.from("listing_drafts").upsert(rows, {
        onConflict: "user_id,cj_product_id",
      }).select("id");
      if (error) throw error;
      return { added: rows.length, failed };
    },
    onSuccess: ({ added, failed }) => {
      if (failed.length > 0) toast.warning(`Saved ${added} product${added === 1 ? "" : "s"} to drafts. Failed to load: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? ` (+${failed.length - 3} more)` : ""}`);
      else toast.success(`Saved ${added} product${added === 1 ? "" : "s"} to drafts`);
      setSelected({});
      navigate({ to: "/drafts" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <AppShell title="CJ Products" subtitle="Search inventory and send winners to your draft queue">
      <form onSubmit={submit} className="flex flex-col md:flex-row gap-2 mb-4">
        <div className="relative flex-1 min-w-0">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Search CJ products…"
            className="pl-9 w-full"
          />
        </div>
        <Select value={countryCode} onValueChange={setCountryCode}>
          <SelectTrigger className="md:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <div className="p-2">
              <Input
                value={warehouseFilter}
                onChange={(e) => setWarehouseFilter(e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                placeholder="Search warehouses…"
                className="h-8"
                aria-label="Search warehouses"
              />
            </div>
            <SelectItem value="all">Any warehouse</SelectItem>
            {filteredWarehouses.map((w) => <SelectItem key={w.code} value={w.code}>{w.label}</SelectItem>)}
            {warehouseOptions.length === 0 && (<>
              <SelectItem value="CN">CN warehouse</SelectItem>
              <SelectItem value="US">US warehouse</SelectItem>
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
            {PAGE_SIZES.map((n) => <SelectItem key={n} value={String(n)}>{`${n} / page`}</SelectItem>)}
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
          <span className="text-sm font-medium">{`${selectedIds.length} selected`}</span>
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
      ) : visibleItems.length === 0 ? (
        <EmptyState
          icon={Search}
          title={hasCriteria ? "No products matched your search." : "Browse CJ inventory"}
          help={hasCriteria ? "Try a different keyword, category, warehouse or price range." : "Enter a search term, choose a CJ category, a warehouse, or a price range to browse inventory."}
        />
      ) : (
        <>
          {query.keyword === "home" && !query.categoryId && !query.countryCode && query.minPrice == null && query.maxPrice == null && (
            <h2 className="mb-3 text-sm font-semibold text-muted-foreground">Popular right now</h2>
          )}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {visibleItems.map((p) => {
              const checked = !!selected[p.pid];
              const status = (statusMap as any)[p.pid];
              const price = parseMoney(p.sellPrice);
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
                      {p.productImage ? (
                        <ProductImage src={p.productImage} alt={p.productNameEn} />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No image</div>
                      )}
                    </div>
                  </Link>
                   <div className="p-3 bg-card/90 backdrop-blur">
                     <Link to="/products/$pid" params={{ pid: p.pid }} title={p.productNameEn} className="block min-h-[2.5rem] text-sm font-extrabold font-display leading-snug hover:underline line-clamp-2">
                       {p.productNameEn}
                    </Link>
                     <div className="mt-1 text-[11px] text-muted-foreground truncate" title={`${p.productSku || ""}${p.supplierName ? ` · ${p.supplierName}` : ""}`}>
                       {p.productSku ? `SKU ${p.productSku}` : ""}{p.productSku && p.supplierName ? " · " : ""}{p.supplierName || ""}
                     </div>
                     <div className="mt-2 flex items-start justify-between gap-2">
                      {p.categoryName && (
                         <Badge variant="secondary" className="min-w-0 flex-1 justify-start truncate text-[10px]" title={p.categoryName}>{p.categoryName}</Badge>
                      )}
                       {price > 0 ? (
                         <span className="shrink-0 rounded-md bg-primary px-2 py-1 text-xs font-extrabold text-primary-foreground shadow-sm">${price.toFixed(2)}</span>
                       ) : (
                         <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">Price on detail</span>
                       )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>

          {/* Pagination */}
          <div className="mt-6 flex items-center justify-between flex-wrap gap-3">
            <div className="text-xs text-muted-foreground">
              {`Page ${query.pageNum} of ${totalPages} · ${total >= 6000 ? "6,000+ results (CJ caps at 6,000)" : `${total.toLocaleString()} results`}`}
              {filtersApplying ? " · Applying filters…" : filtersDirty ? "" : hasCriteria ? " · Filters applied" : ""}
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
