# Remaining integration work

- [x] CJ API-key validation, per-user token lifecycle, settings and tests. — Fixed 2026-10-28: runtime upsert bug, API-key-only flow, JWT-token detection, forced-refresh retry. See docs/ebay-audit.md.
- [x] Audit and modularize eBay clients, OAuth, logging, pacing and tests. — Trading API removed; clients in src/lib/ebay/ via EbayRestClient; OAuth mutex refresh; typed errors; 12 bun tests pass.
- [x] Modern orders, payment disputes, metadata and marketing views/actions. — Server functions in src/lib/ebay.functions.ts: listEbayOrders, listEbayDisputes, listEbayReturns, listEbayCampaigns, createEbayCampaign (DYNAMIC = auto ad-rate). No UI pages for these yet.
- [x] Verified notification receiver and configuration; reflect provider capability limits. — Service + deduping handler in src/lib/ebay/notifications.server.ts; subscription requires EBAY_NOTIFICATION_DESTINATION_ID. Live destination + test notification still to verify manually.
- [x] Preserve access to externally-created listings; document unavailable API replacements. — Sync via published Inventory offers; quantitySold/watchCount are not exposed by Inventory API, so stored sales/views are preserved. See docs/ebay-audit.md.
- [ ] Verify authenticated flows, route metadata, automated tests and app errors. — Partially done (12 tests, no live calls). Still to verify in Sandbox/Production: eBay reconnect (new sell.notification scope), CJ reconnect with API key only, webhook destination + test notification, GraphQL return query.

## Deliberately not automatic
- Tracking is NOT sent to eBay by this app. CJ owns tracking. `createShippingFulfillment` is manual-only and not wired to any flow.
