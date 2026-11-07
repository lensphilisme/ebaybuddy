// Sync activity rows — the sync takes ~4 minutes and runs as a server
// function tied to the client's request. If the user reloads or navigates
// away mid-sync, the request is aborted and the function can be killed
// before the final activity row is written, so the sync vanishes with no
// trace (sync #1 left no row at all). Smallest correct version: write a
// "sync started" row the moment the sync begins, and update that SAME row
// with the result when it finishes. An interrupted sync still leaves its
// "started" row; a completed sync leaves exactly one row with the outcome.
// A true background job (surviving function timeouts) is still future work.

export type SyncActivityResult = {
  level: string;
  message: string;
  metadata?: Record<string, unknown>;
};

export type ActivityLogLike = {
  created_at?: string | null;
  category?: string | null;
  message?: string | null;
  // Supabase returns Json here (string | number | boolean | null |
  // arrays / objects), so keep it wide and narrow inside isSyncLog.
  metadata?: unknown;
};

/**
 * Is this activity row a sync record? Sync rows carry metadata.syncStatus
 * ("started" / "finished") — the message alone is not enough, because
 * other eBay rows (connect, disconnect, relist) share the category.
 */
export function isSyncLog(log: ActivityLogLike | null | undefined): boolean {
  if (!log || String(log.category || "").toLowerCase() !== "ebay") return false;
  const status = String((log.metadata as any)?.syncStatus || "");
  if (status === "started" || status === "finished") return true;
  const msg = String(log.message || "");
  return msg.startsWith("eBay sync") || msg.startsWith("Sync") || msg.startsWith("Synced");
}

/** The created_at of the latest sync row, or null when no sync ever ran. */
export function lastSyncAt(logs: ActivityLogLike[] | null | undefined): string | null {
  let latest: string | null = null;
  for (const log of logs || []) {
    if (!isSyncLog(log) || !log.created_at) continue;
    if (!latest || new Date(log.created_at).getTime() > new Date(latest).getTime()) latest = log.created_at;
  }
  return latest;
}

/**
 * Plain-language relative time for the Dashboard "Last sync" label.
 * `now` is injectable for tests. Under a minute is "just now"; under an
 * hour is minutes; under a day is hours; under a week is days; older
 * falls back to the date, so the label never pretends to be precise.
 */
export function formatRelativeTime(when: string | Date | null | undefined, now: Date = new Date()): string {
  if (!when) return "never";
  const t = new Date(when).getTime();
  if (!Number.isFinite(t)) return "never";
  const diffMs = now.getTime() - t;
  if (diffMs < 0) return "just now";
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(when).toLocaleDateString();
}

/**
 * Insert the "sync started" row. Returns its id, or null if the insert
 * failed — a log failure must never fail the sync itself.
 */
export async function insertSyncStart(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("activity_logs")
      .insert({ user_id: userId, level: "info", category: "ebay", message: "eBay sync started…", metadata: { syncStatus: "started" } })
      .select("id")
      .single();
    if (error || !data?.id) return null;
    return String(data.id);
  } catch {
    return null;
  }
}

/**
 * Record the sync outcome on the start row (one row per sync). Falls back
 * to inserting a fresh row when there is no start row or the update fails,
 * so the result is never lost.
 */
export async function finalizeSyncActivity(
  supabase: any,
  userId: string,
  rowId: string | null | undefined,
  result: SyncActivityResult,
): Promise<void> {
  const patch = {
    level: result.level,
    message: result.message,
    metadata: { ...(result.metadata || {}), syncStatus: "finished" },
  };
  if (rowId) {
    try {
      const { error } = await supabase.from("activity_logs").update(patch).eq("id", rowId);
      if (!error) return;
    } catch {
      // fall through to the insert below
    }
  }
  try {
    await supabase.from("activity_logs").insert({ user_id: userId, category: "ebay", ...patch });
  } catch {
    // Last resort: the sync already finished; never fail it over a log row.
  }
}
