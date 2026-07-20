import { z } from "zod";

import { MemoryCache, stableCacheKey } from "./cache.js";
import {
  NotFoundError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "./errors.js";
import { delay, parseRetryAfter, RETRYABLE_STATUS_CODES, retryDelayMs } from "./retry.js";
import type { HttpResult, QueryParameters, RequestOptions, ResolvedConfig } from "./types.js";

type HttpMethod = "GET" | "POST";

/** @internal */
export type HttpRequest<T> = {
  provider: string;
  url: string;
  method?: HttpMethod;
  query?: QueryParameters;
  body?: unknown;
  headers?: HeadersInit;
  schema: z.ZodType<T>;
  responseType?: "json" | "text";
  options?: RequestOptions;
  cacheTtlMs?: number;
};

function addQuery(url: string, query?: QueryParameters): string {
  if (query === undefined) return url;
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(query).sort(([a], [b]) => a.localeCompare(b))) {
    if (value === undefined) continue;
    const values = Array.isArray(value) ? value : [value];
    for (const item of values) parsed.searchParams.append(key, String(item));
  }
  return parsed.toString();
}

function isTemporaryNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error &&
      ["ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "ENOTFOUND", "UND_ERR_SOCKET"].some((code) =>
        error.message.includes(code),
      ))
  );
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function retryAfterSeconds(retryAfterMs: number | undefined): number | undefined {
  return retryAfterMs === undefined ? undefined : Math.ceil(retryAfterMs / 1_000);
}

/**
 * Internal fetch-based HTTP client shared by every provider.
 *
 * @internal
 */
export class HttpClient {
  readonly #config: ResolvedConfig;
  readonly #cache: MemoryCache;

  constructor(config: ResolvedConfig, cache?: MemoryCache) {
    this.#config = config;
    this.#cache = cache ?? new MemoryCache(config.cache.maxEntries);
  }

  /** Executes a validated JSON GET or POST request. */
  async request<T>(request: HttpRequest<T>): Promise<HttpResult<T>> {
    const method = request.method ?? "GET";
    const url = addQuery(request.url, request.query);
    const cacheTtlMs = this.#config.cache.ttlMs ?? request.cacheTtlMs;
    const canCache =
      this.#config.cache.enabled &&
      cacheTtlMs !== undefined &&
      cacheTtlMs > 0 &&
      request.options?.bypassCache !== true;
    const requestHeaders = new Headers(request.headers);
    const cacheKey = stableCacheKey({
      method,
      url,
      body: request.body,
      responseType: request.responseType ?? "json",
      accept: requestHeaders.get("Accept") ?? "application/json",
    });

    if (canCache) {
      const cached = this.#cache.get<T>(cacheKey);
      if (cached !== undefined) return { data: cached, cached: true };
    }

    const data = await this.#fetchWithRetries({ ...request, method, url });
    if (canCache) this.#cache.set(cacheKey, data, cacheTtlMs);
    return { data, cached: false };
  }

  /** Executes a GraphQL JSON POST request. */
  async graphql<T>(
    request: Omit<HttpRequest<T>, "method" | "body"> & {
      queryDocument: string;
      variables?: Record<string, unknown>;
    },
  ): Promise<HttpResult<T>> {
    return this.request({
      ...request,
      method: "POST",
      body: {
        query: request.queryDocument,
        ...(request.variables === undefined ? {} : { variables: request.variables }),
      },
    });
  }

  async #fetchWithRetries<T>(
    request: HttpRequest<T> & { method: HttpMethod; url: string },
  ): Promise<T> {
    const callerSignal = request.options?.signal;
    for (let attempt = 0; attempt <= this.#config.retries; attempt += 1) {
      if (isSignalAborted(callerSignal)) {
        throw new ProviderError(`${request.provider} request was cancelled by the caller.`, {
          provider: request.provider,
          cause: callerSignal?.reason,
        });
      }
      const timeoutController = new AbortController();
      const combinedController = new AbortController();
      let timeoutExpired = false;
      const onCallerAbort = (): void => combinedController.abort(callerSignal?.reason);
      callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
      if (isSignalAborted(callerSignal)) onCallerAbort();
      const timeout = setTimeout(() => {
        timeoutExpired = true;
        combinedController.abort();
      }, this.#config.timeoutMs);
      const onTimeoutAbort = (): void => combinedController.abort();
      timeoutController.signal.addEventListener("abort", onTimeoutAbort, { once: true });

      try {
        const headers = new Headers(request.headers);
        if (!headers.has("Accept")) headers.set("Accept", "application/json");
        const init: RequestInit = {
          method: request.method,
          headers,
          signal: combinedController.signal,
        };
        if (request.body !== undefined) {
          headers.set("Content-Type", "application/json");
          init.body = JSON.stringify(request.body);
        }

        const response = await this.#config.fetch(request.url, init);
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.#config.retries) {
            await delay(retryDelayMs(attempt, retryAfterMs), callerSignal);
            continue;
          }
          if (response.status === 404) {
            throw new NotFoundError(`${request.provider} resource was not found.`, {
              provider: request.provider,
              statusCode: 404,
            });
          }
          if (response.status === 429) {
            throw new RateLimitError(`${request.provider} rate limit was exceeded.`, {
              provider: request.provider,
              statusCode: 429,
              retryAfter: retryAfterSeconds(retryAfterMs),
            });
          }
          throw new ProviderError(`${request.provider} returned HTTP ${response.status}.`, {
            provider: request.provider,
            statusCode: response.status,
          });
        }

        let payload: unknown;
        try {
          payload = request.responseType === "text" ? await response.text() : await response.json();
        } catch (cause) {
          throw new ResponseValidationError(
            `${request.provider} returned an unreadable ${request.responseType ?? "json"} response.`,
            {
              provider: request.provider,
              statusCode: response.status,
              cause,
            },
          );
        }
        const parsed = request.schema.safeParse(payload);
        if (!parsed.success) {
          throw new ResponseValidationError(
            `${request.provider} returned a response with an unexpected structure.`,
            {
              provider: request.provider,
              statusCode: response.status,
              cause: parsed.error,
            },
          );
        }
        return parsed.data;
      } catch (error) {
        if (error instanceof ResponseValidationError || error instanceof ProviderError) throw error;
        if (isSignalAborted(callerSignal)) {
          throw new ProviderError(`${request.provider} request was cancelled by the caller.`, {
            provider: request.provider,
            cause: error,
          });
        }
        if (timeoutExpired) {
          if (attempt < this.#config.retries) continue;
          throw new RequestTimeoutError(
            `${request.provider} request timed out after ${this.#config.timeoutMs}ms.`,
            { provider: request.provider, cause: error },
          );
        }
        if (isTemporaryNetworkError(error)) {
          if (attempt < this.#config.retries) {
            await delay(retryDelayMs(attempt), callerSignal);
            continue;
          }
          throw new ProviderError(`${request.provider} request failed due to a network error.`, {
            provider: request.provider,
            cause: error,
          });
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        timeoutController.abort();
        callerSignal?.removeEventListener("abort", onCallerAbort);
      }
    }
    throw new ProviderError(`${request.provider} request failed.`);
  }
}

/** Builds a response envelope without including raw data by default. */
export function createResponse<T>(
  data: T,
  source: {
    id: string;
    name: string;
    homepage: string;
    documentation: string;
    license?: string;
  },
  raw: unknown,
  cached: boolean,
  options?: RequestOptions,
): import("./types.js").OpenDataResponse<T> {
  return {
    data,
    source,
    retrievedAt: new Date().toISOString(),
    cached,
    ...(options?.includeRaw === true ? { raw } : {}),
  };
}
