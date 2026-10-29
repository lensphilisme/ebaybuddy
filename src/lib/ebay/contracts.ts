export type Money = { value: string; currency: string };
export type Page<T> = { total: number; limit?: number; offset?: number; next?: string } & T;
export type Order = {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: string;
  orderPaymentStatus: string;
  pricingSummary?: { total?: Money };
  lineItems: {
    lineItemId: string;
    legacyItemId?: string;
    sku?: string;
    title: string;
    quantity: number;
    lineItemCost?: Money;
  }[];
};
export type Dispute = {
  paymentDisputeId: string;
  paymentDisputeStatus: string;
  reason?: string;
  amount?: Money;
  orderId?: string;
  respondByDate?: string;
};
export type Campaign = {
  campaignId: string;
  campaignName: string;
  campaignStatus: string;
  marketplaceId: string;
  fundingStrategy?: { fundingModel: string; adRateStrategy?: string; bidPercentage?: string };
};
export type CampaignInput = {
  name: string;
  strategy: "FIXED" | "DYNAMIC";
  rate: number;
  listingIds: string[];
};
export type Topic = {
  topicId: string;
  status: string;
  description?: string;
  scope?: string;
  authorizationScopes?: string[];
  supportedPayloads?: {
    schemaVersion: string;
    deliveryProtocol: string;
    format: string[];
    deprecated?: boolean;
  }[];
};
export type NotificationEnvelope = {
  metadata: { topic: string; schemaVersion?: string };
  notification: {
    notificationId: string;
    subscriptionId?: string;
    eventDate?: string;
    data?: Record<string, unknown>;
  };
};
export type NotificationSubscription = {
  subscriptionId: string;
  topicId: string;
  destinationId: string;
  status?: string;
};
export type InventoryRecord = {
  sku: string;
  product?: {
    title?: string;
    description?: string;
    imageUrls?: string[];
    aspects?: Record<string, string[]>;
  };
  availability?: { shipToLocationAvailability?: { quantity: number } };
  condition?: string;
  [key: string]: unknown;
};
export type OfferRecord = {
  offerId: string;
  sku: string;
  marketplaceId: string;
  status?: string;
  listing?: { listingId?: string; listingStartDate?: string };
  listingStartDate?: string;
  pricingSummary?: { price?: Money };
  availableQuantity?: number;
  [key: string]: unknown;
};

/** Shape the local ebay_listings table expects from a sync, with the fields the modern APIs cannot supply marked optional. */
export type EbayActiveListing = {
  itemId: string;
  offerId?: string;
  title: string;
  sku: string;
  price: number;
  currency: string;
  quantity: number;
  quantitySold?: number;
  watchCount?: number;
  imageUrl?: string;
  listedAt?: string;
  url: string;
};

/** Join a published Inventory offer to its inventory item (title/images live on the item, price/status on the offer). */
export function mapOfferToActiveListing(
  offer: OfferRecord,
  item?: InventoryRecord | null,
): EbayActiveListing | null {
  const listingId = offer.listing?.listingId;
  if (!listingId) return null;
  const price = offer.pricingSummary?.price;
  return {
    itemId: listingId,
    offerId: offer.offerId,
    title: item?.product?.title || offer.sku,
    sku: offer.sku,
    price: Number(price?.value || 0),
    currency: price?.currency || "USD",
    quantity:
      offer.availableQuantity ?? item?.availability?.shipToLocationAvailability?.quantity ?? 0,
    // Modern Inventory API does not expose quantitySold or watchCount.
    // Callers must preserve the stored values instead of overwriting with 0.
    imageUrl: item?.product?.imageUrls?.[0],
    listedAt: offer.listing?.listingStartDate || offer.listingStartDate,
    url: `https://www.ebay.com/itm/${listingId}`,
  };
}

export type CategorySuggestion = { categoryId: string; categoryName: string; path: string };
export type AspectSpec = {
  required: boolean;
  allowed?: string[];
  maxLen?: number;
  applicableTo?: string[];
  usage?: string;
  cardinality?: string;
};
export type CategoryTreeNode = { categoryId: string; path: string; leaf: boolean };

export type ConditionPolicy = {
  categoryId: string;
  itemConditions?: { conditionId: string; conditionDescription: string }[];
};
export type ReturnPolicy = {
  categoryId: string;
  returnPolicies?: { returnPolicyId?: string; name?: string; [key: string]: unknown }[];
};

export type ShippingFulfillmentInput = {
  lineItems: { lineItemId: string; quantity: number }[];
  shippedDate: string;
  shippingCarrierCode: string;
  trackingNumber: string;
};
/**
 * Fulfillment API payload builder. This is deliberately NOT wired to any
 * automatic flow: CJ owns tracking, so this app must not send tracking to
 * eBay on CJ's behalf. It exists only for a future explicit, manual action.
 */
export function shippingFulfillmentPayload(input: ShippingFulfillmentInput) {
  return {
    lineItems: input.lineItems.map((l) => ({ lineItemId: l.lineItemId, quantity: l.quantity })),
    shippedDate: input.shippedDate,
    shippingCarrierCode: input.shippingCarrierCode,
    trackingNumber: input.trackingNumber,
  };
}

export type ReturnRecord = {
  returnId: string;
  returnStatus?: string;
  creationDate?: string;
  orderId?: string;
  buyerUsername?: string;
  returnItems?: { itemId?: string; returnQuantity?: number; returnReason?: string }[];
};
export type GraphQLResponse<T = Record<string, unknown>> = {
  data?: T;
  errors?: { message: string }[];
};

/** Topics this app can subscribe to. MARKETPLACE_CHECKOUT_ORDER_CLOSED is the order-created signal; ITEM_SOLD covers a sale. */
export const EBAY_NOTIFICATION_TOPICS = [
  "MARKETPLACE_CHECKOUT_ORDER_CLOSED",
  "ITEM_SOLD",
  "RETURN_CREATED",
] as const;
