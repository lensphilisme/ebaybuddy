import { EbayRestClient } from "./rest.server";
import type { Dispute, Order, Page, ReturnRecord, ShippingFulfillmentInput } from "./contracts";
import { shippingFulfillmentPayload } from "./contracts";

export class EbayOrderService {
  constructor(private client: EbayRestClient) {}
  orders(offset = 0, status = "ALL") {
    const query = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (status !== "ALL") query.set("filter", `orderfulfillmentstatus:{${status}}`);
    return this.client.json<Page<{ orders: Order[] }>>(`/sell/fulfillment/v1/order?${query}`);
  }
  disputes(offset = 0) {
    return this.client.json<Page<{ paymentDisputeSummaries: Dispute[] }>>(`/sell/fulfillment/v1/payment_dispute_summary?limit=50&offset=${offset}`);
  }
  order(id: string) { return this.client.json<Order>(`/sell/fulfillment/v1/order/${encodeURIComponent(id)}`); }
  /**
   * Manual-only. Do NOT call this from any automatic CJ/order flow:
   * tracking writes deliberately belong to CJ, not this application.
   * Kept here so a future explicit user action can use the modern
   * Fulfillment API instead of legacy CompleteSale.
   */
  createShippingFulfillment(orderId: string, input: ShippingFulfillmentInput) {
    return this.client.json(`/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}/shipping_fulfillment`, {
      method: "POST",
      body: JSON.stringify(shippingFulfillmentPayload(input)),
    });
  }
}

export class EbayReturnService {
  constructor(private client: EbayRestClient) {}
  /** Post-Order (Return) API search. Paginated; filter is passed through verbatim. */
  searchReturns(offset = 0, filter?: string) {
    const query = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (filter) query.set("filter", filter);
    return this.client.json<Page<{ returns: ReturnRecord[] }>>(`/post-order/v2/return/search?${query}`);
  }
  returnById(returnId: string) {
    return this.client.json<ReturnRecord>(`/post-order/v2/return/${encodeURIComponent(returnId)}`);
  }
}
