import { EbayRestClient } from "./rest.server";
import type {
  GraphQLResponse,
  NotificationEnvelope,
  NotificationSubscription,
  Page,
  Topic,
} from "./contracts";
import { EBAY_NOTIFICATION_TOPICS } from "./contracts";

export { EBAY_NOTIFICATION_TOPICS };

/**
 * Modern Event Notification API (commerce/notification), replacing legacy
 * platform notifications. Subscriptions need a destination created first
 * in eBay (a webhook endpoint owned by the deployed app); this service
 * does not invent one. Set EBAY_NOTIFICATION_DESTINATION_ID to enable
 * createSubscription, otherwise it throws a clear, actionable error.
 */
export class EbayNotificationService {
  constructor(private client: EbayRestClient) {}
  topics() {
    return this.client.json<Page<{ topics: Topic[] }>>(`/commerce/notification/v1/topic?limit=100`);
  }
  subscriptions() {
    return this.client.json<Page<{ subscriptions: NotificationSubscription[] }>>(
      `/commerce/notification/v1/subscription?limit=100`,
    );
  }
  async createSubscription(
    topicId: string,
    destinationId = process.env.EBAY_NOTIFICATION_DESTINATION_ID,
  ) {
    if (!destinationId) {
      throw new Error(
        "EBAY_NOTIFICATION_DESTINATION_ID is not configured. Create a webhook destination in eBay first, then set its ID — a subscription cannot be created without one.",
      );
    }
    const topic = await this.client.json<Topic>(`/commerce/notification/v1/topic/${encodeURIComponent(topicId)}`);
    const payload = topic.supportedPayloads?.find((item) => !item.deprecated && item.deliveryProtocol === "HTTPS" && item.format.includes("JSON"));
    if (topic.status !== "ENABLED" || !payload) throw new Error("This notification topic is not available for HTTPS/JSON delivery.");
    const response = await this.client.response(`/commerce/notification/v1/subscription`, {
      method: "POST",
      body: JSON.stringify({ topicId, destinationId, status: "ENABLED", payload: { deliveryProtocol: "HTTPS", format: "JSON", schemaVersion: payload.schemaVersion } }),
    });
    const id = response.headers.get("location")?.split("/").pop();
    if (!id) throw new Error("eBay did not return the subscription ID. Refresh subscriptions before retrying.");
    return { subscriptionId: id, topicId, destinationId, status: "ENABLED" } satisfies NotificationSubscription;
  }
  deleteSubscription(subscriptionId: string) {
    return this.client.response(
      `/commerce/notification/v1/subscription/${encodeURIComponent(subscriptionId)}`,
      { method: "DELETE" },
    );
  }
}

/**
 * GraphQL gateway client. Kept separate from EbayRestClient because the
 * gateway host differs (graphqlapi.ebay.com) and RestClient fixes its host
 * to api.ebay.com. Uses the same resilient ebayFetch layer.
 */
export async function ebayGraphQL<T = Record<string, unknown>>(
  accessToken: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  const { ebayFetch, classifyEbayError } = await import("./http");
  const res = await ebayFetch("https://graphqlapi.ebay.com/graphql", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.errors?.length) {
    throw classifyEbayError(
      res.status,
      json.errors?.[0]?.message || "eBay GraphQL request failed",
      res.headers.get("x-ebay-c-request-id") || undefined,
    );
  }
  return json as GraphQLResponse<T>;
}

/**
 * Pure webhook handling, testable without a database.
 * Returns "duplicate" when the notification was already processed, so the
 * receiver can ack eBay without re-applying stock / log side effects.
 * This handler NEVER sends tracking to eBay — CJ owns tracking.
 */
export function classifyNotification(
  envelope: NotificationEnvelope,
  alreadySeen: boolean,
): {
  action: "duplicate" | "order_closed" | "item_sold" | "return_created" | "ignored";
  topic: string;
} {
  const topic = envelope.metadata?.topic || "";
  if (alreadySeen) return { action: "duplicate", topic };
  if (topic === "MARKETPLACE_CHECKOUT_ORDER_CLOSED") return { action: "order_closed", topic };
  if (topic === "ITEM_SOLD") return { action: "item_sold", topic };
  if (topic === "RETURN_CREATED") return { action: "return_created", topic };
  return { action: "ignored", topic };
}

export async function handleEbayNotification(supabase: any, envelope: NotificationEnvelope) {
  const notificationId = envelope.notification?.notificationId;
  if (!notificationId) throw new Error("eBay notification has no notificationId.");
  const subscriptionId = envelope.notification?.subscriptionId;
  if (!subscriptionId) throw new Error("eBay notification has no subscriptionId.");
  const { data: subscription, error: subscriptionError } = await supabase.from("ebay_notification_subscriptions").select("user_id,topic_id").eq("subscription_id", subscriptionId).maybeSingle();
  if (subscriptionError) throw new Error("Subscription lookup failed.");
  if (!subscription || subscription.topic_id !== envelope.metadata.topic) throw new Error("Unknown notification subscription.");
  const { withIntegrationLock } = await import("../integration-runtime.server");
  return withIntegrationLock(`notification:${notificationId}`, async () => {
    const { data: existing, error } = await supabase.from("ebay_notification_receipts").select("processed_at").eq("notification_id", notificationId).maybeSingle();
    if (error) throw new Error("Notification lookup failed.");
    const { action, topic } = classifyNotification(envelope, !!existing?.processed_at);
    if (action === "duplicate") return { action, topic, notificationId };
    const receipt = await supabase.from("ebay_notification_receipts").upsert({ notification_id: notificationId, subscription_id: subscriptionId, status: "processing" });
    if (receipt.error) throw new Error("Could not save notification.");
    const log = await supabase.from("activity_logs").insert({ user_id: subscription.user_id, level: "info", category: "ebay", message: `eBay notification: ${topic}`, metadata: { notificationId, topic, eventDate: envelope.notification?.eventDate || null } });
    if (log.error) throw new Error("Could not record notification.");
    // Never guess stock adjustments from an undocumented payload or send tracking.
    const saved = await supabase.from("ebay_notification_receipts").update({ status: "processed", processed_at: new Date().toISOString() }).eq("notification_id", notificationId);
    if (saved.error) throw new Error("Could not acknowledge notification.");
    return { action, topic, notificationId };
  });
}
