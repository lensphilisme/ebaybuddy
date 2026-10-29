export type Money = { value: string; currency: string };
export type Page<T> = { total: number; limit?: number; offset?: number; next?: string } & T;
export type Order = {
  orderId: string; creationDate: string; orderFulfillmentStatus: string; orderPaymentStatus: string;
  pricingSummary?: { total?: Money }; lineItems: { lineItemId: string; legacyItemId?: string; sku?: string; title: string; quantity: number; lineItemCost?: Money }[];
};
export type Dispute = { paymentDisputeId: string; paymentDisputeStatus: string; reason?: string; amount?: Money; orderId?: string; respondByDate?: string };
export type Campaign = { campaignId: string; campaignName: string; campaignStatus: string; marketplaceId: string; fundingStrategy?: { fundingModel: string; adRateStrategy?: string; bidPercentage?: string } };
export type CampaignInput = { name: string; strategy: "FIXED" | "DYNAMIC"; rate: number; listingIds: string[] };
export type Topic = { topicId: string; status: string; description?: string; scope?: string; authorizationScopes?: string[]; supportedPayloads?: { schemaVersion: string; deliveryProtocol: string; format: string[]; deprecated?: boolean }[] };
export type NotificationEnvelope = { metadata: { topic: string; schemaVersion?: string }; notification: { notificationId: string; subscriptionId?: string; eventDate?: string; data?: Record<string, unknown> } };
export type InventoryRecord = { sku: string; product?: { title?: string; description?: string; imageUrls?: string[]; aspects?: Record<string,string[]> }; availability?: { shipToLocationAvailability?: { quantity: number } }; condition?: string; [key: string]: unknown };
export type OfferRecord = { offerId: string; sku: string; marketplaceId: string; status?: string; listing?: { listingId?: string }; inventoryItemGroupKey?: string; [key: string]: unknown };