import { classifyEbayError, ebayFetch } from "./http";

export class EbayRestClient {
  constructor(private token: string, private marketplace = "EBAY_US") {}
  async response(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    headers.set("Content-Type", "application/json");
    headers.set("Content-Language", "en-US");
    headers.set("Accept-Language", "en-US");
    headers.set("X-EBAY-C-MARKETPLACE-ID", this.marketplace);
    const res = await ebayFetch(`https://api.ebay.com${path}`, { ...init, headers });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      const detail = json.errors?.[0]?.message || "eBay request failed";
      const message = res.status === 403 ? "Reconnect eBay in Settings to grant access, or check seller eligibility." : detail;
      throw classifyEbayError(res.status, message, res.headers.get("x-ebay-c-request-id") || undefined);
    }
    return res;
  }
  async json<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.response(path, init);
    if (response.status === 204) return {} as T;
    return response.json() as Promise<T>;
  }
}