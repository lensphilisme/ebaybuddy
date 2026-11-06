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

## Current verification and corrections (2026-11-04)

- Orders/disputes and promoted-campaign pages now exist with pagination, loading and reconnect errors. Paid campaign creation remains an explicit user action.
- Corrected Notification API paths to `/commerce/notification/v1`; removed the invalid `sell.notification` OAuth scope. Subscription payloads use the topic's returned supported version. Requested topic names are not assumed to be available.
- Added `/api/public/ebay/notifications` with challenge handling and eBay public-key signature verification. Unsigned requests return 401. Receipts are serialized and owned activity logs are checked before marking processed. No guessed stock changes or tracking writes are performed.
- Fixed mixed published/unpublished offer pagination, thumbnail persistence and optimizer false-success. Stale traffic cannot trigger destructive optimizer changes.
- CJ workspace forced renewal uses the workspace key; token-only per-user sessions are rejected.
- Twenty local regression tests cover these rules. The app's latest build is clean.
- Authenticated live checks found eBay refresh credentials invalid for the configured developer application; reconnect is necessary before orders, campaigns, listing sync or live optimizer execution can be verified.
- Settings currently reports CJ disconnected for the tested account. A valid API-key connection is required to verify research/freight.
- Ordinary returns are linked to eBay Seller Hub rather than calling legacy Post-Order APIs or inventing a GraphQL returns schema.
- Inventory offers do **not** guarantee access to externally-created listings. Preserved local records remain available, but modern remote management requires Inventory ownership.

## Nov 6, 2026 — full re-audit + bring-your-own AI provider

- Re-audited every eBay call site. Everything uses modern REST (`api.ebay.com`:
  Inventory, Fulfillment, Account, Marketing, Taxonomy, Metadata,
  Commerce Notification) or the GraphQL gateway (`graphqlapi.ebay.com`).
  No SOAP / Trading API / `ws/api.dll` call remains anywhere.
- Fixed: the OAuth consent list was MISSING `sell.notification` (an earlier
  note claimed the scope was invalid — it is a real eBay scope and the
  Notification API needs it) and `sell.fulfillment` (write). Without them,
  notification subscriptions and returns/shipping-fulfillment calls 403.
  Accounts connected before Nov 6, 2026 must reconnect once.
- CORRECTION (same day, after checking the live developer dashboard):
  `sell.notification` is NOT the right scope for the Commerce Notification
  API — eBay's own docs say the required scope is
  `commerce.notification.subscription`, and requesting an invalid scope
  makes eBay reject the whole OAuth consent with `invalid_scope`. The
  consent list now requests `commerce.notification.subscription` instead.
  Dashboard check also found the Production keyset ("AI automation") has
  `sell.inventory.readonly` but NOT `sell.inventory` (write) — publishing,
  revising and ending listings need the write scope, so it must be enabled
  for the Production keyset in the developer dashboard before a live push
  will work.
- Fixed: `EbayReturnService` was a stub that threw. Returns now use the
  modern Post-Order API v2 (`GET /post-order/v2/return/search` and
  `GET /post-order/v2/return/{returnId}`), which is REST, not legacy. It
  authenticates with `IAF {token}` instead of `Bearer`, so `EbayRestClient`
  takes an `authScheme` option; `listEbayReturns` / `getEbayReturn` are
  wired to it.
- Removed dead `getEbayCategoryTreeShallow` (no callers since the AI
  category picker stopped using the tree).
- Listing AI is now bring-your-own-provider: DeepSeek (default,
  `deepseek-v4-flash`, cheapest), Gemini (`gemini-2.5-flash`), OpenAI
  (`gpt-4o-mini`) or any OpenAI-compatible endpoint. The admin adds the
  API key in Settings → Listing AI; the key is validated live, stored
  server-side only (never returned to the client), and used for title
  rewrites, item specifics, draft repair, category re-ranking and
  optimizer title rewrites. No provider configured = local rules, exactly
  as before. Env fallback: `AI_PROVIDER` / `AI_API_KEY` / `AI_MODEL` /
  `AI_BASE_URL` (see `.env.example`).

## Historical notes below — not completion claims

## Still manual / to verify in Sandbox or Production
1. Reconnect eBay once (new `sell.notification` + `sell.fulfillment` scopes) and reconnect CJ
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
- `bun test` — 32 tests pass (Nov 6, 2026), using mock fixtures in `src/lib/ebay/__fixtures__/` and mocked fetch for the AI providers.
  No test hits a live eBay, CJ or AI endpoint.
