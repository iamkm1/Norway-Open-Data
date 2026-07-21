/** HTTP statuses safe to retry for public-data reads. */
export const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);

/** Maximum retry delay required by the SDK contract. */
export const MAX_RETRY_DELAY_MS = 5_000;

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

/** Calculates bounded exponential delay with full jitter. */
export function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, MAX_RETRY_DELAY_MS);
  const ceiling = Math.min(250 * 2 ** attempt, MAX_RETRY_DELAY_MS);
  return Math.floor(Math.random() * (ceiling + 1));
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
