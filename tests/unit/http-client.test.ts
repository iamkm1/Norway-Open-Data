import { once } from "node:events";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  NorwayOpenData,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "../../src/index.js";
import { HttpClient } from "../../src/core/client.js";
import { nveProvider } from "../../src/providers/nve/provider.js";
import {
  MAX_PROVIDER_DIRECTED_DELAY_MS,
  MAX_RETRY_DELAY_MS,
  parseRetryAfter,
  providerDirectedDelayMs,
  retryDelayMs,
} from "../../src/core/retry.js";
import { jsonResponse, sequenceFetch, testProvider } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function closeServer(server: Server): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error === undefined ? resolve() : reject(error)));
  });
  server.closeAllConnections();
  await closed;
}

describe("shared HTTP behavior", () => {
  it.each([429, 502, 503, 504])(
    "retries HTTP %i exactly within the configured limit",
    async (status) => {
      vi.spyOn(Math, "random").mockReturnValue(0);
      const { fetch, mock } = sequenceFetch(jsonResponse({}, status), jsonResponse(brregCompany));
      await expect(
        new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016"),
      ).resolves.toBeDefined();
      expect(mock).toHaveBeenCalledTimes(2);
    },
  );

  it.each([400, 401, 403, 404])("does not retry HTTP %i", async (status) => {
    const { fetch, mock } = sequenceFetch(jsonResponse({}, status));
    const request = new NorwayOpenData({ fetch, retries: 3 }).companies.get("923609016");
    if (status === 404) await expect(request).rejects.toBeInstanceOf(NotFoundError);
    else await expect(request).rejects.toBeInstanceOf(ProviderError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("parses only valid numeric and HTTP-date Retry-After values", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    expect(parseRetryAfter("3", now)).toBe(3_000);
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:02 GMT", now)).toBe(2_000);
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:59:59 GMT", now)).toBe(0);
    for (const malformed of ["", " ", "1.5", "+2", "1e3", "9".repeat(400), "tomorrow"]) {
      expect(parseRetryAfter(malformed, now)).toBeUndefined();
    }
    expect(retryDelayMs(100)).toBeLessThanOrEqual(5_000);
  });

  it("honors an HTTP-date Retry-After value", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 503, { "Retry-After": "Thu, 01 Jan 2026 00:00:02 GMT" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("falls back to bounded jitter for malformed Retry-After", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 503, { "Retry-After": "1.5" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016");
    await vi.advanceTimersByTimeAsync(249);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBeDefined();
  });

  it("retries temporary statuses but not malformed successful responses", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 503), jsonResponse(brregCompany));
    await expect(
      new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016"),
    ).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);

    const malformed = sequenceFetch(jsonResponse({ name: "missing required fields" }));
    await expect(
      new NorwayOpenData({ fetch: malformed.fetch, retries: 2 }).companies.get("923609016"),
    ).rejects.toBeInstanceOf(ResponseValidationError);
    expect(malformed.mock).toHaveBeenCalledTimes(1);
  });

  it("honors Retry-After and exposes final rate-limit details", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "0" }),
      jsonResponse({}, 429, { "Retry-After": "3" }),
    );
    let caught: unknown;
    try {
      await new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RateLimitError);
    expect((caught as RateLimitError).retryAfter).toBe(3);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("caps computed backoff at five seconds when the provider states nothing", () => {
    // The cap belongs to the SDK's own exponential backoff. It is not a licence
    // to retry earlier than a provider explicitly permitted.
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(retryDelayMs(attempt)).toBeLessThanOrEqual(MAX_RETRY_DELAY_MS);
    }
  });

  it.each([
    [MAX_PROVIDER_DIRECTED_DELAY_MS - 1, MAX_PROVIDER_DIRECTED_DELAY_MS - 1],
    [MAX_PROVIDER_DIRECTED_DELAY_MS, MAX_PROVIDER_DIRECTED_DELAY_MS],
    [MAX_PROVIDER_DIRECTED_DELAY_MS + 1, undefined],
  ])("treats a directed delay of %ims as %s", (retryAfterMs, expected) => {
    // The ceiling is inclusive: exactly the maximum is still waited out.
    expect(providerDirectedDelayMs(retryAfterMs)).toBe(expected);
  });

  it("throws on an over-limit delay without waiting for the ceiling first", async () => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 429, { "Retry-After": "120" }));
    // No timer advance at all: the over-limit path must terminate immediately
    // rather than sleeping for the ceiling, or falling back to computed backoff.
    const error = await new NorwayOpenData({ fetch, retries: 2 }).companies
      .get("923609016")
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).statusCode).toBe(429);
    expect((error as RateLimitError).retryAfter).toBe(120);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("waits the full Retry-After rather than shortening it to the backoff cap", async () => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "30" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016");

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("stops instead of retrying early when Retry-After exceeds the directed maximum", async () => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "120" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 2 }).companies.get("923609016");
    const caught = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(MAX_PROVIDER_DIRECTED_DELAY_MS * 3);

    const error = await caught;
    expect(error).toBeInstanceOf(RateLimitError);
    // The caller is told how long the provider asked for, rather than the SDK
    // silently retrying sooner than it permitted.
    expect((error as RateLimitError).retryAfter).toBe(120);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("preserves an over-long Retry-After on a non-429 retryable status", async () => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 503, { "Retry-After": "300" }));
    const request = new NorwayOpenData({ fetch, retries: 2 }).companies.get("923609016");
    const caught = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(MAX_PROVIDER_DIRECTED_DELAY_MS * 6);

    const error = await caught;
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).statusCode).toBe(503);
    expect((error as ProviderError).retryAfter).toBe(300);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("cancels a provider-directed wait without ever making the later attempt", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "30" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016", {
      signal: controller.signal,
    });
    const caught = request.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(60_000);

    const error = await caught;
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).message).toMatch(/cancelled/);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not let the per-attempt timeout cut short a provider-directed wait", async () => {
    vi.useFakeTimers();
    // The request timeout bounds one network attempt. A directed wait happens
    // between attempts, so a timeout shorter than it must neither shorten the
    // wait nor be reported as a timeout.
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "30" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1, timeoutMs: 1_000 }).companies.get(
      "923609016",
    );

    await vi.advanceTimersByTimeAsync(29_999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("classifies cancellation, timeout and rate-limit termination distinctly", async () => {
    vi.useFakeTimers();
    // A stalled attempt is a timeout, not a rate-limit or cancellation. The
    // mock rejects on abort exactly as a spec-compliant fetch does.
    const stalled = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as typeof globalThis.fetch;
    const timedOut = new NorwayOpenData({ fetch: stalled, retries: 0, timeoutMs: 1_000 }).companies
      .get("923609016")
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await timedOut).toBeInstanceOf(RequestTimeoutError);

    // An over-long directed delay is a rate-limit termination, not a timeout.
    const { fetch } = sequenceFetch(jsonResponse({}, 429, { "Retry-After": "120" }));
    const limited = new NorwayOpenData({ fetch, retries: 1, timeoutMs: 1_000 }).companies
      .get("923609016")
      .catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(2_000);
    const limitedError = await limited;
    expect(limitedError).toBeInstanceOf(RateLimitError);
    expect(limitedError).not.toBeInstanceOf(RequestTimeoutError);
  });

  it.each([
    [0, 1],
    [1, 2],
    [2, 3],
  ])("makes exactly %i retries -> %i attempts under a directed delay", async (retries, calls) => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(
      ...Array.from(
        { length: calls },
        () => () => Promise.resolve(jsonResponse({}, 429, { "Retry-After": "1" })),
      ),
    );
    const request = new NorwayOpenData({ fetch, retries }).companies.get("923609016");
    const caught = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10_000);

    expect(await caught).toBeInstanceOf(RateLimitError);
    expect(mock).toHaveBeenCalledTimes(calls);
  });

  it("caches successful payloads, expires them, and supports bypass", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const { fetch, mock } = sequenceFetch(
      jsonResponse(brregCompany),
      jsonResponse({ ...brregCompany, navn: "BYPASS RESPONSE" }),
      jsonResponse(brregCompany),
    );
    const companies = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true, ttlMs: 100, maxEntries: 2 },
    }).companies;
    const first = await companies.get("923609016");
    const second = await companies.get("923609016");
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    const bypass = await companies.get("923609016", { bypassCache: true });
    expect(bypass.cached).toBe(false);
    expect(bypass.data.name).toBe("BYPASS RESPONSE");
    expect(mock).toHaveBeenCalledTimes(2);
    const afterBypass = await companies.get("923609016");
    expect(afterBypass.cached).toBe(true);
    expect(afterBypass.data.name).toBe(brregCompany.navn);
    expect(mock).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(101);
    const expired = await companies.get("923609016");
    expect(expired.cached).toBe(false);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("does not cache failed responses", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 500), jsonResponse(brregCompany));
    const companies = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).companies;
    await expect(companies.get("923609016")).rejects.toBeInstanceOf(ProviderError);
    await expect(companies.get("923609016")).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("turns timeout aborts into RequestTimeoutError", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as typeof globalThis.fetch;
    await expect(
      new NorwayOpenData({ fetch, retries: 0, timeoutMs: 5 }).companies.get("923609016"),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("retries temporary network failures and enforces the final attempt limit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const recovered = sequenceFetch(async () => {
      throw new TypeError("fetch failed");
    }, jsonResponse(brregCompany));
    await expect(
      new NorwayOpenData({ fetch: recovered.fetch, retries: 1 }).companies.get("923609016"),
    ).resolves.toBeDefined();
    expect(recovered.mock).toHaveBeenCalledTimes(2);

    const exhausted = sequenceFetch(
      async () => {
        throw new Error("ECONNRESET");
      },
      async () => {
        throw new Error("ECONNRESET");
      },
      async () => {
        throw new Error("ECONNRESET");
      },
    );
    await expect(
      new NorwayOpenData({ fetch: exhausted.fetch, retries: 2 }).companies.get("923609016"),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(exhausted.mock).toHaveBeenCalledTimes(3);
  });

  it("retries a timeout and does not cache the timed-out attempt", async () => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockImplementationOnce(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      )
      .mockImplementationOnce(async () => jsonResponse(brregCompany));
    const companies = new NorwayOpenData({
      fetch: fetch as typeof globalThis.fetch,
      retries: 1,
      timeoutMs: 10,
      cache: { enabled: true },
    }).companies;
    const request = companies.get("923609016");
    await vi.advanceTimersByTimeAsync(10);
    await expect(request).resolves.toBeDefined();
    await expect(companies.get("923609016")).resolves.toMatchObject({ cached: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects pre-aborted requests before cache lookup or fetch", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(brregCompany));
    const companies = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).companies;
    await companies.get("923609016");
    const controller = new AbortController();
    controller.abort();
    await expect(companies.get("923609016", { signal: controller.signal })).rejects.toMatchObject({
      provider: "brreg",
      message: expect.stringMatching(/cancelled/),
    });
    expect(mock).toHaveBeenCalledTimes(1);

    const neverCalled = vi.fn(async () => jsonResponse(brregCompany));
    await expect(
      new NorwayOpenData({ fetch: neverCalled as typeof globalThis.fetch }).companies.get(
        "923609016",
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it("classifies cancellation and timeout while reading a response body", async () => {
    let bodyStarted = (): void => undefined;
    const started = new Promise<void>((resolve) => {
      bodyStarted = resolve;
    });
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          new Promise<unknown>((_resolve, reject) => {
            bodyStarted();
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      } as Response;
    }) as typeof globalThis.fetch;
    const controller = new AbortController();
    const cancelled = new NorwayOpenData({ fetch, retries: 2 }).companies.get("923609016", {
      signal: controller.signal,
    });
    await started;
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({
      provider: "brreg",
      message: expect.stringMatching(/cancelled/),
    });
    expect(fetch).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    const timeoutFetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return {
        ok: true,
        status: 200,
        headers: new Headers(),
        json: async () =>
          new Promise<unknown>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      } as Response;
    }) as typeof globalThis.fetch;
    const timedOut = new NorwayOpenData({
      fetch: timeoutFetch,
      retries: 0,
      timeoutMs: 10,
    }).companies.get("923609016");
    const timeoutAssertion = expect(timedOut).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(10);
    await timeoutAssertion;
  });

  it("maps cancellation during status and network retry delays without extra calls", async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0.999);
    for (const firstAttempt of [
      async () => jsonResponse({}, 503, { "Retry-After": "5" }),
      async () => {
        throw new TypeError("fetch failed");
      },
    ]) {
      const controller = new AbortController();
      const fetch = vi
        .fn()
        .mockImplementationOnce(firstAttempt)
        .mockImplementationOnce(async () => jsonResponse(brregCompany));
      const request = new NorwayOpenData({
        fetch: fetch as typeof globalThis.fetch,
        retries: 1,
        cache: { enabled: true },
      }).companies.get("923609016", { signal: controller.signal });
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(1);
      const rejection = expect(request).rejects.toMatchObject({
        provider: "brreg",
        message: expect.stringMatching(/cancelled/),
      });
      controller.abort();
      await rejection;
      await vi.runAllTimersAsync();
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("refuses cross-origin redirects before forwarding request headers", async () => {
    const apiKey = "redirect-test-api-key";
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://hydapi.nve.no/start");
      expect(init?.redirect).toBe("manual");
      expect(new Headers(init?.headers).get("X-API-Key")).toBe(apiKey);
      return new Response(null, {
        status: 302,
        headers: { Location: "https://attacker.example/collect" },
      });
    }) as typeof globalThis.fetch;
    const client = new HttpClient({
      timeoutMs: 1_000,
      retries: 2,
      fetch,
      cache: { enabled: false, maxEntries: 10 },
      rateLimit: { enabled: false },
      credentials: { nve: { apiKey } },
    });
    await expect(
      client.request({
        provider: nveProvider,
        url: "https://hydapi.nve.no/start",
        headers: { "X-API-Key": apiKey },
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toMatchObject({ provider: "nve", message: expect.stringMatching(/cross-origin/) });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not leak a sensitive header between two real HTTP origins", async () => {
    const apiKey = "redirect-integration-key";
    let targetRequests = 0;
    let targetReceivedSensitiveHeader = false;
    const target = createServer((request, response) => {
      targetRequests += 1;
      targetReceivedSensitiveHeader = request.headers["x-api-key"] !== undefined;
      response.writeHead(204).end();
    });
    const source = createServer((_request, response) => {
      const targetAddress = target.address() as AddressInfo;
      response.writeHead(302, { Location: `http://127.0.0.1:${targetAddress.port}/collect` }).end();
    });
    try {
      target.listen(0, "127.0.0.1");
      source.listen(0, "127.0.0.1");
      await Promise.all([once(target, "listening"), once(source, "listening")]);
      const sourceAddress = source.address() as AddressInfo;
      const client = new HttpClient({
        timeoutMs: 1_000,
        retries: 0,
        fetch: globalThis.fetch,
        cache: { enabled: false, maxEntries: 10 },
        rateLimit: { enabled: false },
        credentials: { nve: { apiKey } },
      });
      await expect(
        client.request({
          provider: nveProvider,
          url: `http://127.0.0.1:${sourceAddress.port}/start`,
          headers: { "X-API-Key": apiKey },
          schema: z.object({ ok: z.boolean() }),
        }),
      ).rejects.toMatchObject({ message: expect.stringMatching(/cross-origin/) });
      expect(targetRequests).toBe(0);
      expect(targetReceivedSensitiveHeader).toBe(false);
    } finally {
      await Promise.all([closeServer(source), closeServer(target)]);
    }
  });

  it("honors caller cancellation without retrying", async () => {
    let calls = 0;
    const controller = new AbortController();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls > 1) return jsonResponse(brregCompany);
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        // Cancel only once the request is genuinely in flight, so this exercises
        // mid-request cancellation rather than a pre-flight rejection.
        controller.abort();
      });
    });
    const companies = new NorwayOpenData({
      fetch: fetchMock as typeof globalThis.fetch,
      retries: 2,
      cache: { enabled: true },
    }).companies;
    await expect(companies.get("923609016", { signal: controller.signal })).rejects.toMatchObject({
      provider: "brreg",
    });
    await expect(companies.get("923609016")).resolves.toMatchObject({ cached: false });
    await expect(companies.get("923609016")).resolves.toMatchObject({ cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry when cancellation occurs before a zero-delay retry", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(async () => {
        controller.abort();
        return jsonResponse({}, 429, { "Retry-After": "0" });
      })
      .mockImplementationOnce(async () => jsonResponse(brregCompany));
    await expect(
      new NorwayOpenData({ fetch: fetchMock as typeof globalThis.fetch, retries: 1 }).companies.get(
        "923609016",
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({ provider: "brreg", message: expect.stringMatching(/cancelled/) });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid JSON bodies as response validation errors", async () => {
    const { fetch, mock } = sequenceFetch(
      new Response("{", { status: 200 }),
      jsonResponse(brregCompany),
    );
    const companies = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).companies;
    await expect(companies.get("923609016")).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(companies.get("923609016")).resolves.toMatchObject({ cached: false });
    await expect(companies.get("923609016")).resolves.toMatchObject({ cached: true });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("supports validated text responses and preserves an explicit Accept header", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Accept")).toBe("text/csv");
      return new Response("name,value\nEUR,11.5", {
        headers: { "Content-Type": "text/csv" },
      });
    }) as typeof globalThis.fetch;
    const client = new HttpClient({
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: false, maxEntries: 10 },
      rateLimit: { enabled: false },
      credentials: {},
    });
    await expect(
      client.request({
        provider: testProvider,
        url: "https://data.example.no/rates",
        headers: { Accept: "text/csv" },
        responseType: "text",
        schema: z.string().startsWith("name,value"),
      }),
    ).resolves.toMatchObject({ data: "name,value\nEUR,11.5", cached: false });
  });

  it("separates cached text and JSON representations of the same URL", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const accept = new Headers(init?.headers).get("Accept");
      return accept === "text/plain"
        ? new Response("plain representation", { headers: { "Content-Type": "text/plain" } })
        : jsonResponse({ representation: "json" });
    }) as typeof globalThis.fetch;
    const client = new HttpClient({
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: true, maxEntries: 10 },
      rateLimit: { enabled: false },
      credentials: {},
    });
    const textRequest = {
      provider: testProvider,
      url: "https://data.example.no/representation",
      headers: { Accept: "text/plain" },
      responseType: "text" as const,
      schema: z.literal("plain representation"),
      cacheTtlMs: 60_000,
    };
    const jsonRequest = {
      provider: testProvider,
      url: "https://data.example.no/representation",
      schema: z.object({ representation: z.literal("json") }),
      cacheTtlMs: 60_000,
    };

    await expect(client.request(textRequest)).resolves.toMatchObject({ cached: false });
    await expect(client.request(jsonRequest)).resolves.toMatchObject({ cached: false });
    await expect(client.request(textRequest)).resolves.toMatchObject({ cached: true });
    await expect(client.request(jsonRequest)).resolves.toMatchObject({ cached: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
