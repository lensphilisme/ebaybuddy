<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- eBay network calls go through src/lib/ebay/http.ts (retries, circuit breaker, sanitized JSON logs, single-flight token refresh) so resilience and tracing live in one place.
- CJ is API-key-only: the user pastes only the API key from CJ → My CJ → Authorization → API. Never ask for, store, or accept a pasted CJ access token; tokens are exchanged and renewed server-side. See docs/ebay-audit.md.
- Do not send tracking to eBay from this app. CJ owns tracking. `createShippingFulfillment` is manual-only and must not be wired to any automatic flow.
- No Trading API (SOAP/XML) calls remain. Listings sync/revise/end use the Inventory API by SKU / offer ID, so sync must store `ebay_offer_id` and preserve sales/views (Inventory does not expose quantitySold/watchCount).
