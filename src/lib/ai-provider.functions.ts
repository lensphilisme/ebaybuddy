import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeAiConfig, validateAiConfig, getAiConfigStatus, getUserAiConfig } from "./ai-provider.server";

/** Save (or replace) the user's AI provider + key. Validates live first, like CJ. */
export const saveAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: string; model?: string; apiKey: string; baseUrl?: string }) => data)
  .handler(async ({ data, context }: any) => {
    const config = normalizeAiConfig(data);
    await validateAiConfig(config);
    const row = {
      user_id: context.userId,
      provider: "ai",
      label: "default",
      environment: "production",
      is_active: true,
      last_validated_at: new Date().toISOString(),
      credentials: {
        auth_type: "api_key",
        managed: true,
        provider: config.provider,
        model: config.model,
        api_key: config.apiKey,
        ...(config.provider === "custom" ? { base_url: config.baseUrl } : {}),
      },
    };
    const { data: existing } = await context.supabase.from("integration_credentials").select("id").eq("user_id", context.userId).eq("provider", "ai").eq("label", "default").maybeSingle();
    const saved = existing?.id ? await context.supabase.from("integration_credentials").update(row).eq("id", existing.id) : await context.supabase.from("integration_credentials").insert(row);
    if (saved.error) throw new Error("The provider answered, but saving failed. Please retry.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "ai", message: `AI provider connected: ${config.provider} (${config.model})` });
    return { ok: true, provider: config.provider, model: config.model };
  });

/** Disconnect the user's AI provider (falls back to local rules). */
export const removeAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { error } = await context.supabase.from("integration_credentials").delete().eq("user_id", context.userId).eq("provider", "ai").eq("label", "default");
    if (error) throw new Error("Could not remove the AI provider. Please retry.");
    return { ok: true };
  });

/** Status for Settings: provider/model + masked key tail, never the key itself. */
export const getAiProviderStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => getAiConfigStatus(context.supabase, context.userId));

/**
 * Test the SAVED key (audit #50): re-validates the stored provider + key
 * live and reports whether it still works. "Key invalid" shows when the
 * saved key is rejected — the user then replaces it.
 */
export const testAiProvider = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const config = await getUserAiConfig(context.supabase, context.userId);
    if (!config) throw new Error("No AI key saved — paste a key in Settings first.");
    await validateAiConfig(config);
    const { error } = await context.supabase.from("integration_credentials").update({ last_validated_at: new Date().toISOString() }).eq("user_id", context.userId).eq("provider", "ai").eq("label", "default");
    if (error) throw new Error("Key works, but saving the check failed. Retry.");
    return { ok: true, provider: config.provider, model: config.model };
  });
