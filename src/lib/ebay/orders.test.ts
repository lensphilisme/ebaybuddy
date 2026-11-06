// @ts-nocheck -- run with `bun test`
import { describe, expect, test, beforeEach } from "bun:test";
import { EbayRestClient } from "./rest.server";
import { EbayOrderService } from "./orders.server";
import { __resetBreakers } from "./http";

const realFetch = globalThis.fetch;
beforeEach(() => { __resetBreakers(); globalThis.fetch = realFetch; });

describe("payment disputes (bug 22)", () => {
  test("a 404 from payment_dispute_summary is an empty list, not an error", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ errorId: 1234, message: "Not Found" }] }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as any;
    const service = new EbayOrderService(new EbayRestClient("test-token"));
    const page = await service.disputes(0);
    expect(page.paymentDisputeSummaries).toEqual([]);
    globalThis.fetch = realFetch;
  });

  test("a real 500 still throws", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ errors: [{ message: "boom" }] }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })) as any;
    const service = new EbayOrderService(new EbayRestClient("test-token"));
    await expect(service.disputes(0)).rejects.toThrow();
    globalThis.fetch = realFetch;
  });
});
