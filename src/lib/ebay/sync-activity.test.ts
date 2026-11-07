// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { insertSyncStart, finalizeSyncActivity, isSyncLog, lastSyncAt, formatRelativeTime } from "./sync-activity";

/** Minimal in-memory stand-in for the Supabase client the server uses. */
function stubSupabase() {
  const calls: any[] = [];
  const rows: Record<string, any> = {};
  let nextId = 1;
  return {
    calls,
    rows,
    from: (table: string) => ({
      insert: (row: any) => {
        calls.push({ op: "insert", table, row });
        const id = `row-${nextId++}`;
        rows[id] = { ...row, id };
        return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) };
      },
      update: (patch: any) => ({
        eq: async (_col: string, id: string) => {
          calls.push({ op: "update", table, id, patch });
          if (!rows[id]) return { error: new Error("row not found") };
          rows[id] = { ...rows[id], ...patch };
          return { error: null };
        },
      }),
    }),
  };
}

describe("sync activity rows (a reload mid-sync must not lose the sync)", () => {
  test("insertSyncStart writes a 'started' row and returns its id", async () => {
    const db = stubSupabase();
    const id = await insertSyncStart(db, "u1");
    expect(id).toBe("row-1");
    expect(db.rows["row-1"].message).toBe("eBay sync started…");
    expect(db.rows["row-1"].metadata.syncStatus).toBe("started");
  });

  test("finalize updates the start row in place — one row per sync", async () => {
    const db = stubSupabase();
    const id = await insertSyncStart(db, "u1");
    await finalizeSyncActivity(db, "u1", id, { level: "success", message: "Synced 0 published eBay listings", metadata: { total: 454, synced: 0 } });
    expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(1);
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(db.rows["row-1"].level).toBe("success");
    expect(db.rows["row-1"].message).toBe("Synced 0 published eBay listings");
    expect(db.rows["row-1"].metadata.syncStatus).toBe("finished");
    expect(db.rows["row-1"].metadata.total).toBe(454);
  });

  test("finalize with no start row inserts a fresh row (result never lost)", async () => {
    const db = stubSupabase();
    await finalizeSyncActivity(db, "u1", null, { level: "error", message: "eBay sync failed: boom", metadata: { error: "boom" } });
    expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(1);
    expect(db.rows["row-1"].level).toBe("error");
    expect(db.rows["row-1"].message).toBe("eBay sync failed: boom");
  });

  test("finalize falls back to insert when the start row is gone", async () => {
    const db = stubSupabase();
    await finalizeSyncActivity(db, "u1", "row-999", { level: "warn", message: "Sync finished — 0 listings imported.", metadata: {} });
    expect(db.calls.filter((c) => c.op === "update")).toHaveLength(1);
    expect(db.calls.filter((c) => c.op === "insert")).toHaveLength(1);
    expect(db.rows["row-1"].message).toBe("Sync finished — 0 listings imported.");
  });
});

describe("last sync label (round 2: the Dashboard label must use the real last sync)", () => {
  const now = new Date("2026-11-06T18:29:12-05:00");
  const logs = [
    { created_at: "2026-11-06T17:44:51-05:00", category: "ebay", message: "Synced 0 published eBay listings", metadata: { syncStatus: "finished" } },
    { created_at: "2026-11-06T17:45:12-05:00", category: "ebay", message: "eBay sync started…", metadata: { syncStatus: "started" } },
    { created_at: "2026-11-06T17:30:00-05:00", category: "ebay", message: "eBay disconnected in Settings", metadata: {} },
    { created_at: "2026-11-06T18:00:00-05:00", category: "cj", message: "CJ API-key connection verified and saved", metadata: {} },
  ];

  test("isSyncLog matches sync rows only, not other eBay rows", () => {
    expect(isSyncLog(logs[0])).toBe(true);
    expect(isSyncLog(logs[1])).toBe(true);
    expect(isSyncLog(logs[2])).toBe(false);
    expect(isSyncLog(logs[3])).toBe(false);
    expect(isSyncLog(null)).toBe(false);
  });

  test("lastSyncAt picks the latest sync row, not the latest row overall", () => {
    // The 5:45 PM started row is later than the 5:44 PM finished row;
    // the 6:00 PM CJ row and the 5:30 PM disconnect are not syncs.
    expect(lastSyncAt(logs)).toBe("2026-11-06T17:45:12-05:00");
    expect(lastSyncAt([])).toBeNull();
    expect(lastSyncAt(null)).toBeNull();
  });

  test("formatRelativeTime: the live case — a 5:45 PM sync at 6:29 PM is 44 min ago, not 5 hours", () => {
    expect(formatRelativeTime("2026-11-06T17:45:12-05:00", now)).toBe("44 min ago");
    expect(formatRelativeTime("2026-11-06T18:28:30-05:00", now)).toBe("just now");
    expect(formatRelativeTime("2026-11-06T13:29:00-05:00", now)).toBe("5 hours ago");
    expect(formatRelativeTime("2026-11-06T17:29:00-05:00", now)).toBe("1 hour ago");
    expect(formatRelativeTime("2026-11-04T18:29:00-05:00", now)).toBe("2 days ago");
    expect(formatRelativeTime(null, now)).toBe("never");
    expect(formatRelativeTime("not-a-date", now)).toBe("never");
  });
});
