import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjGetCategories,
  cjGetWarehouses,
  cjProductDetail,
  cjGetInventoryByPid,
  cjFreightCalculate,
  getUserCjToken,
  isCjTokenError,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
  type CjCategoryTree,
  type CjWarehouse,
} from "./cj.server";
import type { CjInventory } from "./cj-inventory";
import { DEFAULT_AI_PROVIDER, defaultModelFor, isAiProviderId } from "./ai-provider.server";

async function tok(ctx: any): Promise<string> {
  const token = await getUserCjToken(ctx.supabase, ctx.userId);
  if (!token) throw new Error("Add your CJ API key in Settings first.");
  return token;
}

/**
 * CJ tokens live ~180 days and can be revoked mid-life (code 1600001).
 * On that error, force one fresh exchange from the saved API key and retry
 * once — the user should not have to re-paste anything, and must never be
 * asked to paste the access token itself.
 */
async function withCjRetry<T>(ctx: any, fn: (token: string) => Promise<T>): Promise<T> {
  try {
    return await fn(await tok(ctx));
  } catch (error) {
    if (!isCjTokenError(error)) throw error;
    const { refreshUserCjToken } = await import("./cj-auth.server");
    const fresh = await refreshUserCjToken(ctx.supabase, ctx.userId);
    return fn(fresh);
  }
}

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keyword?: string; categoryId?: string; pageNum?: number; pageSize?: number; countryCode?: string; minPrice?: number; maxPrice?: number; }) => data)
  .handler(async ({ data, context }: any): Promise<CjListResponse> => withCjRetry(context, (token) => cjSearchProducts(data, token)));

export const getCjProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string; countryCode?: string }) => data)
  .handler(async ({ data, context }: any): Promise<CjProductDetail> => withCjRetry(context, (token) => cjProductDetail(data.pid, data.countryCode, token)));

export const getCjCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjCategoryTree[]> => withCjRetry(context, (token) => cjGetCategories(token)));

export const getCjWarehouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjWarehouse[]> => withCjRetry(context, (token) => cjGetWarehouses(token)));

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { startCountryCode?: string; endCountryCode: string; products: { vid: string; quantity: number }[]; }) => data)
  .handler(async ({ data, context }: any): Promise<CjFreightOption[]> => withCjRetry(context, (token) => cjFreightCalculate(data, token)));

/** Warehouse stock for a product (which countries hold it, per variant) —
// the freight quote's origin. See src/lib/cj-inventory.ts. */
export const getCjInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string }) => data)
  .handler(async ({ data, context }: any): Promise<CjInventory> => withCjRetry(context, (token) => cjGetInventoryByPid(data.pid, token)));

export const saveCjApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { apiKey: string }) => data)
  .handler(async ({ data, context }: any) => {
    const { saveUserCjApiKey } = await import("./cj-auth.server");
    await saveUserCjApiKey(context.userId, data.apiKey);
    const row = {
      user_id: context.userId,
      provider: "cj",
      label: "default",
      environment: "production",
      is_active: true,
      last_validated_at: new Date().toISOString(),
      credentials: { auth_type: "api_key", managed: true, api_key: data.apiKey.trim() },
    };
    const { data: existing } = await context.supabase.from("integration_credentials").select("id").eq("user_id", context.userId).eq("provider", "cj").eq("label", "default").maybeSingle();
    const saved = existing?.id ? await context.supabase.from("integration_credentials").update(row).eq("id", existing.id) : await context.supabase.from("integration_credentials").insert(row);
    if (saved.error) throw new Error("CJ validated your key, but saving failed. Please retry.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "cj", message: "CJ API-key connection verified and saved" });
    return { ok: true };
  });

/**
 * Disconnect CJ (audit #51): removes the saved API key (and its cached
 * access token) so CJ calls stop. Drafts and listings already in the app
 * are NOT deleted. Confirmation happens in the Settings UI.
 */
export const disconnectCj = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { error } = await context.supabase.from("integration_credentials").delete().eq("user_id", context.userId).eq("provider", "cj").eq("label", "default");
    if (error) throw new Error("Could not disconnect CJ. Please retry.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "info", category: "cj", message: "CJ disconnected in Settings" });
    return { ok: true };
  });

// Reports connection status considering per-user creds first, then env fallback.
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data } = await context.supabase.from("integration_credentials").select("provider,is_active,last_validated_at,credentials").eq("user_id", context.userId);
    const cjRow = data?.find((r: any) => r.provider === "cj");
    const ebayRow = data?.find((r: any) => r.provider === "ebay");
    const aiRow = data?.find((r: any) => r.provider === "ai");
    const cjConnected = cjRow ? !!(cjRow.is_active && (cjRow.credentials?.managed || cjRow.credentials?.api_key)) : !!process.env.CJ_API_KEY;
    const ebayConnected = !!(ebayRow?.is_active && ebayRow.credentials?.refresh_token);
    const aiConnected = !!(aiRow?.is_active && aiRow.credentials?.api_key) || !!(process.env.AI_API_KEY || "").trim();
    // The AI provider SELECTION and the key are separate facts (same rule
    // as getAiConfigStatus): with no row and no env key the app still has
    // a selection — its default, DeepSeek — so the Dashboard names it
    // ("AI (DeepSeek — no key)") instead of a bare "AI not connected"
    // while Settings shows DeepSeek selected. connected stays false.
    const aiProvider = isAiProviderId(aiRow?.credentials?.provider)
      ? aiRow.credentials.provider
      : isAiProviderId(process.env.AI_PROVIDER)
        ? (process.env.AI_PROVIDER as typeof DEFAULT_AI_PROVIDER)
        : DEFAULT_AI_PROVIDER;
    return {
      cj: { connected: cjConnected, source: cjRow ? "user" : cjConnected ? "env" : null, last: cjRow?.last_validated_at || null },
      ebay: { connected: ebayConnected, source: ebayConnected ? "user" : null, last: ebayRow?.last_validated_at || null },
      ai: {
        connected: aiConnected,
        provider: aiProvider,
        model: aiRow?.credentials?.model || process.env.AI_MODEL || defaultModelFor(aiProvider),
        keyLast4: aiRow?.credentials?.api_key ? String(aiRow.credentials.api_key).slice(-4) : null,
        source: aiRow ? "user" : aiConnected ? "env" : "default",
        last: aiRow?.last_validated_at || null,
      },
    };
  });
