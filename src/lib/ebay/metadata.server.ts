import { EbayRestClient } from "./rest.server";
import type { ConditionPolicy, ReturnPolicy } from "./contracts";
export type { ConditionPolicy, ReturnPolicy };

function requireNumericCategory(categoryId: string) {
  if (!/^\d+$/.test(categoryId)) throw new Error("Select a numeric eBay category.");
}

/** Kept for existing callers. Modern Metadata API (sell/metadata), not GeteBayDetails. */
export async function getCategoryPolicies(client: EbayRestClient, categoryId: string) {
  requireNumericCategory(categoryId);
  return client.json<{ itemConditionPolicies: ConditionPolicy[] }>(`/sell/metadata/v1/marketplace/EBAY_US/get_item_condition_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`);
}

export async function getItemConditionPolicies(client: EbayRestClient, categoryId: string) {
  return getCategoryPolicies(client, categoryId);
}

export async function getReturnPolicies(client: EbayRestClient, categoryId: string) {
  requireNumericCategory(categoryId);
  return client.json<{ returnPolicies: ReturnPolicy[] }>(`/sell/metadata/v1/marketplace/EBAY_US/get_return_policies?filter=${encodeURIComponent(`categoryIds:{${categoryId}}`)}`);
}
