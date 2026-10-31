# Remaining integration work

- [x] CJ API-key validation, per-user token lifecycle, settings and tests. — Fixed 2026-10-28: runtime upsert bug, API-key-only flow, JWT-token detection, forced-refresh retry. See docs/ebay-audit.md.
- [x] Audit and modularize eBay clients, OAuth, logging, pacing and tests. — Trading API removed; clients in src/lib/ebay/ via EbayRestClient; OAuth mutex refresh; typed errors; 12 bun tests pass.
- [ ] Modern orders, disputes and marketing pages with pagination and explicit error states.
- [ ] Correct notification endpoints, subscription payload and verified receiver; do not claim unsupported topics work.
- [ ] Fix optimizer false-success, listing sync pagination, thumbnails and CJ workspace renewal.
- [x] Preserve access to externally-created listings; document unavailable API replacements. — Sync via published Inventory offers; quantitySold/watchCount are not exposed by Inventory API, so stored sales/views are preserved. See docs/ebay-audit.md.
- [ ] Verify authenticated flows, route metadata, automated tests and app errors; document provider or credential blockers accurately.

## Deliberately not automatic
- Tracking is NOT sent to eBay by this app. CJ owns tracking. `createShippingFulfillment` is manual-only and not wired to any flow.
