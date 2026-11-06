// Resilient eBay HTTP layer: typed errors, structured sanitized logs,
// exponential-backoff retries, and a simple per-host circuit breaker.

export class EbayError extends Error {
  constructor(message: string, public status?: number, public requestId?: string, public correlationId?: string) {
    super(message);
    this.name = "EbayError";
  }
}
export class EbayAuthError extends EbayError { name = "EbayAuthError"; }
export class EbayRateLimitError extends EbayError { name = "EbayRateLimitError"; }
export class EbayValidationError extends EbayError { name = "EbayValidationError"; }
export class EbayUnavailableError extends EbayError { name = "EbayUnavailableError"; }

export function classifyEbayError(status: number, message: string, requestId?: string, correlationId?: string): EbayError {
  if (status === 401 || status === 403) return new EbayAuthError(message, status, requestId, correlationId);
  if (status === 429) return new EbayRateLimitError(message, status, requestId, correlationId);
  if (status >= 500) return new EbayUnavailableError(message, status, requestId, correlationId);
  if (status >= 400) return new EbayValidationError(message, status, requestId, correlationId);
  return new EbayError(message, status, requestId, correlationId);
}

const SECRET_PARAMS = /(refresh_token|access_token|client_secret|code|token)=([^&\s]+)/gi;
export function sanitizeUrl(url: string) {
  return url.replace(SECRET_PARAMS, "$1=***");
}

/**
 * eBay SKUs must be short and free of characters the Inventory API rejects
 * (spaces, slashes, dots, quotes, …). The sync SKU error was a bad SKU
 * reaching eBay: strip everything but letters, digits, "-" and "_", and
 * cap at 50 chars. An empty result falls back to a deterministic hash of
 * the input so a SKU is never empty.
 */
export function sanitizeSku(raw: unknown): string {
  const cleaned = String(raw ?? "").replace(/[^A-Za-z0-9\-_]/g, "").slice(0, 50);
  if (cleaned) return cleaned;
  const seed = String(raw ?? "sku");
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return `sku-${hash.toString(36)}`;
}

/**
 * Pull eBay's own error text out of a response body for logging.
 * Only the human-readable message/longMessage fields are kept (capped,
 * token-scrubbed) — never raw bodies, which can carry credentials.
 */
export function extractEbayErrorText(bodyText: string): string | undefined {
  if (!bodyText) return undefined;
  try {
    const json = JSON.parse(bodyText);
    const err = Array.isArray(json?.errors) ? json.errors[0] : null;
    const text = [err?.longMessage, err?.message, err?.errorId ? `(${err.errorId})` : ""]
      .filter(Boolean)
      .join(" ")
      .trim();
    if (!text) return undefined;
    return text.replace(SECRET_PARAMS, "$1=***").slice(0, 300);
  } catch {
    // Non-JSON body: keep a short scrubbed snippet, never the whole body.
    return bodyText.replace(SECRET_PARAMS, "$1=***").slice(0, 200) || undefined;
  }
}

export function newCorrelationId() {
  return (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

type Breaker = { failures: number; openUntil: number };
const breakers = new Map<string, Breaker>();
const BREAKER_THRESHOLD = 5;
const BREAKER_COOLDOWN_MS = 30_000;

export function isRetryableStatus(status: number) {
  return status === 429 || status >= 500;
}

export function backoffDelay(attempt: number, retryAfterHeader?: string | null) {
  const ra = Number(retryAfterHeader);
  if (Number.isFinite(ra) && ra > 0) return ra * 1000;
  if (retryAfterHeader) {
    const date = Date.parse(retryAfterHeader);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }
  return Math.min(300 * 2 ** attempt, 5_000) + Math.floor(Math.random() * 100);
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(() => r(), ms));
const queues = new Map<string, Promise<void>>();
async function paced(key: string) {
  const previous = queues.get(key) || Promise.resolve();
  const next = previous.catch(() => undefined).then(() => sleep(100));
  queues.set(key, next);
  await next;
  if (queues.get(key) === next) queues.delete(key);
}

export type EbayFetchOptions = { maxRetries?: number; correlationId?: string };

export async function ebayFetch(input: string | URL | Request, init: RequestInit = {}, opts: EbayFetchOptions = {}): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const host = (() => { try { return new URL(url).host; } catch { return "unknown"; } })();
  const correlationId = opts.correlationId || newCorrelationId();
  const maxRetries = opts.maxRetries ?? 3;
  const breaker = breakers.get(host) || { failures: 0, openUntil: 0 };
  breakers.set(host, breaker);
  if (breaker.openUntil > Date.now()) {
    throw new EbayUnavailableError(`eBay service temporarily unavailable (circuit open for ${host})`, 503, undefined, correlationId);
  }
  const headers = new Headers(init.headers || {});
  headers.set("X-Correlation-Id", correlationId);
  const queueKey = `${host}:${headers.get("X-EBAY-C-MARKETPLACE-ID") || "default"}`;
  let attempt = 0;
  while (true) {
    const started = Date.now();
    let res: Response | null = null;
    let netErr: unknown = null;
    try {
      await paced(queueKey);
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      netErr = e;
    }
    const duration = Date.now() - started;
    const status = res?.status ?? 0;
    const requestId = res?.headers.get("x-ebay-c-request-id") || res?.headers.get("rlogid") || undefined;
    // Log eBay's own error text on failures (read via clone so the caller
    // can still consume the body). Without this, Vercel logs show a bare
    // 400 and the real cause is invisible.
    let ebayError: string | undefined;
    if (res && status >= 400) {
      try {
        ebayError = extractEbayErrorText(await res.clone().text());
      } catch {
        ebayError = undefined;
      }
    }
    console.log(JSON.stringify({
      lvl: status && status < 400 ? "info" : "warn",
      svc: "ebay",
      correlationId,
      method: init.method || "GET",
      url: sanitizeUrl(url),
      status,
      durationMs: duration,
      ebayRequestId: requestId,
      attempt,
      error: netErr ? "network_failure" : undefined,
      ebayError,
    }));
    const retryable = netErr != null || isRetryableStatus(status);
    if (!retryable) {
      breaker.failures = 0;
      if (res) return res;
      throw new EbayUnavailableError("eBay returned no response", 0, undefined, correlationId);
    }
    breaker.failures += 1;
    if (breaker.failures >= BREAKER_THRESHOLD) breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    if (attempt >= maxRetries) {
      if (res) return res;
      throw new EbayUnavailableError("Network error calling eBay", 0, undefined, correlationId);
    }
    await sleep(backoffDelay(attempt, res?.headers.get("retry-after")));
    attempt += 1;
  }
}

// Concurrency guard: ensures only one token refresh per key runs at a time.
const inflight = new Map<string, Promise<any>>();
export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export function __resetBreakers() { breakers.clear(); }
