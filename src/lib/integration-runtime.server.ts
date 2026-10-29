import { singleFlight } from "./ebay/http";

// Only callers that have already authenticated may supply a user-scoped key.
export async function withIntegrationLock<T>(key: string, operation: (db: any) => Promise<T>): Promise<T> {
  return singleFlight(key, async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const db = supabaseAdmin as any;
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

export async function readRuntime(db: any, key: string): Promise<Record<string, any>> {
  const { data, error } = await db.from("integration_runtime").select("payload").eq("key", key).maybeSingle();
  if (error) throw new Error("Connection storage is unavailable.");
  return data?.payload || {};
}

export async function writeRuntime(db: any, key: string, payload: Record<string, unknown>) {
  const { error } = await db.from("integration_runtime").update({ payload, updated_at: new Date().toISOString() }).eq("key", key);
  if (error) throw new Error("Could not save connection details.");
}