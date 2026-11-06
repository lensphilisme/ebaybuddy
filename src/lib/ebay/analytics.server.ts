import { EbayRestClient } from "./rest.server";

/**
 * eBay Analytics API — Traffic Report.
 *
 * This is the ONLY source of real views/clicks/sales for a listing: the
 * Inventory API deliberately does not expose quantitySold / watchCount, so
 * sync must never guess those numbers. The traffic report is fetched with
 * dimension=LISTING over the last 30 days and written to ebay_listings
 * (views, clicks, sales, last_traffic_check) — that timestamp is what the
 * optimizer's hasFreshTraffic() gate reads. If the report call fails the
 * caller keeps the old numbers and reports the error; metrics are never
 * invented.
 *
 * Docs: GET /sell/analytics/v1/traffic_report
 * Scope: sell.analytics.readonly (already in the OAuth consent list).
 * Metrics used:
 * - LISTING_VIEWS_TOTAL — total View Item page views -> `views`
 * - LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE — views that arrived from a
 *   search results page, i.e. click-throughs from search -> `clicks`
 * - TRANSACTION — completed transactions -> `sales`
 */

export type ListingTraffic = { views: number; clicks: number; sales: number };

type TrafficReportRecord = {
  dimension?: { dimensionKey?: string; value?: string; name?: string };
  metrics?: { key?: string; value?: string }[];
};

type TrafficReport = {
  records?: TrafficReportRecord[];
  lastUpdatedDate?: string;
};

function yyyymmdd(d: Date) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Last-30-days traffic per listing id. Never throws for an empty result. */
export async function fetchListingTraffic(
  accessToken: string,
  listingIds: string[],
  days = 30,
): Promise<Map<string, ListingTraffic>> {
  const result = new Map<string, ListingTraffic>();
  const ids = Array.from(new Set(listingIds.filter(Boolean)));
  if (!ids.length) return result;
  const client = new EbayRestClient(accessToken);
  const end = new Date();
  const start = new Date(end.getTime() - (Math.max(1, Math.min(days, 90)) - 1) * 86400000);
  const range = `[${yyyymmdd(start)}..${yyyymmdd(end)}]`;
  for (const batch of chunk(ids, 100)) {
    const filter = `marketplace_ids:{EBAY_US},date_range:${range},listing_ids:{${batch.join("|")}}`;
    const q = new URLSearchParams({
      dimension: "LISTING",
      metric: "LISTING_VIEWS_TOTAL,LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE,TRANSACTION",
      filter,
    });
    const report = await client.json<TrafficReport>(`/sell/analytics/v1/traffic_report?${q}`);
    for (const rec of report.records || []) {
      const id = rec.dimension?.value;
      if (!id) continue;
      const byKey = new Map((rec.metrics || []).map((m) => [String(m.key || "").toUpperCase(), Number(m.value || 0) || 0]));
      result.set(id, {
        views: byKey.get("LISTING_VIEWS_TOTAL") ?? 0,
        clicks: byKey.get("LISTING_VIEWS_SOURCE_SEARCH_RESULTS_PAGE") ?? 0,
        sales: byKey.get("TRANSACTION") ?? 0,
      });
    }
  }
  return result;
}

/**
 * Refresh traffic for the user's active listings and stamp
 * last_traffic_check. Best-effort: an Analytics failure is returned as
 * { error } instead of thrown, so a listing sync never fails because the
 * traffic report was unavailable. Rows with no report data keep their
 * previous numbers but still get a fresh check stamp only when the report
 * actually returned for them — a missing record means "no data", not zero.
 */
export async function refreshListingTraffic(
  supabase: any,
  userId: string,
  accessToken: string,
  itemIds?: string[],
): Promise<{ updated: number; total: number; error?: string }> {
  let ids = itemIds || [];
  if (!ids.length) {
    const { data } = await supabase
      .from("ebay_listings")
      .select("ebay_item_id")
      .eq("user_id", userId)
      .eq("status", "active")
      .not("ebay_item_id", "is", null)
      .limit(10000);
    ids = (data || []).map((r: any) => r.ebay_item_id).filter(Boolean);
  }
  if (!ids.length) return { updated: 0, total: 0 };
  let traffic: Map<string, ListingTraffic>;
  try {
    traffic = await fetchListingTraffic(accessToken, ids);
  } catch (e) {
    return { updated: 0, total: ids.length, error: e instanceof Error ? e.message : String(e) };
  }
  const now = new Date().toISOString();
  let updated = 0;
  for (const [id, t] of traffic) {
    const { error } = await supabase
      .from("ebay_listings")
      .update({ views: t.views, clicks: t.clicks, sales: t.sales, last_traffic_check: now })
      .eq("user_id", userId)
      .eq("ebay_item_id", id);
    if (!error) updated++;
  }
  return { updated, total: ids.length };
}
