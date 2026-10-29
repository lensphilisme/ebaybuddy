import { ebayFetch as fetch } from "./http";
const EBAY_API_BASE = "https://api.ebay.com";
export async function getCategorySuggestions(accessToken: string, q: string, marketplaceId = "EBAY_US") {
  const treeRes = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const tree = await treeRes.json();
  if (!treeRes.ok) throw new Error(`eBay category tree error: ${tree.message || treeRes.statusText}`);
  const res = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_category_suggestions?q=${encodeURIComponent(q)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`eBay category suggestion error: ${json.message || res.statusText}`);
  return (json.categorySuggestions || []).map((s: any) => ({
    categoryId: s.category?.categoryId,
    categoryName: s.category?.categoryName,
    path: (s.categoryTreeNodeAncestors || []).map((a: any) => a.categoryName).concat(s.category?.categoryName).filter(Boolean).join(" > "),
  }));
}

// Fetch required/recommended aspects for a category via eBay Taxonomy API.
export async function getItemAspectsForCategory(accessToken: string, categoryId: string, marketplaceId = "EBAY_US") {
  try {
    const treeRes = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const tree = await treeRes.json();
    if (!treeRes.ok) return {} as Record<string, { required: boolean; allowed?: string[]; maxLen?: number; applicableTo?: string[]; usage?: string; cardinality?: string }>;
    const res = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${tree.categoryTreeId}/get_item_aspects_for_category?category_id=${encodeURIComponent(categoryId)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const json = await res.json();
    if (!res.ok) return {};
    const out: Record<string, { required: boolean; allowed?: string[]; maxLen?: number; applicableTo?: string[]; usage?: string; cardinality?: string }> = {};
    for (const a of json.aspects || []) {
      const name = String(a?.localizedAspectName || "").trim();
      if (!name) continue;
      const c = a.aspectConstraint || {};
      const values = (a.aspectValues || []).map((v: any) => String(v.localizedValue || "").trim()).filter(Boolean);
      out[name] = {
        required: !!c.aspectRequired,
        allowed: c.aspectMode === "SELECTION_ONLY" && values.length ? values : undefined,
        maxLen: Number(c.aspectMaxLength || 65) || 65,
        applicableTo: Array.isArray(c.aspectApplicableTo) ? c.aspectApplicableTo : undefined,
        usage: c.aspectUsage,
        cardinality: c.itemToAspectCardinality,
      };
    }
    return out;
  } catch { return {}; }
}

// Fetch the full first-two levels of the eBay category tree for a marketplace.
// Used by the AI deep-category picker as a fallback when normal suggestions are wrong.
export async function getEbayCategoryTreeShallow(accessToken: string, marketplaceId = "EBAY_US") {
  const treeRes = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/get_default_category_tree_id?marketplace_id=${marketplaceId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const treeMeta = await treeRes.json();
  if (!treeRes.ok) throw new Error(`eBay category tree error: ${treeMeta.message || treeRes.statusText}`);
  const full = await fetch(`${EBAY_API_BASE}/commerce/taxonomy/v1/category_tree/${treeMeta.categoryTreeId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const fullJson = await full.json();
  if (!full.ok) throw new Error(`eBay tree fetch error: ${fullJson.message || full.statusText}`);
  const rows: { categoryId: string; path: string; leaf: boolean }[] = [];
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

