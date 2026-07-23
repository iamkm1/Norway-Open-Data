type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * Storage backing the SDK's response cache.
 *
 * The default in-memory cache is per-instance and therefore invisible to other
 * processes. Supply your own store to share cached provider responses across
 * instances, workers or hosts. Every method may be synchronous or asynchronous;
 * the SDK awaits all of them.
 *
 * A store receives values that have already passed runtime validation, and is
 * expected to return them unchanged. It is responsible for honouring `ttlMs`;
 * the SDK does not re-check expiry on read.
 *
 * Two properties matter when the store is shared or persistent. Keys are
 * namespaced by SDK version, so entries written by one version are never read
 * by another whose schemas may differ. Keys never contain credentials, so a
 * shared store serves one cached response to every caller regardless of which
 * API key fetched it; every supported provider returns public data, but do not
 * add a provider whose response varies per credential without revisiting this.
 */
export type CacheStore = {
  /**
   * Returns the stored value, or `undefined` when absent or expired. `null` is
   * also treated as a miss, so a store backed by Redis or a similar client can
   * return its native empty value directly. May return a promise; the SDK
   * awaits the result either way.
   */
  get(key: string): unknown;
  /** Stores a value for at most `ttlMs` milliseconds. */
  set(key: string, value: unknown, ttlMs: number): void | Promise<void>;
  /** Removes every value this SDK instance may have stored. */
  clear(): void | Promise<void>;
};

/** A small TTL-aware least-recently-used in-memory cache. */
export class MemoryCache implements CacheStore {
  readonly #entries = new Map<string, CacheEntry<unknown>>();
  readonly #maxEntries: number;
  readonly #now: () => number;

  constructor(maxEntries = 100, now: () => number = Date.now) {
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  /** Reads and promotes a non-expired entry. */
  get<T>(key: string): T | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value as T;
  }

  /** Inserts an entry and evicts the least-recently-used entry if necessary. */
  set<T>(key: string, value: T, ttlMs: number): void {
    if (ttlMs <= 0) return;
    const now = this.#now();
    for (const [entryKey, entry] of this.#entries) {
      if (entry.expiresAt <= now) this.#entries.delete(entryKey);
    }
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: now + ttlMs });
    while (this.#entries.size > this.#maxEntries) {
      const oldestKey = this.#entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      this.#entries.delete(oldestKey);
    }
  }

  /** Removes all cached entries. */
  clear(): void {
    this.#entries.clear();
  }

  /** Current number of entries, including entries not yet lazily expired. */
  get size(): number {
    return this.#entries.size;
  }
}

function normalizeForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForStableJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeForStableJson(child)]),
    );
  }
  return value;
}

/** Builds deterministic cache keys from JSON-compatible values. */
export function stableCacheKey(value: unknown): string {
  return JSON.stringify(normalizeForStableJson(value));
}
