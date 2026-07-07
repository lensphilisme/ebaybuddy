import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { useState, useMemo, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCjCategories, searchCjProducts } from "@/lib/cj.functions";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, ChevronLeft, ChevronRight, FileEdit } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/products/")({
  component: ProductsPage,
});

const PAGE_SIZES = [10, 20, 40, 50, 100] as const;

function ProductsPage() {
  const initial = (() => {
    if (typeof window === "undefined") return null;
    try { return JSON.parse(sessionStorage.getItem("cj-products-search") || "null"); } catch { return null; }
  })();
  const [keyword, setKeyword] = useState<string>(initial?.keyword ?? "");
  const [query, setQuery] = useState<{ keyword: string; pageNum: number; pageSize: number; categoryId?: string; countryCode?: string }>(
    initial?.query ?? { keyword: "", pageNum: 1, pageSize: 20 },
  );
  const [categoryId, setCategoryId] = useState<string>(initial?.categoryId ?? "all");
  const [countryCode, setCountryCode] = useState<string>(initial?.countryCode ?? "all");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const navigate = useNavigate();

  const searchFn = useServerFn(searchCjProducts);
  const categoriesFn = useServerFn(getCjCategories);
  const { data: categories } = useQuery({
    queryKey: ["cj-categories"],
    queryFn: () => categoriesFn(),
    staleTime: 24 * 60 * 60_000,
  });
  const flatCategories = useMemo(() => (categories ?? []).flatMap((first: any) =>
    (first.categoryFirstList ?? []).flatMap((second: any) =>
      (second.categorySecondList ?? []).map((third: any) => ({
        id: third.categoryId,
        name: `${first.categoryFirstName} / ${second.categorySecondName} / ${third.categoryName}`,
      })),
    ),
  ), [categories]);
  const { data, isFetching, error } = useQuery({
    queryKey: ["cj-search", query],
    queryFn: () => searchFn({ data: query }),
    enabled: query.keyword.length > 0 || !!query.categoryId,
    staleTime: 60_000,
  });

  const items = data?.list ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / query.pageSize));
  const selectedIds = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  // Persist search state so navigation back to /products preserves results.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try { sessionStorage.setItem("cj-products-search", JSON.stringify({ keyword, query, categoryId, countryCode })); } catch { /* ignore */ }
  }, [keyword, query, categoryId, countryCode]);

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
    setQuery((q) => ({
      ...q,
      keyword,
      categoryId: categoryId === "all" ? undefined : categoryId,
      countryCode: countryCode === "all" ? undefined : countryCode,
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
      const { data: rule } = await supabase.from("automation_rules").select("markup_percent,ebay_fee_buffer_percent").maybeSingle();
      const markupPct = Number(rule?.markup_percent ?? 50);
      const feePct = Number(rule?.ebay_fee_buffer_percent ?? 17) / 100;
      const rows = chosen.map((p) => {
        const itemCost = Number(p.sellPrice) || 0;
        // Conservative shipping estimate of 20% of item cost when no freight quote yet
        const shipping = itemCost * 0.2;
        const landed = itemCost + shipping;
        const profit = landed * (markupPct / 100);
        const preFeePrice = landed + profit;
        const ebayFee = preFeePrice * feePct;
        const finalSell = preFeePrice + ebayFee;
        return {
          user_id: auth.user!.id,
          cj_product_id: p.pid,
          sku: p.productSku || p.pid,
          title: (p.productNameEn || "").slice(0, 80),
          price: Number(finalSell.toFixed(2)),
          images: [p.productImage].filter(Boolean),
          status: "pending" as const,
          profit: {
            item_cost: itemCost,
            shipping_estimate: Number(shipping.toFixed(2)),
            markup_pct: markupPct,
            ebay_fee_pct: feePct,
            ebay_fee: Number(ebayFee.toFixed(2)),
            profit: Number(profit.toFixed(2)),
            note: "Estimated; refine on product detail with live freight quote.",
          },
        };
      });
      const { error } = await supabase.from("listing_drafts").upsert(rows, {
        onConflict: "user_id,cj_product_id",
        ignoreDuplicates: true,
      });
      if (error) throw error;
      return chosen.length;
    },
    onSuccess: (n) => {
      toast.success(`Added ${n} product${n === 1 ? "" : "s"} to drafts with calculated final price`);
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
          <SelectTrigger className="md:w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any warehouse</SelectItem>
            <SelectItem value="CN">CN stock</SelectItem>
            <SelectItem value="US">US stock</SelectItem>
          </SelectContent>
        </Select>
        <Select value={categoryId} onValueChange={setCategoryId}>
          <SelectTrigger className="md:w-72"><SelectValue placeholder="CJ category tree" /></SelectTrigger>
          <SelectContent className="max-h-80">
            <SelectItem value="all">All CJ categories</SelectItem>
            {flatCategories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
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
          {query.keyword || query.categoryId ? "No products matched your search." : "Enter a search term or choose a CJ category to browse inventory."}
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {items.map((p) => {
              const checked = !!selected[p.pid];
              const status = (statusMap as any)[p.pid];
              const toggle = () => setSelected((s) => ({ ...s, [p.pid]: !s[p.pid] }));
              return (
                <Card key={p.pid} className={`group relative overflow-hidden border-0 bg-[var(--gradient-hero)] shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-elevated)] ${checked ? "ring-2 ring-primary" : ""}`}>
                  <div className="absolute top-2 left-2 z-10">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => setSelected((s) => ({ ...s, [p.pid]: !!v }))}
                      className="bg-background/90 border-border"
                    />
                  </div>
                  {status && (
                    <div className="absolute top-2 right-2 z-10">
                      <Badge variant={status === "listed" ? "default" : "secondary"} className="text-[10px]">
                        {status === "listed" ? "Listed on eBay" : "In draft"}
                      </Badge>
                    </div>
                  )}
                  <button type="button" onClick={toggle} aria-label={checked ? "Deselect" : "Select"} className="block w-full text-left">
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
                  </button>
                   <div className="p-3 bg-card/90 backdrop-blur">
                     <Link to="/products/$pid" params={{ pid: p.pid }} className="block min-h-[2.25rem] text-sm font-extrabold font-display leading-snug hover:underline">
                       {truncateName(p.productNameEn, 20)}
                    </Link>
                     <div className="mt-2 flex items-start justify-between gap-2">
                      {p.categoryName && (
                         <Badge variant="secondary" className="min-w-0 flex-1 justify-start truncate text-[10px]">{truncateName(p.categoryName, 18)}</Badge>
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

function truncateName(value: unknown, max = 20) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}
