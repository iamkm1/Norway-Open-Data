import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { HttpClient } from "../../src/core/client.js";
import type { ProviderDescriptor } from "../../src/core/provider.js";
import { RateLimiter } from "../../src/core/rate-limit.js";
import { jsonResponse, resolvedConfig } from "./helpers.js";

/** A controllable clock plus a sleep that advances it, for deterministic windows. */
function fakeClock(): {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  slept: number[];
} {
  let current = 0;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number, signal?: AbortSignal) => {
      if (signal?.aborted === true) throw new DOMException("Aborted", "AbortError");
      slept.push(ms);
      current += ms;
      await Promise.resolve();
    },
    slept,
  };
}

describe("RateLimiter", () => {
  it("admits a full window immediately and then waits for the oldest request to age out", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requests: 3, intervalMs: 1_000 }, clock.now, clock.sleep);

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();
    expect(clock.slept).toEqual([]);
    expect(limiter.available()).toBe(0);

    await limiter.acquire();
    expect(clock.slept).toEqual([1_000]);
  });

  it("keeps concurrent callers inside the budget instead of all seeing the same free slot", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requests: 2, intervalMs: 1_000 }, clock.now, clock.sleep);

    await Promise.all([limiter.acquire(), limiter.acquire(), limiter.acquire()]);

    // Two were admitted at once; the third had to wait a full window.
    expect(clock.slept).toEqual([1_000]);
  });

  it("frees capacity again once the window slides past earlier requests", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requests: 2, intervalMs: 1_000 }, clock.now, clock.sleep);

    await limiter.acquire();
    await limiter.acquire();
    expect(limiter.available()).toBe(0);

    await clock.sleep(1_000);
    expect(limiter.available()).toBe(2);
    await limiter.acquire();
    expect(clock.slept).toEqual([1_000]);
  });

  it("rejects a caller queued behind a waiting one as soon as it cancels", async () => {
    // Real timers: the caller ahead stays parked for a full window, so a queued
    // caller that cancels must not have to wait for it.
    const limiter = new RateLimiter({ requests: 1, intervalMs: 10_000 });
    const controller = new AbortController();

    await limiter.acquire();
    const ahead = limiter.acquire(); // parks for ~10s behind the consumed slot
    const queued = limiter.acquire(controller.signal); // stuck behind `ahead`

    controller.abort();
    const started = Date.now();
    await expect(queued).rejects.toThrow(/abort/i);

    expect(Date.now() - started).toBeLessThan(500);
    void ahead.catch(() => undefined);
  });

  it("rejects a waiting caller that cancels, and releases the queue for the next one", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ requests: 1, intervalMs: 1_000 }, clock.now, clock.sleep);
    const controller = new AbortController();
    controller.abort();

    await limiter.acquire();
    await expect(limiter.acquire(controller.signal)).rejects.toThrow(/abort/i);

    // The failed acquisition must not leave the admission queue held.
    await expect(limiter.acquire()).resolves.toBeUndefined();
  });
});

describe("provider request budgets", () => {
  const budgeted = {
    id: "budgeted",
    name: "Budgeted provider",
    homepage: "https://example.test/",
    documentation: "https://example.test/docs",
    access: "open",
    authentication: "None.",
    rateLimit: {
      default: {
        requests: 1,
        intervalMs: 80,
        basis: "sdk-courtesy",
        note: "Test budget.",
      },
      bulk: {
        requests: 10,
        intervalMs: 80,
        basis: "sdk-courtesy",
        note: "A looser budget for a separate service on the same provider.",
      },
    },
    cacheTtlMs: { default: 60_000 },
  } as const satisfies ProviderDescriptor;

  const schema = z.object({ ok: z.boolean() });

  it("spaces requests to a provider that declares a budget", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));

    const started = Date.now();
    await client.request({ provider: budgeted, url: "https://example.test/a", schema });
    await client.request({ provider: budgeted, url: "https://example.test/b", schema });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeGreaterThanOrEqual(60);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not delay a provider that declares no budget", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));
    const unlimited = { ...budgeted, rateLimit: undefined };

    const started = Date.now();
    await client.request({ provider: unlimited, url: "https://example.test/a", schema });
    await client.request({ provider: unlimited, url: "https://example.test/b", schema });

    expect(Date.now() - started).toBeLessThan(60);
  });

  it("skips the budget entirely when rate limiting is disabled", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: false } }));

    const started = Date.now();
    await client.request({ provider: budgeted, url: "https://example.test/a", schema });
    await client.request({ provider: budgeted, url: "https://example.test/b", schema });

    expect(Date.now() - started).toBeLessThan(60);
  });

  it("keeps a named budget separate from the provider's default", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));

    // The default budget allows one request per window; `bulk` allows ten. Using
    // the default once must not consume any of the bulk allowance.
    await client.request({ provider: budgeted, url: "https://example.test/a", schema });
    const started = Date.now();
    await client.request({
      provider: budgeted,
      url: "https://example.test/b",
      rateLimitKey: "bulk",
      schema,
    });

    expect(Date.now() - started).toBeLessThan(60);
  });

  it("falls back to the default budget for an unknown budget name", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));
    const request = {
      provider: budgeted,
      url: "https://example.test/a",
      rateLimitKey: "does-not-exist",
      schema,
    };

    const started = Date.now();
    await client.request(request);
    await client.request({ ...request, url: "https://example.test/b" });

    expect(Date.now() - started).toBeGreaterThanOrEqual(60);
  });

  it("serves a cached response without consuming budget", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true })) as typeof globalThis.fetch;
    const client = new HttpClient(
      resolvedConfig(fetch, {
        rateLimit: { enabled: true },
        cache: { enabled: true, maxEntries: 10 },
      }),
    );
    const request = {
      provider: budgeted,
      url: "https://example.test/a",
      schema,
      cacheTtlMs: 60_000,
    };

    await client.request(request);
    const started = Date.now();
    await expect(client.request(request)).resolves.toMatchObject({ cached: true });

    expect(Date.now() - started).toBeLessThan(60);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
