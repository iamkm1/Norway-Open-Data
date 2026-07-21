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
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REDACTED = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "et-client-name",
  "proxy-authorization",
  "set-cookie",
  "user-agent",
  "x-api-key",
  "x-client",
]);

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
  /** Performs provider-specific semantic validation or sanitization before caching. */
  transform?: (data: T) => T;
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

function cloneCacheValue<T>(value: T): T {
  return value !== null && typeof value === "object" ? structuredClone(value) : value;
}

function redactString(value: string, secrets: readonly string[]): string {
  if (secrets.includes(value)) return REDACTED;
  return secrets.reduce(
    (redacted, secret) => (secret.length >= 8 ? redacted.replaceAll(secret, REDACTED) : redacted),
    value,
  );
}

function redactSensitiveData(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === "string") return redactString(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redactSensitiveData(item, secrets));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).flatMap(([key, child]) =>
        SENSITIVE_HEADER_NAMES.has(key.toLowerCase())
          ? []
          : [[key, redactSensitiveData(child, secrets)]],
      ),
    );
  }
  return value;
}

function sanitizedCause(cause: unknown, secrets: readonly string[]): unknown {
  if (cause instanceof Error) {
    const error = new Error(redactString(cause.message, secrets));
    error.name = cause.name;
    return error;
  }
  return redactSensitiveData(cause, secrets);
}

function cancellationError(
  provider: string,
  cause: unknown,
  secrets: readonly string[],
): ProviderError {
  return new ProviderError(`${provider} request was cancelled by the caller.`, {
    provider,
    cause: sanitizedCause(cause, secrets),
  });
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
    if (isSignalAborted(request.options?.signal)) {
      throw cancellationError(
        request.provider,
        request.options?.signal?.reason,
        this.#sensitiveValues(new Headers(request.headers)),
      );
    }
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
      if (cached !== undefined) return { data: cloneCacheValue(cached), cached: true };
    }

    const data = await this.#fetchWithRetries({ ...request, method, url });
    if (isSignalAborted(request.options?.signal)) {
      throw cancellationError(
        request.provider,
        request.options?.signal?.reason,
        this.#sensitiveValues(requestHeaders),
      );
    }
    if (canCache) this.#cache.set(cacheKey, cloneCacheValue(data), cacheTtlMs);
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
    const requestHeaders = new Headers(request.headers);
    const secrets = this.#sensitiveValues(requestHeaders);
    for (let attempt = 0; attempt <= this.#config.retries; attempt += 1) {
      if (isSignalAborted(callerSignal)) {
        throw cancellationError(request.provider, callerSignal?.reason, secrets);
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

        const response = await this.#fetchWithSafeRedirects(request.provider, request.url, init);
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
          if (isSignalAborted(callerSignal) || timeoutExpired) throw cause;
          throw new ResponseValidationError(
            `${request.provider} returned an unreadable ${request.responseType ?? "json"} response.`,
            {
              provider: request.provider,
              statusCode: response.status,
              cause: sanitizedCause(cause, secrets),
            },
          );
        }
        const sanitizedPayload = redactSensitiveData(payload, secrets);
        const parsed = request.schema.safeParse(sanitizedPayload);
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
        return request.transform === undefined ? parsed.data : request.transform(parsed.data);
      } catch (error) {
        if (error instanceof ResponseValidationError || error instanceof ProviderError) throw error;
        if (isSignalAborted(callerSignal)) {
          throw cancellationError(request.provider, error, secrets);
        }
        if (timeoutExpired) {
          if (attempt < this.#config.retries) continue;
          throw new RequestTimeoutError(
            `${request.provider} request timed out after ${this.#config.timeoutMs}ms.`,
            { provider: request.provider, cause: sanitizedCause(error, secrets) },
          );
        }
        if (isTemporaryNetworkError(error)) {
          if (attempt < this.#config.retries) {
            try {
              await delay(retryDelayMs(attempt), callerSignal);
            } catch (delayError) {
              if (isSignalAborted(callerSignal)) {
                throw cancellationError(request.provider, delayError, secrets);
              }
              throw delayError;
            }
            continue;
          }
          throw new ProviderError(`${request.provider} request failed due to a network error.`, {
            provider: request.provider,
            cause: sanitizedCause(error, secrets),
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

  async #fetchWithSafeRedirects(
    provider: string,
    initialUrl: string,
    initialInit: RequestInit,
  ): Promise<Response> {
    let url = initialUrl;
    let init: RequestInit = { ...initialInit, redirect: "manual" };
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      const response = await this.#config.fetch(url, init);
      if (!REDIRECT_STATUS_CODES.has(response.status)) return response;
      const location = response.headers.get("Location");
      if (location === null) return response;
      if (redirects === MAX_REDIRECTS) {
        throw new ProviderError(`${provider} exceeded the redirect limit.`, {
          provider,
          statusCode: response.status,
        });
      }
      let target: URL;
      try {
        target = new URL(location, url);
      } catch {
        throw new ProviderError(`${provider} returned an invalid redirect location.`, {
          provider,
          statusCode: response.status,
        });
      }
      if (target.origin !== new URL(url).origin) {
        throw new ProviderError(`${provider} attempted a cross-origin redirect.`, {
          provider,
          statusCode: response.status,
        });
      }
      if (
        response.status === 303 ||
        ((response.status === 301 || response.status === 302) && init.method === "POST")
      ) {
        const headers = new Headers(init.headers);
        headers.delete("Content-Type");
        init = { ...init, method: "GET", headers };
        delete init.body;
      }
      url = target.toString();
    }
    throw new ProviderError(`${provider} exceeded the redirect limit.`, { provider });
  }

  #sensitiveValues(headers: Headers): string[] {
    const values = [this.#config.contactEmail, this.#config.credentials.nve.apiKey];
    for (const name of SENSITIVE_HEADER_NAMES) {
      const value = headers.get(name);
      if (value !== null) values.push(value);
    }
    return [
      ...new Set(values.filter((value): value is string => value !== undefined && value !== "")),
    ];
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
