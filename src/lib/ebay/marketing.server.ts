import { z } from "zod";
import type { Campaign, Page, CampaignInput } from "./contracts";
import { EbayRestClient } from "./rest.server";

export const campaignInput = z.object({ name: z.string().trim().min(1).max(80).refine((value) => !/[<>]/.test(value)), strategy: z.enum(["FIXED", "DYNAMIC"]), rate: z.number().min(2).max(100), listingIds: z.array(z.string().regex(/^\d+$/)).min(1).max(500) });
export function campaignPayload(input: CampaignInput) {
  campaignInput.parse(input);
  return { campaignName: input.name.trim(), marketplaceId: "EBAY_US", startDate: new Date().toISOString(), fundingStrategy: { fundingModel: "COST_PER_SALE", adRateStrategy: input.strategy, ...(input.strategy === "FIXED" ? { bidPercentage: input.rate.toFixed(1) } : {}) } };
}
export class EbayMarketingService {
  constructor(private client: EbayRestClient) {}
  campaigns(offset = 0) { return this.client.json<Page<{ campaigns: Campaign[] }>>(`/sell/marketing/v1/ad_campaign?limit=50&offset=${offset}`); }
  /** Ads in a campaign (each carries a listingId) — used to count the
   * listings a campaign promotes and to attribute views/sales to it for
   * the optimizer's auto-pause rule. */
  ads(campaignId: string) {
    return this.client.json<{ ads?: { adId?: string; listingId?: string }[]; total?: number }>(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(campaignId)}/ad?limit=500&offset=0`);
  }
  async create(input: CampaignInput) {
    const response = await this.client.response("/sell/marketing/v1/ad_campaign", { method: "POST", body: JSON.stringify(campaignPayload(input)) });
    const id = response.headers.get("location")?.split("/").pop();
    if (!id) throw new Error("eBay created the campaign but did not return its ID. Refresh campaigns before retrying.");
    try {
      const result = await this.client.json<{ responses?: { statusCode?: number; errors?: { message?: string }[] }[] }>(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(id)}/bulk_create_ads_by_listing_id`, {
        method: "POST", body: JSON.stringify({ requests: input.listingIds.map((listingId) => ({ listingId, ...(input.strategy === "FIXED" ? { bidPercentage: input.rate.toFixed(1) } : {}) })) }),
      });
      const failures = (result.responses || []).filter((row) => (row.statusCode || 200) >= 400 || row.errors?.length);
      return { id, failed: failures.length, added: input.listingIds.length - failures.length };
    } catch (error) { throw new Error(`Campaign ${id} created, but adding listings failed. Refresh before retrying. ${error instanceof Error ? error.message : ""}`); }
  }
  async action(id: string, action: "pause" | "resume" | "end") {
    await this.client.response(`/sell/marketing/v1/ad_campaign/${encodeURIComponent(id)}/${action}`, { method: "POST" });
    return { ok: true };
  }
}