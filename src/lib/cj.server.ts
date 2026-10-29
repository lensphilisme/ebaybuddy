// Server-only CJ Dropshipping Open API client.
// Docs: https://developers.cjdropshipping.com/en/api/
import { resolveUserCjToken } from "./cj-auth.server";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

type CjEnvelope<T> = { code: number; result?: boolean; success?: boolean; message: string; data: T };

async function cjFetch<T>(path: string, init: RequestInit = {}, overrideToken?: string): Promise<T> {
  return cjFetchOnce<T>(path, init, overrideToken);
}

async function cjFetchOnce<T>(path: string, init: RequestInit = {}, overrideToken?: string): Promise<T> {
  const token = overrideToken;
  if (!token) throw new Error("CJ is not connected. Add your API key in Settings → CJ Dropshipping.");
  const res = await fetch(`${CJ_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "CJ-Access-Token": token,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let json: CjEnvelope<T>;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`CJ returned an unreadable response (${res.status}). Please retry.`);
  }
  if (json.result === false || json.success === false || (json.code && json.code !== 200)) {
    if (/1600001|access token|invalid.*key/i.test(`${json.code} ${json.message}`)) throw new Error("Your CJ connection expired or was revoked. Reconnect with your API key in Settings.");
    throw new Error(`CJ request failed (${json.code}). Please retry or check your CJ account quota.`);
  }
  return json.data;
}

export async function getUserCjToken(supabase: any, userId: string): Promise<string | undefined> {
  return resolveUserCjToken(supabase, userId);
}

export type CjCategoryTree = {
  categoryFirstName: string;
  categoryFirstList?: {
    categorySecondName: string;
    categorySecondList?: { categoryId: string; categoryName: string }[];
  }[];
};

export type CjWarehouse = {
  countryCode: string;
  nameEn?: string;
  areaEn?: string;
  valueEn?: string;
  disabled?: boolean;
};

export type CjListItem = {
  pid: string;
  productNameEn: string;
  productSku: string;
  productImage: string;
  sellPrice: number | string;
  productWeight?: number | string;
  productType?: string;
  categoryName?: string;
  categoryId?: string;
  listedNum?: number;
  supplierName?: string;
  createrTime?: string;
};

export type CjListResponse = {
  pageNum: number;
  pageSize: number;
  total: number;
  list: CjListItem[];
};

export async function cjSearchProducts(params: {
  keyword?: string;
  categoryId?: string;
  pageNum?: number;
  pageSize?: number;
  countryCode?: string;
  minPrice?: number;
  maxPrice?: number;
}, token?: string): Promise<CjListResponse> {
  const q = new URLSearchParams();
  q.set("pageNum", String(params.pageNum ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.keyword) q.set("productNameEn", params.keyword);
  if (params.categoryId) q.set("categoryId", params.categoryId);
  if (params.countryCode) q.set("countryCode", params.countryCode);
  if (params.minPrice != null) q.set("minPrice", String(params.minPrice));
  if (params.maxPrice != null) q.set("maxPrice", String(params.maxPrice));
  return cjFetch<CjListResponse>(`/product/list?${q}`, {}, token);
}

export type CjVariant = {
  vid: string;
  variantNameEn?: string;
  variantSku?: string;
  variantImage?: string;
  variantSellPrice?: number | string;
  variantWeight?: number | string;
  variantLength?: number | string;
  variantWidth?: number | string;
  variantHeight?: number | string;
  variantKey?: string; // e.g. "Red-XL"
  inventory?: number;
};

export type CjProductDetail = {
  pid: string;
  productNameEn: string;
  productSku: string;
  bigImage?: string;
  productImage: string;
  productImageSet?: string[];
  productImages?: string[];
  description?: string;
  sellPrice: number | string;
  productWeight?: number | string;
  categoryId?: string;
  categoryName?: string;
  productType?: string;
  productKeyEn?: string;
  productProEnSet?: string[];
  packingWeight?: string | number;
  variants?: CjVariant[];
  // some endpoints return "variantList" or "productVariants"
  variantList?: CjVariant[];
  productVariants?: CjVariant[];
};

export async function cjGetCategories(token?: string): Promise<CjCategoryTree[]> {
  return cjFetch<CjCategoryTree[]>("/product/getCategory", {}, token);
}

export async function cjGetWarehouses(token?: string): Promise<CjWarehouse[]> {
  return cjFetch<CjWarehouse[]>("/product/globalWarehouseList", {}, token);
}

export async function cjProductDetail(pid: string, countryCode?: string, token?: string): Promise<CjProductDetail> {
  const q = new URLSearchParams({ pid, features: "enable_combine,enable_video" });
  if (countryCode) q.set("countryCode", countryCode);
  return cjFetch<CjProductDetail>(`/product/query?${q}`, {}, token);
}

export type CjFreightOption = {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string;
  logisticWeight?: number;
  trackInfo?: string;
};

export async function cjFreightCalculate(params: {
  startCountryCode?: string;
  endCountryCode: string;
  products: { vid: string; quantity: number }[];
}, token?: string): Promise<CjFreightOption[]> {
  const body = {
    startCountryCode: params.startCountryCode ?? "CN",
    endCountryCode: params.endCountryCode,
    products: params.products,
  };
  return cjFetch<CjFreightOption[]>("/logistic/freightCalculate", {
    method: "POST",
    body: JSON.stringify(body),
  }, token);
}
