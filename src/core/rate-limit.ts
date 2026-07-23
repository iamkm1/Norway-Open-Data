import type { RateLimitPolicy } from "./provider.js";
import { delay } from "./retry.js";

function noop(): void {
  // Placeholder until the admission promise's executor supplies the resolver.
}

/** Mirrors the rejection `delay` uses, so cancellation looks identical either way. */
function abortError(signal: AbortSignal): unknown {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

/**
 * Awaits the caller ahead in the queue, but rejects as soon as this caller
 * cancels.
 *
 * Without this, cancelling a request queued behind a waiting one would not take
 * effect until the request ahead finished -- up to a full window on a provider
 * with a tight budget.
 */
async function waitForTurn(previous: Promise<void>, signal?: AbortSignal): Promise<void> {
  if (signal === undefined) return previous;
  if (signal.aborted) throw abortError(signal);
  let onAbort: (() => void) | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<never>((_resolve, reject) => {
        onAbort = (): void => {
          reject(abortError(signal));
        };
        signal.addEventListener("abort", onAbort, { once: true });
      }),
    ]);
  } finally {
    if (onAbort !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

/**
 * Sliding-window request limiter for one provider.
 *
 * Admission decisions are serialized through a promise chain so concurrent
 * callers cannot all observe the same free slot and overshoot the budget
 * together. Waiting is cancellable and never counts against a request's
 * configured timeout, because the limiter runs before the timeout is armed.
 */
export class RateLimiter {
  readonly #requests: number;
  readonly #intervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  #history: number[] = [];
  #admission: Promise<void> = Promise.resolve();

  constructor(
    policy: Pick<RateLimitPolicy, "requests" | "intervalMs">,
    now: () => number = Date.now,
    sleep: (ms: number, signal?: AbortSignal) => Promise<void> = delay,
  ) {
    this.#requests = policy.requests;
    this.#intervalMs = policy.intervalMs;
    this.#now = now;
    this.#sleep = sleep;
  }

  /**
   * Waits until this provider has budget for one more request, then consumes it.
   *
   * Rejects with the signal's reason if the caller cancels while waiting.
   */
  async acquire(signal?: AbortSignal): Promise<void> {
    const previous = this.#admission;
    // Assigned synchronously by the executor below, before any caller can await.
    let admitted: () => void = noop;
    this.#admission = new Promise<void>((resolve) => {
      admitted = resolve;
    });
    try {
      await waitForTurn(previous, signal);
      for (;;) {
        const now = this.#now();
        this.#history = this.#history.filter((at) => now - at < this.#intervalMs);
        if (this.#history.length < this.#requests) {
          this.#history.push(now);
          return;
        }
        const oldest = this.#history[0] ?? now;
        await this.#sleep(Math.max(this.#intervalMs - (now - oldest), 1), signal);
      }
    } finally {
      admitted();
    }
  }

  /** Requests still available in the current window. Intended for tests. */
  available(): number {
    const now = this.#now();
    const live = this.#history.filter((at) => now - at < this.#intervalMs).length;
    return Math.max(this.#requests - live, 0);
  }
}
