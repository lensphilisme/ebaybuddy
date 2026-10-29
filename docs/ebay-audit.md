# eBay / CJ backend audit — completed 2026-10-28

## What was wrong

### 1. CJ API key "verified" but never worked (root cause, fixed)
`writeRuntime()` in `src/lib/integration-runtime.server.ts` was update-only.
On a first connection there is no `integration_runtime` row, so the update
affected zero rows and the session / API key was silently lost — while
Settings still reported "CJ API key verified and connected". The next CJ
call then failed with "Add your CJ API key", which looked like an invalid
key / invalid token problem.

Fix:
- `writeRuntime()` now upserts, and `withIntegrationLock()` creates the
  lock row idempotently before claiming it.
- `saveCjApiKey` stores the API key in the `integration_credentials` row
  as a durable second copy (never returned to the client).
- CJ is API-key-only: the user pastes only the API key from
  CJ → My CJ → Authorization → API. A JWT-shaped pasted value is rejected
  with a clear "that looks like an access token" message. The old
  `CJ_ACCESS_TOKEN` env fallback and the stale-access-token shortcut were
  removed — a token with no API key behind it cannot be renewed.
- CJ tokens live ~180 days and can be revoked mid-life (code 1600001).
  CJ server functions now retry once after a forced API-key exchange
  (`refreshUserCjToken`), so the user does not have to re-paste anything.

### 2. Legacy eBay Trading API (SOAP/XML) — removed
Only one file used it: `src/lib/ebay/legacy.server.ts`
(`GetMyeBaySelling`, `ReviseFixedPriceItem`, `EndFixedPriceItem` against
`https://api.ebay.com/ws/api.dll`).

Modern replacements, same exported names so callers did not break:
- Active listings → `GET /sell/inventory/v1/offer` (published offers)
  joined to `GET /sell/inventory/v1/inventory_item/{sku}` (title/images),
  in `src/lib/ebay/listings.server.ts`. `legacy.server.ts` is now only a
  re-export shim.
- Revise title → `PUT /sell/inventory/v1/inventory_item/{sku}` (merged
  with the existing item). This needs the SKU, so the optimizer now
  passes the stored `sku`.
- End listing → `POST /sell/inventory/v1/offer/{offerId}/withdraw`.
  This needs the offer ID, so sync now stores `ebay_offer_id` and the
  optimizer passes it.

Documented loss: the Inventory API does not expose quantitySold or
watchCount. Sync no longer overwrites stored sales/views with 0 — those
fields are preserved.

### 3. Already modern (verified, not re-written)
- Inventory publish: `PUT inventory_item`, `POST offer`, `POST offer/{id}/publish`,
  location and Business Policies lookups — already REST.
- Taxonomy: category suggestions and `get_item_aspects_for_category` — already REST,
  now routed through `EbayRestClient` for typed errors and correlation IDs.
- Fulfillment orders / payment disputes — already REST (`EbayOrderService`).
- Marketing campaigns — already REST, including `DYNAMIC` (auto ad-rate) strategy.
- Aspect normalization — already in `inventory.server.ts`
  (`filterAspectsByCategory` against the Taxonomy aspect catalog).

## Phase 1 — resilience (already present, now completed)
- `src/lib/ebay/http.ts`: typed errors (`EbayAuthError`, `EbayRateLimitError`,
  `EbayValidationError`, `EbayUnavailableError`), structured JSON logs with
  `correlationId`, endpoint, duration, status and `x-ebay-c-request-id`,
  sanitized URLs (secrets are never logged), exponential backoff with
  `Retry-After`, a per-host circuit breaker, and per-marketplace pacing.
- OAuth: `getFreshEbayToken` refreshes before expiry under
  `withIntegrationLock` + `singleFlight`, so concurrent requests share one
  refresh instead of racing. OAuth failures now throw classified errors
  instead of generic `Error`.
- New scope: `sell.notification` was added to the OAuth consent list.
  Accounts connected before this change must reconnect once to grant it.

## Phase 2 — new services
- `src/lib/ebay/metadata.server.ts`: condition policies and return
  policies via `sell/metadata` (not `GeteBayDetails`).
- `src/lib/ebay/orders.server.ts`: `EbayReturnService` (Post-Order Return
  API search / get) and a manual-only `createShippingFulfillment`.
- `src/lib/ebay/notifications.server.ts`: `EbayNotificationService`
  (topics, subscriptions, delete), `ebayGraphQL` for the federated
  gateway at `https://graphqlapi.ebay.com/graphql` (caller supplies the
  query document — no invented schema is hardcoded), and
  `handleEbayNotification` / `classifyNotification` for the receiver.
- `src/lib/ebay/contracts.ts`: TypeScript types for Taxonomy, Inventory,
  Offer, Order, Dispute, Return, Campaign, Notification and GraphQL
  payloads, plus the offer→listing mapping used by sync.

## Phase 3 — notifications, and what is NOT done automatically
- Server functions were added in `src/lib/ebay.functions.ts` for orders,
  disputes, returns, notification topics/subscriptions and campaigns.
  Creating a subscription requires a webhook destination:
  set `EBAY_NOTIFICATION_DESTINATION_ID`, or pass `destinationId`.
  Without one it throws a clear error instead of silently failing.
- The receiver handler dedupes on `ebay_notification_receipts`
  (existing table, no schema change) and logs `MARKETPLACE_CHECKOUT_ORDER_CLOSED`,
  `ITEM_SOLD` and `RETURN_CREATED` to `activity_logs`.
- **Tracking is NOT sent to eBay by this app, on purpose.** CJ owns
  tracking. `createShippingFulfillment` exists for a future explicit
  manual action only and is not wired to any automatic flow, UI button
  or CJ order flow.
- No database models were changed. All changes are code-only, so there
  are no migrations to run.

## Still manual / to verify in Sandbox or Production
1. Reconnect eBay once (new `sell.notification` scope) and reconnect CJ
   once with the API key only — old stored CJ tokens will no longer work
   without an API key behind them.
2. Create the eBay webhook destination for your deployed public URL,
   set `EBAY_NOTIFICATION_DESTINATION_ID`, then create subscriptions for
   the three topics above and send a test notification.
3. Verify the GraphQL return query against Sandbox before relying on it:
   the gateway client is ready, but no return query is hardcoded because
   eBay's federated schema is account/scope dependent.
4. Externally-created listings (created outside this app, e.g. in eBay
   itself) now sync via published offers, but they have no CJ product
   link — they will show in Listings, not in CJ product flows. That is
   the Inventory API limit, not a bug in sync.

## Tests
- `bun test src/lib/ebay/http.test.ts src/lib/ebay/listings.test.ts src/lib/cj-auth.test.ts`
  — 12 tests pass, using mock fixtures in `src/lib/ebay/__fixtures__/`.
  No test hits a live eBay or CJ endpoint.
