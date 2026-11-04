// @ts-nocheck -- run with bun test
import { describe, test, expect } from "bun:test";
import { generateKeyPairSync, createSign } from "node:crypto";
import { requireLiveOptimizer, requireListingIdentity } from "./optimizer-policy";
import { challengeResponse, verifyNotificationSignature } from "./notification-verification.server";
import { campaignPayload } from "./marketing.server";
import { EbayNotificationService } from "./notifications.server";

describe("modern integration guardrails", () => {
  test("optimizer cannot apply changes without live permission", () => {
    expect(() => requireLiveOptimizer({ live_listing_enabled: false }, "token")).toThrow();
    expect(() => requireLiveOptimizer({ live_listing_enabled: true }, null)).toThrow();
    expect(() => requireLiveOptimizer({ live_listing_enabled: true }, "token")).not.toThrow();
  });
  test("optimizer cannot report success for an unmanaged listing", () => {
    expect(() => requireListingIdentity("123", null)).toThrow();
    expect(() => requireListingIdentity("123", "offer-1")).not.toThrow();
  });
  test("notification verifies a signature and rejects changed data", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const body = JSON.stringify({ notification: { notificationId: "n1" } });
    const signature = createSign("sha1").update(body).sign(privateKey, "base64");
    const header = Buffer.from(JSON.stringify({ kid: "test", signature })).toString("base64");
    const key = publicKey.export({ type: "spki", format: "pem" }).toString();
    expect(verifyNotificationSignature(body, header, key)).toBe(true);
    expect(verifyNotificationSignature(body.replace("n1", "n2"), header, key)).toBe(false);
  });
  test("notification challenge binds to endpoint", () => {
    expect(challengeResponse("fixture-code", "fixture-token", "https://a.example/receiver")).not.toBe(challengeResponse("fixture-code", "fixture-token", "https://b.example/receiver"));
  });
  test("dynamic campaign does not send a fixed bid rate", () => {
    const payload = campaignPayload({ name: "Fixture campaign", strategy: "DYNAMIC", rate: 2, listingIds: ["123"] });
    expect(payload.fundingStrategy.adRateStrategy).toBe("DYNAMIC");
    expect(payload.fundingStrategy.bidPercentage).toBeUndefined();
  });
  test("subscription uses Commerce API and provider schema version", async () => {
    const requests = [];
    const client = { json: async () => ({ status: "ENABLED", supportedPayloads: [{ schemaVersion: "2.0", deliveryProtocol: "HTTPS", format: ["JSON"] }] }), response: async (path, init) => { requests.push({ path, body: JSON.parse(init.body) }); return new Response(null, { status: 201, headers: { location: "https://api.ebay.com/commerce/notification/v1/subscription/sub-1" } }); } };
    const subscription = await new EbayNotificationService(client).createSubscription("TEST_TOPIC", "destination-1");
    expect(requests[0].path).toBe("/commerce/notification/v1/subscription");
    expect(requests[0].body.payload.schemaVersion).toBe("2.0");
    expect(subscription.subscriptionId).toBe("sub-1");
  });
});