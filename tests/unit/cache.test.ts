import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { MemoryCache, stableCacheKey } from "../../src/core/cache.js";
import { HttpClient } from "../../src/core/client.js";
import type { ResolvedConfig } from "../../src/core/types.js";
import { NorwayOpenData } from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

function httpClient(
  fetch: typeof globalThis.fetch,
  cache = new MemoryCache(20),
  overrides: Partial<ResolvedConfig> = {},
): HttpClient {
  return new HttpClient(
    {
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: true, maxEntries: 20 },
      credentials: { nve: {} },
      ...overrides,
    },
    cache,
  );
}

describe("cache hardening", () => {
  it("uses stable nested ordering while separating different request parameters", async () => {
    expect(stableCacheKey({ z: 1, nested: { b: 2, a: 1 } })).toBe(
      stableCacheKey({ nested: { a: 1, b: 2 }, z: 1 }),
    );
    const { fetch, mock } = sequenceFetch(jsonResponse({ value: 1 }), jsonResponse({ value: 2 }));
    const client = httpClient(fetch);
    const schema = z.object({ value: z.number() });
    const first = await client.request({
      provider: "test",
      url: "https://cache.example.no/items",
      method: "POST",
      query: { b: 2, a: 1 },
      body: { outer: { z: 2, a: 1 } },
      schema,
      cacheTtlMs: 60_000,
    });
    const reordered = await client.request({
      provider: "test",
      url: "https://cache.example.no/items",
      method: "POST",
      query: { a: 1, b: 2 },
      body: { outer: { a: 1, z: 2 } },
      schema,
      cacheTtlMs: 60_000,
    });
    const different = await client.request({
      provider: "test",
      url: "https://cache.example.no/items",
      method: "POST",
      query: { a: 1, b: 3 },
      body: { outer: { a: 1, z: 2 } },
      schema,
      cacheTtlMs: 60_000,
    });

    expect(first).toMatchObject({ cached: false, data: { value: 1 } });
    expect(reordered).toMatchObject({ cached: true, data: { value: 1 } });
    expect(different).toMatchObject({ cached: false, data: { value: 2 } });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("keeps includeRaw envelopes isolated and protects cached data from mutation", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(brregCompany));
    const companies = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).companies;

    const withoutRaw = await companies.get("923609016");
    const withRaw = await companies.get("923609016", { includeRaw: true });
    expect(withoutRaw.raw).toBeUndefined();
    expect(withRaw.cached).toBe(true);
    expect(withRaw.raw).toBeDefined();
    (withRaw.raw as { navn: string }).navn = "MUTATED";

    const afterMutation = await companies.get("923609016", { includeRaw: true });
    expect(afterMutation.data.name).toBe(brregCompany.navn);
    expect((afterMutation.raw as { navn: string }).navn).toBe(brregCompany.navn);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("promotes LRU entries and purges expired entries before eviction", () => {
    let now = 0;
    const cache = new MemoryCache(2, () => now);
    cache.set("a", "A", 100);
    cache.set("b", "B", 100);
    expect(cache.get("a")).toBe("A");
    cache.set("c", "C", 100);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("A");
    expect(cache.get("c")).toBe("C");

    cache.clear();
    cache.set("live", "LIVE", 100);
    cache.set("short", "SHORT", 10);
    now = 11;
    cache.set("new", "NEW", 100);
    expect(cache.get("live")).toBe("LIVE");
    expect(cache.get("short")).toBeUndefined();
    expect(cache.get("new")).toBe("NEW");
    expect(cache.size).toBe(2);
  });

  it("keeps cache state separate between SDK instances", async () => {
    const firstFetch = sequenceFetch(jsonResponse(brregCompany));
    const secondFetch = sequenceFetch(jsonResponse(brregCompany));
    const first = new NorwayOpenData({
      fetch: firstFetch.fetch,
      retries: 0,
      cache: { enabled: true },
    });
    const second = new NorwayOpenData({
      fetch: secondFetch.fetch,
      retries: 0,
      cache: { enabled: true },
    });
    await first.companies.get("923609016");
    await second.companies.get("923609016");
    expect(firstFetch.mock).toHaveBeenCalledTimes(1);
    expect(secondFetch.mock).toHaveBeenCalledTimes(1);
  });

  it("never serializes credentials into keys and redacts echoed secrets", async () => {
    const apiKey = "unit-test-api-key-value";
    const contactEmail = "developer@example.no";
    const cache = new MemoryCache(10);
    const get = vi.spyOn(cache, "get");
    const set = vi.spyOn(cache, "set");
    const fetch = vi.fn(async () =>
      jsonResponse({
        ok: true,
        debug: { "X-API-Key": apiKey, contact: contactEmail },
      }),
    ) as typeof globalThis.fetch;
    const client = httpClient(fetch, cache, {
      contactEmail,
      credentials: { nve: { apiKey } },
    });
    const result = await client.request({
      provider: "test",
      url: "https://hydapi.nve.no/api/v1/test",
      headers: { "X-API-Key": apiKey },
      schema: z.object({ ok: z.boolean() }).loose(),
      cacheTtlMs: 60_000,
    });
    const serializedKeys = [...get.mock.calls, ...set.mock.calls].map(([key]) => key).join(" ");
    expect(serializedKeys).not.toContain(apiKey);
    expect(serializedKeys).not.toContain(contactEmail);
    expect(JSON.stringify(result.data)).not.toContain(apiKey);
    expect(JSON.stringify(result.data)).not.toContain(contactEmail);
  });
});
