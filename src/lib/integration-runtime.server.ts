import { singleFlight } from "./ebay/http";

// Only callers that have already authenticated may supply a user-scoped key.
export async function withIntegrationLock<T>(key: string, operation: (db: any) => Promise<T>): Promise<T> {
  return singleFlight(key, async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
    // The lock RPC can only claim a row that exists. A first-time CJ/eBay
    // connection has no row yet, so create it idempotently first — otherwise
    // every claim fails and the caller spins for ~50s and then errors.
    // This was the root cause of "CJ API key verified, then it never works":
    // validation succeeded, but nothing was ever persisted.
    await ensureRuntimeRow(db, key);
    const owner = crypto.randomUUID();
    for (let attempt = 0; attempt < 100; attempt++) {
      const { data, error } = await db.rpc("claim_integration_lock", { p_key: key, p_owner: owner });
      if (error) throw new Error("Connection renewal storage is unavailable. Please retry.");
      if (data) {
        try { return await operation(db); }
        finally { await db.from("integration_runtime").update({ lock_owner: null, lock_until: null }).eq("key", key).eq("lock_owner", owner); }
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Connection renewal is busy. Please retry shortly.");
  });
}

export async function ensureRuntimeRow(db: any, key: string) {
  const { error } = await db.from("integration_runtime").upsert(
    { key, payload: {}, lock_owner: null, lock_until: null, updated_at: new Date().toISOString() },
    { onConflict: "key", ignoreDuplicates: true },
  );
  if (error) throw new Error("Connection storage is unavailable.");
}

export async function readRuntime(db: any, key: string): Promise<Record<string, any>> {
  const { data, error } = await db.from("integration_runtime").select("payload").eq("key", key).maybeSingle();
  if (error) throw new Error("Connection storage is unavailable.");
  return data?.payload || {};
}

export async function writeRuntime(db: any, key: string, payload: Record<string, unknown>) {
  // Upsert, not update-only: an update-only write silently affects zero rows
  // on a first connection, so the API key / session was lost even though the
  // caller reported success. Upsert preserves the lock columns as null here;
  // the lock itself is released by withIntegrationLock's finally block.
  const { error } = await db.from("integration_runtime").upsert(
    { key, payload, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  if (error) throw new Error("Could not save connection details.");
}
