/** HTTP statuses safe to retry for public-data reads. */
export const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Maximum delay the SDK's own computed exponential backoff may reach. */
export const MAX_RETRY_DELAY_MS = 5_000;

/**
 * Longest provider-directed `Retry-After` the SDK will wait out before handing
 * the decision back to the caller.
 *
 * One minute is the longest sliding window any provider budget in the registry
 * is expressed over, so it is the longest pause the SDK's own rate limiter can
 * already impose while staying inside a provider's terms. Waiting that long
 * between attempts is therefore something the SDK is known to do; waiting
 * longer is not. A provider asking for more is asking for more than an
 * automatic retry should silently absorb, so the caller is told, with the
 * requested duration attached, rather than being blocked for an unbounded time
 * or retried sooner than the provider allowed.
 *
 * Deliberately not configurable and not exported from the package root: the SDK
 * exposes no other retry-policy control, and `retryAfter` on the raised error
 * lets a caller implement any longer wait itself.
 */
export const MAX_PROVIDER_DIRECTED_DELAY_MS = 60_000;

/** Parses an HTTP Retry-After header into milliseconds. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const milliseconds = seconds * 1_000;
    return Number.isFinite(milliseconds) ? milliseconds : undefined;
  }
  if (!/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(value)) {
    return undefined;
  }
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/**
 * Calculates the SDK's own bounded exponential delay with full jitter.
 *
 * This applies only when a provider gave no `Retry-After`. A stated delay is
 * never routed through this cap, because shortening it would retry sooner than
 * the provider permitted.
 */
export function retryDelayMs(attempt: number): number {
  const ceiling = Math.min(250 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.floor(Math.random() * (ceiling + 1));
}

/**
 * Decides whether a stated `Retry-After` is short enough to wait out.
 *
 * Returns the exact delay to wait, or `undefined` when the provider asked for
 * longer than {@link MAX_PROVIDER_DIRECTED_DELAY_MS} and the retry must stop
 * instead of resuming early.
 */
export function providerDirectedDelayMs(retryAfterMs: number): number | undefined {
  return retryAfterMs > MAX_PROVIDER_DIRECTED_DELAY_MS ? undefined : retryAfterMs;
}

/** Promise-based delay that respects cancellation. */
export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    return Promise.reject(
      signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"),
    );
  }
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(
        signal?.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError"),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
