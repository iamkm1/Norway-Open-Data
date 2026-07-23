import { NorwayOpenData, providers, type CacheStore } from "norway-open-data-sdk";

// A CacheStore lets several SDK instances -- workers, processes, hosts -- reuse
// one another's validated provider responses. This example uses a plain Map so
// it runs anywhere; a real deployment would back it with Redis or similar.
const entries = new Map<string, { value: unknown; expiresAt: number }>();

const store: CacheStore = {
  get(key) {
    const entry = entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      entries.delete(key);
      return undefined;
    }
    return entry.value;
  },
  set(key, value, ttlMs) {
    entries.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  clear() {
    entries.clear();
  },
};

const config = { cache: { enabled: true, store } };

// Two independent instances, one shared cache.
const first = await new NorwayOpenData(config).companies.get("923609016");
const second = await new NorwayOpenData(config).companies.get("923609016");

console.log(`first instance cached: ${String(first.cached)}`); // false
console.log(`second instance cached: ${String(second.cached)}`); // true

// Providers declare how often the SDK may call them. Budgets are enforced by
// default; a request that would exceed one waits rather than failing.
for (const id of ["ssb", "data-norge"] as const) {
  const budgets = providers[id].rateLimit;
  if (budgets === undefined) continue;
  for (const [operationClass, limit] of Object.entries(budgets)) {
    const perMinute = (limit.requests * 60_000) / limit.intervalMs;
    console.log(
      `${providers[id].name} ${operationClass}: ${String(perMinute)}/min (${limit.basis})`,
    );
  }
}
