// Server-only CJ Dropshipping Open API client.
// Docs: https://developers.cjdropshipping.com/en/api/
import { resolveUserCjToken } from "./cj-auth.server";
import { parseMoney } from "./pricing";
import { originCountryForVariant, type CjInventory } from "./cj-inventory";

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

type CjEnvelope<T> = { code: number; result?: boolean; success?: boolean; message: string; data: T };

/** CJ 1600001/1600002: token invalid or expired. Callers retry once after a forced API-key exchange. */
export class CjTokenExpiredError extends Error {
  constructor(message = "Your CJ connection expired or was revoked.") {
    super(message);
    this.name = "CjTokenExpiredError";
  }
}
export function isCjTokenError(error: unknown): boolean {
  return error instanceof CjTokenExpiredError || /1600001|1600002|access token.*(invalid|expired)/i.test(error instanceof Error ? error.message : String(error));
}

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
    if (/1600001|1600002|access token/i.test(`${json.code} ${json.message}`)) throw new CjTokenExpiredError("Your CJ access token expired or was revoked. It will be renewed from your saved API key.");
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

type CjListV2Product = {
  id?: string;
  nameEn?: string;
  sku?: string;
  bigImage?: string;
  sellPrice?: number | string;
  categoryId?: string;
  threeCategoryName?: string;
  listedNum?: number;
  supplierName?: string;
};

type CjListV2Response = {
  pageSize?: number;
  pageNumber?: number;
  totalRecords?: number;
  totalPages?: number;
  content?: { productList?: CjListV2Product[] }[];
};

/**
 * CJ Product List V2 (elasticsearch-backed). The v1 /product/list endpoint
 * is deprecated — it receives no further enhancements and its countryCode
 * filter was silently ignored. V2's response shape differs from v1:
 * data.content[].productList[] with `id`/`nameEn`/`bigImage` instead of
 * `pid`/`productNameEn`/`productImage`, so map it back to CjListItem.
 */
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
  q.set("page", String(Math.max(1, Math.min(params.pageNum ?? 1, 1000))));
  q.set("size", String(Math.max(1, Math.min(params.pageSize ?? 20, 100))));
  if (params.keyword) q.set("keyWord", params.keyword);
  if (params.categoryId) q.set("categoryId", params.categoryId);
  if (params.countryCode) q.set("countryCode", params.countryCode);
  if (params.minPrice != null) q.set("startSellPrice", String(params.minPrice));
  if (params.maxPrice != null) q.set("endSellPrice", String(params.maxPrice));
  // enable_category returns threeCategoryName so the grid can show categories.
  q.set("features", "enable_category");
  const data = await cjFetch<CjListV2Response>(`/product/listV2?${q}`, {}, token);
  const list: CjListItem[] = (data.content || []).flatMap((c) => c.productList || []).map((p) => ({
    pid: String(p.id || ""),
    productNameEn: p.nameEn || "",
    productSku: p.sku || "",
    productImage: p.bigImage || "",
    // CJ returns sellPrice as a number, a numeric string, or a string with
    // a currency symbol — parse defensively so the grid never shows $NaN.
    sellPrice: parseMoney(p.sellPrice),
    categoryId: p.categoryId,
    categoryName: p.threeCategoryName,
    listedNum: p.listedNum,
    supplierName: p.supplierName,
  })).filter((p) => p.pid);
  return {
    pageNum: data.pageNumber ?? params.pageNum ?? 1,
    pageSize: data.pageSize ?? params.pageSize ?? 20,
    total: data.totalRecords ?? list.length,
    list,
  };
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
  // CJ sometimes returns a brand on the detail object; draft creation
  // uses it for the eBay Brand specific (falls back to "Unbranded").
  brand?: string;
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

/**
 * CJ "Query Inventory by Product ID" (GET /product/stock/getInventoryByPid):
 * which warehouse countries hold stock for this product, per variant.
 * The freight quote must start from one of those countries.
 */
export async function cjGetInventoryByPid(pid: string, token?: string): Promise<CjInventory> {
  return cjFetch<CjInventory>(`/product/stock/getInventoryByPid?pid=${encodeURIComponent(pid)}`, {}, token);
}

/**
 * The warehouse country a freight quote must start from for this variant.
 * Never throws — a failed lookup falls back to CN (the old behaviour) so
 * the quote itself still runs instead of failing on the inventory call.
 */
export async function cjOriginForVariant(pid: string, vid: string | undefined, destCountryCode: string, token?: string): Promise<string> {
  try {
    const inventory = await cjGetInventoryByPid(pid, token);
    return originCountryForVariant(inventory, vid, destCountryCode);
  } catch {
    return "CN";
  }
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
