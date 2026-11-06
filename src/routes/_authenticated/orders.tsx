import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listEbayOrders, listEbayDisputes, listEbayReturns } from "@/lib/ebay.functions";
import { AppShell } from "@/components/app-shell";
import { AsyncResult } from "@/components/async-result";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChevronLeft, ChevronRight, RefreshCw, Package, ExternalLink, Undo2, Loader2, ShieldCheck } from "lucide-react";
import { pageHead } from "@/lib/page-head";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/orders")({ head: () => pageHead("Orders & disputes", "View connected eBay orders, fulfillment status and payment disputes."), component: OrdersPage });

function OrdersPage() {
  const ordersFn = useServerFn(listEbayOrders);
  const disputesFn = useServerFn(listEbayDisputes);
  const returnsFn = useServerFn(listEbayReturns);
  const [view, setView] = useState("orders");
  const [status, setStatus] = useState("ALL");
  const [offset, setOffset] = useState(0);
  const orders = useQuery({ queryKey: ["ebay-orders", offset, status], queryFn: () => ordersFn({ data: { offset, status } }), enabled: view === "orders", retry: false });
  const disputes = useQuery({ queryKey: ["ebay-disputes", offset], queryFn: () => disputesFn({ data: { offset } }), enabled: view === "disputes", retry: false });
  const returns = useQuery({ queryKey: ["ebay-returns", offset], queryFn: () => returnsFn({ data: { offset } }), enabled: view === "returns", retry: false });
  const active = view === "orders" ? orders : view === "disputes" ? disputes : returns;
  const total = active.data?.total || 0;
  // The old icon-only button collapsed to a bare icon and gave no feedback
  // (a stuck isPending could leave it that way across navigations). Always
  // show the label, spin while fetching, and toast the outcome — the
  // fetching flag always resets because refetch() settles on its own.
  const refresh = async () => {
    const result = await active.refetch();
    if (result.isError) toast.error(`Refresh failed: ${(result.error as Error)?.message || "eBay request failed"}`);
    else toast.success(`${view === "orders" ? "Orders" : view === "disputes" ? "Payment disputes" : "Returns"} refreshed`);
  };
  return <AppShell title="Orders & disputes" subtitle="Sales and fulfillment from your eBay account" actions={<Button variant="outline" size="sm" onClick={refresh} disabled={active.isFetching}>{active.isFetching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}Refresh</Button>}>
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <Tabs value={view} onValueChange={(value) => { setView(value); setOffset(0); }}><TabsList><TabsTrigger value="orders">Orders</TabsTrigger><TabsTrigger value="disputes">Payment disputes</TabsTrigger><TabsTrigger value="returns">Returns</TabsTrigger></TabsList></Tabs>
      {view === "orders" && <Select value={status} onValueChange={(value) => { setStatus(value); setOffset(0); }}><SelectTrigger className="w-48" aria-label="Fulfillment status"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">All orders</SelectItem><SelectItem value="NOT_STARTED">Not started</SelectItem><SelectItem value="IN_PROGRESS">In progress</SelectItem><SelectItem value="FULFILLED">Fulfilled</SelectItem></SelectContent></Select>}
      {view === "returns" && <Button asChild variant="outline" size="sm"><a href="https://www.ebay.com/sh/ord/return" target="_blank" rel="noreferrer">Manage returns on eBay<ExternalLink className="ml-2 h-3 w-3" /></a></Button>}
    </div>
    <AsyncResult loading={active.isLoading} error={active.error} retry={() => active.refetch()} />
    {!active.isLoading && !active.error && <div className="divide-y divide-border border-y border-border">
      {view === "orders" ? (orders.data?.orders || []).map((order) => <article key={order.orderId} className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-semibold">{order.orderId}</span><Badge variant="secondary">{order.orderFulfillmentStatus.replaceAll("_", " ")}</Badge></div>{order.lineItems.map((item) => <p key={item.lineItemId} className="text-sm">{item.quantity} × {item.title}</p>)}<p className="mt-2 text-xs text-muted-foreground">{new Date(order.creationDate).toLocaleDateString()} · {order.orderPaymentStatus.replaceAll("_", " ")}</p></div>
        <span className="font-semibold tabular-nums">{order.pricingSummary?.total?.currency} {order.pricingSummary?.total?.value}</span>
      </article>) : view === "disputes" ? (disputes.data?.paymentDisputeSummaries || []).map((dispute) => <article key={dispute.paymentDisputeId} className="flex flex-wrap justify-between gap-3 py-5"><div><p className="font-semibold">{dispute.paymentDisputeId}</p><p className="mt-1 text-sm text-muted-foreground">{dispute.reason || "Payment dispute"}</p>{dispute.respondByDate && <p className="text-xs">Respond by {new Date(dispute.respondByDate).toLocaleDateString()}</p>}{dispute.orderId && <p className="text-xs text-muted-foreground">Order {dispute.orderId}</p>}</div><div className="flex flex-col items-end gap-2"><Badge variant="secondary">{dispute.paymentDisputeStatus}</Badge><Button asChild variant="outline" size="sm"><a href="https://www.ebay.com/sellerhub" target="_blank" rel="noreferrer">Respond on eBay<ExternalLink className="ml-2 h-3 w-3" /></a></Button></div></article>) : (returns.data?.returns || []).map((ret: any) => <article key={ret.returnId} className="grid gap-3 py-5 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2"><span className="font-semibold">{ret.returnId}</span><Badge variant="secondary">{String(ret.returnStatus || "").replaceAll("_", " ") || "Return"}</Badge></div>
          {(ret.returnItems || []).map((item: any, i: number) => <p key={`${item.itemId}-${i}`} className="text-sm">{item.returnQuantity ? `${item.returnQuantity} × ` : ""}Item {item.itemId}{item.returnReason ? ` — ${item.returnReason}` : ""}</p>)}
          <p className="mt-2 text-xs text-muted-foreground">{ret.creationDate ? `${new Date(ret.creationDate).toLocaleDateString()} · ` : ""}{ret.orderId ? `Order ${ret.orderId}` : ""}{ret.buyerUsername ? ` · Buyer ${ret.buyerUsername}` : ""}</p>
        </div>
        <Button asChild variant="outline" size="sm"><a href="https://www.ebay.com/sh/ord/return" target="_blank" rel="noreferrer">Handle on eBay<ExternalLink className="ml-2 h-3 w-3" /></a></Button>
      </article>)}
      {total === 0 && <div className="py-16 text-center text-muted-foreground">{view === "returns" ? <Undo2 className="mx-auto mb-3 h-8 w-8" /> : view === "disputes" ? <ShieldCheck className="mx-auto mb-3 h-8 w-8" /> : <Package className="mx-auto mb-3 h-8 w-8" />}{view === "disputes" ? "No payment disputes — you're all clear." : `No ${view} found.`}</div>}
    </div>}
    <div className="mt-5 flex items-center justify-between"><span className="text-sm text-muted-foreground">{total ? `${offset + 1}–${Math.min(offset + 50, total)} of ${total}` : "0 results"}</span><div className="flex gap-2"><Button variant="outline" size="icon" aria-label="Previous page" disabled={offset === 0 || active.isFetching} onClick={() => setOffset(Math.max(0, offset - 50))}><ChevronLeft className="h-4 w-4" /></Button><Button variant="outline" size="icon" aria-label="Next page" disabled={offset + 50 >= total || active.isFetching} onClick={() => setOffset(offset + 50)}><ChevronRight className="h-4 w-4" /></Button></div></div>
  </AppShell>;
}
