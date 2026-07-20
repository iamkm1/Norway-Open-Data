type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/** A small TTL-aware least-recently-used in-memory cache. */
export class MemoryCache {
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
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
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
