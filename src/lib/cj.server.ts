// Server-only CJ Dropshipping Open API client.
// Docs: https://developers.cjdropshipping.com/en/api/

const CJ_BASE = "https://developers.cjdropshipping.com/api2.0/v1";

type CjEnvelope<T> = { code: number; result: boolean; message: string; data: T };

async function cjFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = process.env.CJ_ACCESS_TOKEN;
  if (!token) throw new Error("CJ_ACCESS_TOKEN is not configured");
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
    throw new Error(`CJ non-JSON response (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!json.result) {
    throw new Error(`CJ error ${json.code}: ${json.message}`);
  }
  return json.data;
}

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
}): Promise<CjListResponse> {
  const q = new URLSearchParams();
  q.set("pageNum", String(params.pageNum ?? 1));
  q.set("pageSize", String(params.pageSize ?? 20));
  if (params.keyword) q.set("productNameEn", params.keyword);
  if (params.categoryId) q.set("categoryId", params.categoryId);
  if (params.countryCode) q.set("countryCode", params.countryCode);
  if (params.minPrice != null) q.set("minPrice", String(params.minPrice));
  if (params.maxPrice != null) q.set("maxPrice", String(params.maxPrice));
  return cjFetch<CjListResponse>(`/product/list?${q}`);
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
  variants?: CjVariant[];
  // some endpoints return "variantList" or "productVariants"
  variantList?: CjVariant[];
  productVariants?: CjVariant[];
};

export async function cjProductDetail(pid: string): Promise<CjProductDetail> {
  const q = new URLSearchParams({ pid });
  return cjFetch<CjProductDetail>(`/product/query?${q}`);
}

export type CjFreightOption = {
  logisticName: string;
  logisticPrice: number;
  logisticAging: string; // e.g. "7-15"
  logisticWeight?: number;
  trackInfo?: string;
};

export async function cjFreightCalculate(params: {
  startCountryCode?: string; // default "CN"
  endCountryCode: string; // e.g. "US"
  products: { vid: string; quantity: number }[];
}): Promise<CjFreightOption[]> {
  const body = {
    startCountryCode: params.startCountryCode ?? "CN",
    endCountryCode: params.endCountryCode,
    products: params.products,
  };
  return cjFetch<CjFreightOption[]>("/logistic/freightCalculate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}
