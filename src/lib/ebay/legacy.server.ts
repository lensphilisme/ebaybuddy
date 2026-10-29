// Compatibility shim — kept only so existing imports keep working.
// There are NO Trading API (SOAP/XML) calls left in this codebase.
// All three functions below are the modern Inventory API implementations
// in ./listings.server.ts. Revise/end now need the SKU / offer ID that the
// modern API uses; callers pass them from the stored ebay_listings row.
export * from "./listings.server";
export type { EbayActiveListing } from "./contracts";
