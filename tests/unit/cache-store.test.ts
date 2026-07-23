import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import type { CacheStore } from "../../src/core/cache.js";
import { NorwayOpenData, version } from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

/** An asynchronous store standing in for a shared cache such as Redis. */
function asyncStore(): CacheStore & { entries: Map<string, unknown>; reads: number } {
  const entries = new Map<string, unknown>();
  return {
    entries,
    reads: 0,
    async get(key: string) {
      this.reads += 1;
      await Promise.resolve();
      return entries.get(key);
    },
    async set(key: string, value: unknown) {
      await Promise.resolve();
      entries.set(key, value);
    },
    async clear() {
      await Promise.resolve();
      entries.clear();
    },
  };
}

describe("pluggable cache storage", () => {
  it("shares cached provider responses between two SDK instances", async () => {
    const store = asyncStore();
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    const options = { fetch, cache: { enabled: true, store } };

    const first = await new NorwayOpenData(options).companies.get("923609016");
    const second = await new NorwayOpenData(options).companies.get("923609016");

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.data.organizationNumber).toBe(first.data.organizationNumber);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("routes reads and writes through the supplied store rather than memory", async () => {
    const store = asyncStore();
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, cache: { enabled: true, store } });

    await sdk.companies.get("923609016");

    expect(store.entries.size).toBe(1);
    expect(store.reads).toBeGreaterThan(0);
  });

  it("clears through the store and awaits it", async () => {
    const store = asyncStore();
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, cache: { enabled: true, store } });

    await sdk.companies.get("923609016");
    expect(store.entries.size).toBe(1);

    await sdk.clearCache();
    expect(store.entries.size).toBe(0);

    await expect(sdk.companies.get("923609016")).resolves.toMatchObject({ cached: false });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not consult a store while the cache is disabled", async () => {
    const store = asyncStore();
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, cache: { store } });

    await sdk.companies.get("923609016");
    await sdk.companies.get("923609016");

    expect(store.reads).toBe(0);
    expect(store.entries.size).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("treats a null from the store as a miss rather than cached data", async () => {
    // Redis and similar clients return null for an absent key. Treating that as
    // a hit would hand the caller a null where the type promises a Company.
    const nullMissStore: CacheStore = {
      get: () => null,
      set: () => undefined,
      clear: () => undefined,
    };
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, cache: { enabled: true, store: nullMissStore } });

    const response = await sdk.companies.get("923609016");

    expect(response.cached).toBe(false);
    expect(response.data.organizationNumber).toBe("923609016");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("namespaces cache keys by SDK version so a persistent store cannot cross versions", async () => {
    const keys: string[] = [];
    const spyStore: CacheStore = {
      get: (key: string) => {
        keys.push(key);
        return undefined;
      },
      set: () => undefined,
      clear: () => undefined,
    };
    const fetch = vi.fn(async () => jsonResponse(brregCompany)) as typeof globalThis.fetch;
    await new NorwayOpenData({ fetch, cache: { enabled: true, store: spyStore } }).companies.get(
      "923609016",
    );

    expect(keys).toHaveLength(1);
    expect(keys[0]).toContain(version);
    expect(keys[0]).toContain('"sdk"');
  });

  it("rejects a store that does not implement the contract", () => {
    expect(
      () =>
        new NorwayOpenData({
          cache: { enabled: true, store: { get: () => undefined } as unknown as CacheStore },
        }),
    ).toThrow(/Invalid NorwayOpenData configuration/);
  });
});
