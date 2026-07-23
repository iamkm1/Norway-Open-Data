import { z } from "zod";

import { type CacheStore, MemoryCache, stableCacheKey } from "./cache.js";
import {
  ConfigurationError,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "./errors.js";
import {
  type AvailableAuthValues,
  missingAuthFields,
  type ProviderAuthField,
  type ProviderAuthValues,
  type ProviderDescriptor,
} from "./provider.js";
import { RateLimiter } from "./rate-limit.js";
import { delay, parseRetryAfter, RETRYABLE_STATUS_CODES, retryDelayMs } from "./retry.js";
import type { HttpResult, QueryParameters, RequestOptions, ResolvedConfig } from "./types.js";
import type { ProviderId } from "../providers/registry.js";
import { version } from "../version.js";

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
  /** The provider descriptor this request belongs to. */
  provider: ProviderDescriptor;
  url: string;
  method?: HttpMethod;
  query?: QueryParameters;
  body?: unknown;
  headers?: HeadersInit;
  schema: z.ZodType<T>;
  responseType?: "json" | "text";
  options?: RequestOptions;
  cacheTtlMs?: number;
  /**
   * Adds the provider's identifying headers, failing before the request when
   * the caller has not configured what the provider requires.
   */
  authenticate?: boolean;
  /**
   * Selects one of the provider's named request budgets. Defaults to the
   * provider's `default` budget.
   */
  rateLimitKey?: string;
  /** Names the requested resource in not-found errors, e.g. `organization 923609016`. */
  resourceDescription?: string;
  /** Appends one follow-up sentence to not-found errors, e.g. a publication-timing note. */
  notFoundHint?: string;
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

/** Collects the identification values configured for one provider. */
export function availableAuthValues(
  config: Pick<ResolvedConfig, "applicationName" | "contactEmail" | "credentials">,
  providerId: ProviderId,
): AvailableAuthValues {
  const apiKey = config.credentials[providerId]?.apiKey;
  return {
    ...(config.applicationName === undefined ? {} : { applicationName: config.applicationName }),
    ...(config.contactEmail === undefined ? {} : { contactEmail: config.contactEmail }),
    ...(apiKey === undefined ? {} : { apiKey }),
  };
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
 * Behaviour that varies between providers -- caller identification, request
 * budget, cache lifetime -- is read from the provider's descriptor rather than
 * special-cased here.
 *
 * @internal
 */
export class HttpClient {
  readonly #config: ResolvedConfig;
  readonly #cache: CacheStore;
  readonly #limiters = new Map<string, RateLimiter>();

  constructor(config: ResolvedConfig, cache?: CacheStore) {
    this.#config = config;
    this.#cache = cache ?? config.cache.store ?? new MemoryCache(config.cache.maxEntries);
  }

  /** Executes a validated JSON GET or POST request. */
  async request<T>(request: HttpRequest<T>): Promise<HttpResult<T>> {
    const providerId = request.provider.id;
    const authHeaders = request.authenticate === true ? this.#authHeaders(request.provider) : {};
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(authHeaders)) headers.set(name, value);

    if (isSignalAborted(request.options?.signal)) {
      throw cancellationError(
        providerId,
        request.options?.signal?.reason,
        this.#sensitiveValues(headers),
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
    const cacheKey = stableCacheKey({
      // Cached values are provider payloads validated by this build's schemas.
      // A persistent or shared store can outlive the build that wrote them, so
      // the key is namespaced by SDK version rather than trusting an older
      // entry to still match the current schema.
      sdk: version,
      method,
      url,
      body: request.body,
      responseType: request.responseType ?? "json",
      accept: headers.get("Accept") ?? "application/json",
    });

    if (canCache) {
      // A store returns exactly what the SDK previously validated and stored.
      // `null` counts as a miss: stores backed by Redis and similar return it
      // for an absent key, and treating it as a hit would hand callers a `null`
      // where their type says otherwise.
      const cached = (await this.#cache.get(cacheKey)) as T | null | undefined;
      if (cached !== undefined && cached !== null) {
        return { data: cloneCacheValue(cached), cached: true };
      }
    }

    const data = await this.#fetchWithRetries({ ...request, method, url, headers });
    if (isSignalAborted(request.options?.signal)) {
      throw cancellationError(
        providerId,
        request.options?.signal?.reason,
        this.#sensitiveValues(headers),
      );
    }
    if (canCache) await this.#cache.set(cacheKey, cloneCacheValue(data), cacheTtlMs);
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

  /** Removes every response this client may have cached. */
  async clearCache(): Promise<void> {
    await this.#cache.clear();
  }

  /**
   * Builds a provider's identifying headers from the resolved configuration.
   *
   * Throws before any network access when a declared requirement is missing, so
   * the caller sees the provider's own instructions rather than an HTTP 401.
   */
  #authHeaders(provider: ProviderDescriptor): Record<string, string> {
    const auth = provider.auth;
    if (auth === undefined) return {};
    const available = availableAuthValues(this.#config, provider.id as ProviderId);
    if (missingAuthFields(provider, available).length > 0) {
      throw new ConfigurationError(auth.missing, { provider: provider.id });
    }
    // Supply exactly the fields the provider declared, so a descriptor cannot
    // read a value it never required. Each was just proven present and non-empty.
    const declared: AvailableAuthValues = {};
    for (const field of auth.requires) declared[field] = available[field];
    const values = { ...declared, sdkVersion: version } as ProviderAuthValues<ProviderAuthField>;
    return auth.headers(values);
  }

  /**
   * Returns the shared limiter for one of a provider's budgets, or undefined
   * when the provider declares none.
   *
   * A provider that publishes different limits per service names them; an
   * unknown or absent name falls back to the provider's `default` budget rather
   * than silently going unlimited.
   */
  #limiter(provider: ProviderDescriptor, operationClass?: string): RateLimiter | undefined {
    if (!this.#config.rateLimit.enabled || provider.rateLimit === undefined) return undefined;
    const policy =
      operationClass === undefined
        ? provider.rateLimit.default
        : (provider.rateLimit[operationClass] ?? provider.rateLimit.default);
    const key = `${provider.id}:${operationClass ?? "default"}`;
    const existing = this.#limiters.get(key);
    if (existing !== undefined) return existing;
    const created = new RateLimiter(policy);
    this.#limiters.set(key, created);
    return created;
  }

  async #fetchWithRetries<T>(
    request: HttpRequest<T> & { method: HttpMethod; url: string; headers: Headers },
  ): Promise<T> {
    const callerSignal = request.options?.signal;
    const providerId = request.provider.id;
    const secrets = this.#sensitiveValues(request.headers);
    const limiter = this.#limiter(request.provider, request.rateLimitKey);
    for (let attempt = 0; attempt <= this.#config.retries; attempt += 1) {
      if (isSignalAborted(callerSignal)) {
        throw cancellationError(providerId, callerSignal?.reason, secrets);
      }
      // Waiting for budget happens before the timeout is armed, so a queued
      // request is not charged for time it spent waiting its turn.
      if (limiter !== undefined) {
        try {
          await limiter.acquire(callerSignal);
        } catch (error) {
          if (isSignalAborted(callerSignal)) {
            throw cancellationError(providerId, error, secrets);
          }
          throw error;
        }
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

        const response = await this.#fetchWithSafeRedirects(providerId, request.url, init);
        if (!response.ok) {
          const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
          if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.#config.retries) {
            await delay(retryDelayMs(attempt, retryAfterMs), callerSignal);
            continue;
          }
          if (response.status === 404) {
            const subject = `${providerId} ${request.resourceDescription ?? "resource"}`;
            const hint = request.notFoundHint === undefined ? "" : ` ${request.notFoundHint}`;
            throw new NotFoundError(`${subject} was not found.${hint}`, {
              provider: providerId,
              statusCode: 404,
            });
          }
          if (response.status === 429) {
            throw new RateLimitError(`${providerId} rate limit was exceeded.`, {
              provider: providerId,
              statusCode: 429,
              retryAfter: retryAfterSeconds(retryAfterMs),
            });
          }
          throw new ProviderError(`${providerId} returned HTTP ${response.status}.`, {
            provider: providerId,
            statusCode: response.status,
          });
        }

        let payload: unknown;
        try {
          payload = request.responseType === "text" ? await response.text() : await response.json();
        } catch (cause) {
          if (isSignalAborted(callerSignal) || timeoutExpired) throw cause;
          throw new ResponseValidationError(
            `${providerId} returned an unreadable ${request.responseType ?? "json"} response.`,
            {
              provider: providerId,
              statusCode: response.status,
              cause: sanitizedCause(cause, secrets),
            },
          );
        }
        const sanitizedPayload = redactSensitiveData(payload, secrets);
        const parsed = request.schema.safeParse(sanitizedPayload);
        if (!parsed.success) {
          throw new ResponseValidationError(
            `${providerId} returned a response with an unexpected structure.`,
            {
              provider: providerId,
              statusCode: response.status,
              cause: parsed.error,
            },
          );
        }
        return request.transform === undefined ? parsed.data : request.transform(parsed.data);
      } catch (error) {
        if (error instanceof ResponseValidationError || error instanceof ProviderError) throw error;
        if (isSignalAborted(callerSignal)) {
          throw cancellationError(providerId, error, secrets);
        }
        if (timeoutExpired) {
          if (attempt < this.#config.retries) continue;
          throw new RequestTimeoutError(
            `${providerId} request timed out after ${this.#config.timeoutMs}ms.`,
            { provider: providerId, cause: sanitizedCause(error, secrets) },
          );
        }
        if (isTemporaryNetworkError(error)) {
          if (attempt < this.#config.retries) {
            try {
              await delay(retryDelayMs(attempt), callerSignal);
            } catch (delayError) {
              if (isSignalAborted(callerSignal)) {
                throw cancellationError(providerId, delayError, secrets);
              }
              throw delayError;
            }
            continue;
          }
          throw new ProviderError(`${providerId} request failed due to a network error.`, {
            provider: providerId,
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
    throw new ProviderError(`${providerId} request failed.`);
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
    const values: (string | undefined)[] = [this.#config.contactEmail];
    for (const credential of Object.values(this.#config.credentials)) {
      values.push(credential?.apiKey);
    }
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
  source: import("./provider.js").OpenDataSource,
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
