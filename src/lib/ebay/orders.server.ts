import { EbayRestClient } from "./rest.server";
import type { Dispute, Order, Page } from "./contracts";

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
  // Tracking writes deliberately belong to CJ, not this application.
}