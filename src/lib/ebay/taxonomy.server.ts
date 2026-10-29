import { EbayRestClient } from "./rest.server";
import type { AspectSpec, CategorySuggestion, CategoryTreeNode } from "./contracts";

// Modern Taxonomy API only — no GetCategories / GetCategoryFeatures / GeteBayDetails.
// All calls go through EbayRestClient, so they share typed errors, correlation
// IDs, sanitized logs, retries, circuit breaker and marketplace pacing.

export async function getCategorySuggestions(accessToken: string, q: string, marketplaceId = "EBAY_US"): Promise<CategorySuggestion[]> {
  const client = new EbayRestClient(accessToken, marketplaceId);
  const tree = await client.json<{ categoryTreeId: string }>(`/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`);
  const json = await client.json<{ categorySuggestions?: { category?: { categoryId: string; categoryName: string }; categoryTreeNodeAncestors?: { categoryName: string }[] }[] }>(
    `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(q)}`,
  );
  return (json.categorySuggestions || []).map((s) => ({
    categoryId: s.category?.categoryId || "",
    categoryName: s.category?.categoryName || "",
    path: (s.categoryTreeNodeAncestors || []).map((a) => a.categoryName).concat(s.category?.categoryName || "").filter(Boolean).join(" > "),
  }));
}

// Fetch required/recommended aspects for a category via eBay Taxonomy API.
// Returns {} on any failure, preserving the previous publish-time fallback:
// a failed aspect lookup must not block a listing push.
export async function getItemAspectsForCategory(accessToken: string, categoryId: string, marketplaceId = "EBAY_US"): Promise<Record<string, AspectSpec>> {
  try {
    const client = new EbayRestClient(accessToken, marketplaceId);
    const tree = await client.json<{ categoryTreeId: string }>(`/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`);
    const json = await client.json<{ aspects?: { localizedAspectName?: string; aspectConstraint?: { aspectRequired?: boolean; aspectMode?: string; aspectMaxLength?: number; aspectApplicableTo?: string[]; aspectUsage?: string }; aspectValues?: { localizedValue?: string }[]; itemToAspectCardinality?: string }[] }>(
      `/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`,
    );
    const out: Record<string, AspectSpec> = {};
    for (const a of json.aspects || []) {
      const name = String(a?.localizedAspectName || "").trim();
      if (!name) continue;
      const c = a.aspectConstraint || {};
      const values = (a.aspectValues || []).map((v) => String(v.localizedValue || "").trim()).filter(Boolean);
      out[name] = {
        required: !!c.aspectRequired,
        allowed: c.aspectMode === "SELECTION_ONLY" && values.length ? values : undefined,
        maxLen: Number(c.aspectMaxLength || 65) || 65,
        applicableTo: Array.isArray(c.aspectApplicableTo) ? c.aspectApplicableTo : undefined,
        usage: c.aspectUsage,
        cardinality: a.itemToAspectCardinality,
      };
    }
    return out;
  } catch { return {}; }
}

// Fetch the first levels of the eBay category tree for a marketplace.
// Used by the AI deep-category picker as a fallback when normal suggestions are wrong.
export async function getEbayCategoryTreeShallow(accessToken: string, marketplaceId = "EBAY_US"): Promise<{ treeId: string; categories: CategoryTreeNode[] }> {
  const client = new EbayRestClient(accessToken, marketplaceId);
  const treeMeta = await client.json<{ categoryTreeId: string }>(`/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`);
  const fullJson = await client.json<{ rootCategoryNode: any }>(`/commerce/taxonomy/v1/category_tree/${treeMeta.categoryTreeId}`);
  const rows: CategoryTreeNode[] = [];
  const walk = (node: any, path: string[], depth: number) => {
    const name = node?.category?.categoryName;
    const id = node?.category?.categoryId;
    const nextPath = name ? [...path, name] : path;
    const leaf = !!node?.leafCategoryTreeNode;
    if (id && depth >= 1) rows.push({ categoryId: id, path: nextPath.join(" > "), leaf });
    if (node?.childCategoryTreeNodes && depth < 3) {
      for (const c of node.childCategoryTreeNodes) walk(c, nextPath, depth + 1);
    }
  };
  walk(fullJson.rootCategoryNode, [], 0);
  return { treeId: treeMeta.categoryTreeId, categories: rows };
}
