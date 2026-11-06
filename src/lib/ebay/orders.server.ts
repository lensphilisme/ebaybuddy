import { EbayRestClient } from "./rest.server";
import { EbayError } from "./http";
import type { Dispute, Order, Page, ReturnRecord, ShippingFulfillmentInput } from "./contracts";
import { shippingFulfillmentPayload } from "./contracts";

export class EbayOrderService {
  constructor(private client: EbayRestClient) {}
  orders(offset = 0, status = "ALL") {
    const query = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (status !== "ALL") query.set("filter", `orderfulfillmentstatus:{${status}}`);
    return this.client.json<Page<{ orders: Order[] }>>(`/sell/fulfillment/v1/order?${query}`);
  }
  /**
   * eBay returns 404 from payment_dispute_summary when the seller has no
   * disputes at all — that is an empty list, not an error. Swallow 404
   * here so the Orders tab shows a proper empty state instead of
   * "eBay request failed".
   */
  async disputes(offset = 0): Promise<Page<{ paymentDisputeSummaries: Dispute[] }>> {
    try {
      return await this.client.json<Page<{ paymentDisputeSummaries: Dispute[] }>>(`/sell/fulfillment/v1/payment_dispute_summary?limit=50&offset=${offset}`);
    } catch (e) {
      if (e instanceof EbayError && e.status === 404) return { paymentDisputeSummaries: [], total: 0 };
      throw e;
    }
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
  // Post-Order API v2 — the modern REST surface for returns (NOT the legacy
  // Trading API). Two differences from the Sell REST family:
  // - it authenticates with "IAF {token}" instead of "Bearer {token}", so
  //   this service builds its client with authScheme "IAF";
  // - it needs the sell.fulfillment scope (added to the OAuth consent list
  //   Nov 2026 — accounts connected before then must reconnect once).
  constructor(private client: EbayRestClient) {}
  private mapReturn(raw: any): ReturnRecord {
    const items = raw.returnItems || raw.items || [];
    return {
      returnId: String(raw.returnId || raw.return_id || ""),
      returnStatus: String(raw.returnState || raw.returnStatus || raw.state || ""),
      creationDate: String(raw.creationDate || raw.createdDate || ""),
      orderId: String(raw.orderId || raw.order_id || ""),
      buyerUsername: String(raw.buyer?.username || raw.buyerUsername || ""),
      returnItems: (Array.isArray(items) ? items : []).map((it: any) => ({
        itemId: String(it.itemId || it.item_id || ""),
        returnQuantity: Number(it.returnQuantity || it.quantity || 0) || undefined,
        returnReason: String(it.returnReason || it.reason || ""),
      })),
    };
  }
  async searchReturns(offset = 0, filter?: string) {
    const query = new URLSearchParams({ limit: "50", offset: String(offset) });
    if (filter) query.set("filter", filter);
    const json = await this.client.json<{ members?: any[]; total?: number }>(`/post-order/v2/return/search?${query}`);
    const members = (json.members || []).map((m) => this.mapReturn(m)).filter((r) => r.returnId);
    return { total: json.total ?? members.length, returns: members };
  }
}
