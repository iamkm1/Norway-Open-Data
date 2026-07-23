import type { CacheStore } from "./cache.js";
import type { OpenDataSource } from "./provider.js";
import type { ProviderId } from "../providers/registry.js";

/** Options accepted by every provider request. */
export type RequestOptions = {
  /** Cancels the request when the signal is aborted. */
  signal?: AbortSignal;
  /** Includes the validated, provider-native payload in `raw`. */
  includeRaw?: boolean;
  /** Skips reading from and writing to the SDK cache for this request. */
  bypassCache?: boolean;
};

/** Common response envelope used by successful SDK operations. */
export type OpenDataResponse<T> = {
  /** Provider data, normalized only where semantics are unambiguous. */
  data: T;
  /** The public-data source responsible for the result. */
  source: OpenDataSource;
  /** ISO-8601 timestamp for this SDK retrieval. */
  retrievedAt: string;
  /** Whether the provider payload was served from the SDK cache. */
  cached: boolean;
  /** Provider-native payload, present only when `includeRaw` is true. */
  raw?: unknown;
};

/** Configuration for the SDK's optional response cache. */
export type CacheConfig = {
  /** Enables the cache. Defaults to `false`. */
  enabled?: boolean;
  /** Overrides provider-recommended TTL values globally. */
  ttlMs?: number;
  /** Maximum number of entries held by the built-in in-memory cache. Defaults to 100. */
  maxEntries?: number;
  /**
   * Storage backing the cache.
   *
   * Defaults to an in-memory cache private to this SDK instance. Supply a store
   * to share cached responses across instances or processes; `maxEntries` then
   * no longer applies, since eviction becomes the store's responsibility.
   */
  store?: CacheStore;
};

/** Configuration for the SDK's per-provider request budgets. */
export type RateLimitConfig = {
  /**
   * Enforces each provider's declared request budget. Defaults to `true`.
   *
   * Disable only when you are certain your traffic is already bounded, for
   * example behind your own scheduler or a shared gateway.
   */
  enabled?: boolean;
};

/** Credentials for one provider. */
export type ProviderCredential = {
  /** Provider-issued key, sent only to that provider's hosts. */
  apiKey?: string;
};

/**
 * Optional provider credentials, keyed by provider id.
 *
 * Anonymous methods never require these. Only providers whose descriptor
 * declares an `apiKey` requirement read this configuration.
 */
export type ProviderCredentials = Partial<Record<ProviderId, ProviderCredential>>;

/** Configuration shared by all provider clients. */
export type NorwayOpenDataConfig = {
  /** Meaningful application identifier, required by Entur, MET Norway, and NVDB. */
  applicationName?: string;
  /** Contact address required by MET Norway. */
  contactEmail?: string;
  /** Request timeout in milliseconds. Defaults to 10 seconds. */
  timeoutMs?: number;
  /** Number of retry attempts after the initial request. Defaults to 2. */
  retries?: number;
  /** Fetch-compatible implementation for tests and custom runtimes. */
  fetch?: typeof globalThis.fetch;
  /** Optional response-cache configuration. */
  cache?: CacheConfig;
  /** Optional per-provider request-budget configuration. */
  rateLimit?: RateLimitConfig;
  /** Optional provider-specific credentials; anonymous methods never require these. */
  credentials?: ProviderCredentials;
};

/** Primitive query-string values supported by the HTTP client. */
export type QueryValue =
  string | number | boolean | undefined | readonly (string | number | boolean)[];

/** Query-string object supported by the HTTP client. */
export type QueryParameters = Record<string, QueryValue>;

/** @internal */
export type ResolvedConfig = {
  applicationName?: string;
  contactEmail?: string;
  timeoutMs: number;
  retries: number;
  fetch: typeof globalThis.fetch;
  cache: {
    enabled: boolean;
    ttlMs?: number;
    maxEntries: number;
    store?: CacheStore;
  };
  rateLimit: {
    enabled: boolean;
  };
  credentials: ProviderCredentials;
};

/** @internal */
export type HttpResult<T> = {
  data: T;
  cached: boolean;
};
