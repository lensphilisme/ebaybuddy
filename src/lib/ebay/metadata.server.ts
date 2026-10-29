import { EbayRestClient } from "./rest.server";
export type ConditionPolicy = { categoryId: string; itemConditions?: { conditionId: string; conditionDescription: string }[] };
export async function getCategoryPolicies(client: EbayRestClient, categoryId: string) {
  if (!/^\d+$/.test(categoryId)) throw new Error("Select a numeric eBay category.");
  return client.json<{ itemConditionPolicies: ConditionPolicy[] }>(`/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`);
}