import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjProductDetail,
  cjFreightCalculate,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
} from "./cj.server";

export const searchCjProducts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    keyword?: string;
    categoryId?: string;
    pageNum?: number;
    pageSize?: number;
    countryCode?: string;
    minPrice?: number;
    maxPrice?: number;
  }) => data)
  .handler(async ({ data }): Promise<CjListResponse> => {
    return cjSearchProducts(data);
  });

export const getCjProduct = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { pid: string }) => data)
  .handler(async ({ data }): Promise<CjProductDetail> => {
    return cjProductDetail(data.pid);
  });

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    endCountryCode: string;
    products: { vid: string; quantity: number }[];
  }) => data)
  .handler(async ({ data }): Promise<CjFreightOption[]> => {
    return cjFreightCalculate(data);
  });
