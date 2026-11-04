# Remaining integration work

- [x] Identify the CJ-to-eBay variant parser file requested by the user: src/lib/ebay/inventory.server.ts.

- [x] CJ API-key validation, per-user token lifecycle, settings and tests. — Fixed 2026-10-28: runtime upsert bug, API-key-only flow, JWT-token detection, forced-refresh retry. See docs/ebay-audit.md.
- [x] Audit and modularize eBay clients, OAuth, logging, pacing and tests. — Trading API removed; clients in src/lib/ebay/ via EbayRestClient; OAuth mutex refresh; typed errors; 12 bun tests pass.
- [x] Modern orders, disputes and marketing pages with pagination and explicit error states.
- [x] Correct notification endpoints, subscription payload and signature-verified receiver; unknown topics do not trigger guessed stock adjustments.
- [x] Fix optimizer false-success, listing sync pagination, thumbnails and CJ workspace renewal.
- [x] Preserve stored records and document Inventory coverage limits: externally-created listings may not be remotely manageable; sales/views stay unchanged.
- [x] Route metadata, twenty regression tests and clean app build; authenticated screens and unsigned webhook rejection verified.
- [ ] Live eBay orders/campaigns/sync/optimizer verification — blocked by invalid existing refresh credentials; seller must reconnect in Settings.
- [ ] Live CJ research/freight verification — tested account is disconnected; requires a valid CJ API key in Settings.
- [ ] Live notification destination/delivery — receiver must first be published and registered with eBay; supported seller topics must be discovered there.

## Deliberately not automatic
- Tracking is NOT sent to eBay by this app. CJ owns tracking. `createShippingFulfillment` is manual-only and not wired to any flow.
