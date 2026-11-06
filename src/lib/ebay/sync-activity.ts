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
