export function requireLiveOptimizer(rule: { live_listing_enabled?: boolean } | null | undefined, token: string | null) {
  if (!rule?.live_listing_enabled) throw new Error("Enable Live Push in Rules before applying optimizer changes.");
  if (!token) throw new Error("Reconnect eBay in Settings before applying changes.");
}

export function requireListingIdentity(itemId: unknown, resourceId: unknown) {
  if (!itemId || !resourceId) throw new Error("This listing is not managed by eBay Inventory. Re-sync before retrying; externally-created listings may be unavailable.");
}