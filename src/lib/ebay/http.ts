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
  if (Number.isFinite(ra) && ra > 0) return Math.min(ra * 1000, 10_000);
  return Math.min(300 * 2 ** attempt, 5_000) + Math.floor(Math.random() * 100);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
  let attempt = 0;
  while (true) {
    const started = Date.now();
    let res: Response | null = null;
    let netErr: unknown = null;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      netErr = e;
    }
    const duration = Date.now() - started;
    const status = res?.status ?? 0;
    const requestId = res?.headers.get("x-ebay-c-request-id") || res?.headers.get("rlogid") || undefined;
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
      error: netErr ? String(netErr) : undefined,
    }));
    const retryable = netErr != null || isRetryableStatus(status);
    if (!retryable) {
      breaker.failures = 0;
      return res!;
    }
    breaker.failures += 1;
    if (breaker.failures >= BREAKER_THRESHOLD) breaker.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    if (attempt >= maxRetries) {
      if (res) return res;
      throw new EbayUnavailableError(`Network error calling eBay: ${String(netErr)}`, 0, undefined, correlationId);
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
