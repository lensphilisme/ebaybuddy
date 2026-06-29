import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  cjSearchProducts,
  cjGetCategories,
  cjGetWarehouses,
  cjProductDetail,
  cjFreightCalculate,
  type CjListResponse,
  type CjProductDetail,
  type CjFreightOption,
  type CjCategoryTree,
  type CjWarehouse,
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
  .inputValidator((data: { pid: string; countryCode?: string }) => data)
  .handler(async ({ data }): Promise<CjProductDetail> => {
    return cjProductDetail(data.pid, data.countryCode);
  });

export const getCjCategories = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CjCategoryTree[]> => cjGetCategories());

export const getCjWarehouses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<CjWarehouse[]> => cjGetWarehouses());

export const getCjFreight = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    startCountryCode?: string;
    endCountryCode: string;
    products: { vid: string; quantity: number }[];
  }) => data)
  .handler(async ({ data }): Promise<CjFreightOption[]> => {
    return cjFreightCalculate(data);
  });
