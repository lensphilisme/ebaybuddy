// @ts-nocheck -- run with `bun test`
import { describe, expect, test } from "bun:test";
import { insertSyncStart, finalizeSyncActivity } from "./sync-activity";

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
