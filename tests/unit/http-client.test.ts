import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  NorwayOpenData,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "../../src/index.js";
import { HttpClient } from "../../src/core/client.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("shared HTTP behavior", () => {
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

  it("waits for Retry-After and caps the retry delay at five seconds", async () => {
    vi.useFakeTimers();
    const { fetch, mock } = sequenceFetch(
      jsonResponse({}, 429, { "Retry-After": "10" }),
      jsonResponse(brregCompany),
    );
    const request = new NorwayOpenData({ fetch, retries: 1 }).companies.get("923609016");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(mock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(request).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
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

  it("honors caller cancellation without retrying", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const controller = new AbortController();
    const promise = new NorwayOpenData({
      fetch: fetchMock as typeof globalThis.fetch,
      retries: 2,
    }).companies.get("923609016", { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ provider: "brreg" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
    const fetch = vi.fn(async () => new Response("{", { status: 200 })) as typeof globalThis.fetch;
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).companies.get("923609016"),
    ).rejects.toBeInstanceOf(ResponseValidationError);
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
      credentials: { nve: {} },
    });
    await expect(
      client.request({
        provider: "test",
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
      credentials: { nve: {} },
    });
    const textRequest = {
      provider: "test",
      url: "https://data.example.no/representation",
      headers: { Accept: "text/plain" },
      responseType: "text" as const,
      schema: z.literal("plain representation"),
      cacheTtlMs: 60_000,
    };
    const jsonRequest = {
      provider: "test",
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
