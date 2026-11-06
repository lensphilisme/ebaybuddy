import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizeAiConfig, validateAiConfig, getAiConfigStatus, getUserAiConfig, isAiProviderId, aiSelectionRow } from "./ai-provider.server";

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
 * Save only the provider SELECTION (no key). Settings calls this when the
 * provider dropdown changes, so the choice survives a reload and the
 * status can name the provider even before a key is pasted — the Settings
 * dropdown used to be local state only, so a "preselected DeepSeek" was
 * just the hardcoded default and the status truthfully reported no
 * provider at all. Never overwrites a saved key: when a key is stored the
 * selection already lives in that row, so this is a no-op.
 */
export const saveAiProviderSelection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { provider: string; model?: string }) => data)
  .handler(async ({ data, context }: any) => {
    if (!isAiProviderId(data.provider)) throw new Error("Unknown AI provider.");
    const { data: existing } = await context.supabase.from("integration_credentials").select("id,credentials").eq("user_id", context.userId).eq("provider", "ai").eq("label", "default").maybeSingle();
    if (existing?.credentials?.api_key) return { ok: true, keySaved: true, provider: existing.credentials.provider || data.provider };
    const row = aiSelectionRow(context.userId, data.provider, String(data.model || ""));
    const saved = existing?.id
      ? await context.supabase.from("integration_credentials").update(row).eq("id", existing.id)
      : await context.supabase.from("integration_credentials").insert(row);
    if (saved.error) throw new Error("Could not save the AI provider choice. Please retry.");
    return { ok: true, keySaved: false, provider: data.provider, model: row.credentials.model };
  });

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
