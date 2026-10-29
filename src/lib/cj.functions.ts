import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjGetCategories,
  cjGetWarehouses,
  cjProductDetail,
  cjFreightCalculate,
  getUserCjToken,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
  type CjCategoryTree,
  type CjWarehouse,
} from "./cj.server";

async function tok(ctx: any) {
  return getUserCjToken(ctx.supabase, ctx.userId);
}

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { keyword?: string; categoryId?: string; pageNum?: number; pageSize?: number; countryCode?: string; minPrice?: number; maxPrice?: number; }) => data)
  .handler(async ({ data, context }: any): Promise<CjListResponse> => cjSearchProducts(data, await tok(context)));

export const getCjProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string; countryCode?: string }) => data)
  .handler(async ({ data, context }: any): Promise<CjProductDetail> => cjProductDetail(data.pid, data.countryCode, await tok(context)));

export const getCjCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjCategoryTree[]> => cjGetCategories(await tok(context)));

export const getCjWarehouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any): Promise<CjWarehouse[]> => cjGetWarehouses(await tok(context)));

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { startCountryCode?: string; endCountryCode: string; products: { vid: string; quantity: number }[]; }) => data)
  .handler(async ({ data, context }: any): Promise<CjFreightOption[]> => cjFreightCalculate(data, await tok(context)));

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
      credentials: { auth_type: "api_key", managed: true },
    };
    const { data: existing } = await context.supabase.from("integration_credentials").select("id").eq("user_id", context.userId).eq("provider", "cj").eq("label", "default").maybeSingle();
    const saved = existing?.id ? await context.supabase.from("integration_credentials").update(row).eq("id", existing.id) : await context.supabase.from("integration_credentials").insert(row);
    if (saved.error) throw new Error("CJ validated your key, but saving failed. Please retry.");
    await context.supabase.from("activity_logs").insert({ user_id: context.userId, level: "success", category: "cj", message: "CJ API-key connection verified and saved" });
    return { ok: true };
  });

// Reports connection status considering per-user creds first, then env fallback.
export const getIntegrationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }: any) => {
    const { data } = await context.supabase.from("integration_credentials").select("provider,is_active,last_validated_at,credentials").eq("user_id", context.userId);
    const cjRow = data?.find((r: any) => r.provider === "cj");
    const ebayRow = data?.find((r: any) => r.provider === "ebay");
    const cjConnected = cjRow ? !!(cjRow.is_active && (cjRow.credentials?.managed || cjRow.credentials?.api_key || cjRow.credentials?.access_token)) : !!(process.env.CJ_API_KEY || process.env.CJ_ACCESS_TOKEN);
    const ebayConnected = !!(ebayRow?.is_active && ebayRow.credentials?.refresh_token);
    return {
      cj: { connected: cjConnected, source: cjRow ? "user" : cjConnected ? "env" : null, last: cjRow?.last_validated_at || null },
      ebay: { connected: ebayConnected, source: ebayConnected ? "user" : null, last: ebayRow?.last_validated_at || null },
    };
  });
