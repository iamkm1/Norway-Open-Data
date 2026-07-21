import type { OpenDataSource } from "./metadata.js";

/** Options accepted by every provider request. */
export type RequestOptions = {
  /** Cancels the request when the signal is aborted. */
  signal?: AbortSignal;
  /** Includes the validated, provider-native payload in `raw`. */
  includeRaw?: boolean;
  /** Skips reading from and writing to the in-memory cache for this request. */
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
  /** Whether the provider payload was served from the SDK memory cache. */
  cached: boolean;
  /** Provider-native payload, present only when `includeRaw` is true. */
  raw?: unknown;
};

/** Configuration for the SDK's optional memory cache. */
export type CacheConfig = {
  /** Enables the cache. Defaults to `false`. */
  enabled?: boolean;
  /** Overrides provider-recommended TTL values globally. */
  ttlMs?: number;
  /** Maximum number of cache entries. Defaults to 100. */
  maxEntries?: number;
};

/** Optional credentials for provider methods that require free registration. */
export type ProviderCredentials = {
  nve?: {
    /** HydAPI subscription key sent only to hydapi.nve.no. */
    apiKey?: string;
  };
};

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
  /** Optional in-memory cache configuration. */
  cache?: CacheConfig;
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
  };
  credentials: {
    nve: {
      apiKey?: string;
    };
  };
};

/** @internal */
export type HttpResult<T> = {
  data: T;
  cached: boolean;
};
