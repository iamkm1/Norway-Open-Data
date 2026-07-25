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
import { parseNdjson } from "./ndjson.js";
import { OAuth2TokenStore } from "./oauth.js";
import {
  type AvailableAuthValues,
  missingAuthFields,
  missingAuthMessage,
  type ProviderAuthField,
  type ProviderAuthValues,
  type ProviderDescriptor,
} from "./provider.js";
import { RateLimiter } from "./rate-limit.js";
import {
  delay,
  parseRetryAfter,
  providerDirectedDelayMs,
  RETRYABLE_STATUS_CODES,
  retryDelayMs,
} from "./retry.js";
import type { HttpResult, QueryParameters, RequestOptions, ResolvedConfig } from "./types.js";
import type { ProviderId } from "../providers/registry.js";
import { version } from "../version.js";

type HttpMethod = "GET" | "POST";
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const REDACTED = "[REDACTED]";
/**
 * Header names removed from a provider payload when they appear as object keys.
 *
 * A public-data response has no reason to echo request headers back, so a
 * property named after one is dropped rather than handed to the caller.
 */
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
/**
 * Headers whose *values* are secret, and are therefore redacted wherever they
 * appear inside a payload or error.
 *
 * Caller-identification headers are deliberately absent. `X-Client`,
 * `ET-Client-Name` and `User-Agent` carry `applicationName`, which is a public
 * identifier a provider logs and may legitimately use in its own data. Treating
 * it as a secret rewrote valid responses: an application named after a word in
 * a provider's own URLs turned them into unparsable values before validation.
 * The credentials that also travel in those headers -- `contactEmail` and any
 * `apiKey` -- are collected from the resolved configuration instead, so nothing
 * that is genuinely secret stops being protected.
 */
const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
  "set-cookie",
  "x-api-key",
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

/**
 * A long-lived newline-delimited JSON response.
 *
 * Deliberately narrower than {@link HttpRequest}: a stream is never cached, never
 * retried and never has a whole-response timeout, so those options are absent
 * rather than silently ignored.
 *
 * @internal
 */
export type StreamRequest<T> = {
  provider: ProviderDescriptor;
  url: string;
  method?: HttpMethod;
  query?: QueryParameters;
  body?: unknown;
  headers?: HeadersInit;
  /** Validates every record in the stream independently. */
  schema: z.ZodType<T>;
  /** Only `signal` applies; caching and raw payloads have no meaning here. */
  options?: Pick<RequestOptions, "signal">;
  authenticate?: boolean;
  rateLimitKey?: string;
  /** Describes the stream in errors, e.g. `AIS position stream`. */
  description?: string;
  /** Overrides the maximum characters buffered for one record. */
  maxRecordSize?: number;
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
  const credential = config.credentials[providerId];
  return {
    ...(config.applicationName === undefined ? {} : { applicationName: config.applicationName }),
    ...(config.contactEmail === undefined ? {} : { contactEmail: config.contactEmail }),
    ...(credential?.apiKey === undefined ? {} : { apiKey: credential.apiKey }),
    ...(credential?.clientId === undefined ? {} : { clientId: credential.clientId }),
    ...(credential?.clientSecret === undefined ? {} : { clientSecret: credential.clientSecret }),
  };
}

/**
 * Maps a provider's failed HTTP status onto an SDK error.
 *
 * Shared by the request and stream paths so a 404 from a streaming endpoint is
 * the same `NotFoundError` a caller already handles for everything else.
 */
function providerResponseError(details: {
  provider: string;
  status: number;
  retryAfterMs?: number;
  resourceDescription?: string;
  notFoundHint?: string;
}): Error {
  const { provider, status, retryAfterMs } = details;
  if (status === 404) {
    const subject = `${provider} ${details.resourceDescription ?? "resource"}`;
    const hint = details.notFoundHint === undefined ? "" : ` ${details.notFoundHint}`;
    return new NotFoundError(`${subject} was not found.${hint}`, { provider, statusCode: 404 });
  }
  if (status === 429) {
    return new RateLimitError(`${provider} rate limit was exceeded.`, {
      provider,
      statusCode: 429,
      retryAfter: retryAfterSeconds(retryAfterMs),
    });
  }
  return new ProviderError(`${provider} returned HTTP ${status}.`, {
    provider,
    statusCode: status,
    // Kept so a caller that stopped because the provider asked for a long pause
    // can still see how long it asked for.
    ...(retryAfterMs === undefined ? {} : { retryAfter: retryAfterSeconds(retryAfterMs) }),
  });
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
  /**
   * Bearer tokens for providers using the client-credentials grant.
   *
   * Scoped to this client instance and held only in memory, so tokens are never
   * written to the response cache and never outlive the process.
   */
  readonly #tokens: OAuth2TokenStore;

  constructor(config: ResolvedConfig, cache?: CacheStore) {
    this.#config = config;
    this.#cache = cache ?? config.cache.store ?? new MemoryCache(config.cache.maxEntries);
    this.#tokens = new OAuth2TokenStore({
      fetch: config.fetch,
      timeoutMs: config.timeoutMs,
    });
  }

  /** Executes a validated JSON GET or POST request. */
  async request<T>(request: HttpRequest<T>): Promise<HttpResult<T>> {
    const providerId = request.provider.id;
    const authHeaders =
      request.authenticate === true ? this.#identificationHeaders(request.provider) : {};
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

  /**
   * Opens a newline-delimited JSON stream and yields validated records.
   *
   * The returned generator performs no work until it is iterated, so creating one
   * sends no request. The connection is established with the configured timeout,
   * which is then cleared: a live feed is expected to stay open indefinitely, and
   * applying a response timeout to it would sever a healthy stream.
   *
   * A stream is never retried and never reconnected. When the provider closes it,
   * iteration ends; whether reopening is safe depends on whether the caller can
   * tolerate the gap, which only the caller knows.
   */
  async *stream<T>(request: StreamRequest<T>): AsyncGenerator<T, void, undefined> {
    const providerId = request.provider.id;
    const callerSignal = request.options?.signal;
    const headers = new Headers(request.headers);
    for (const [name, value] of Object.entries(
      request.authenticate === true ? this.#identificationHeaders(request.provider) : {},
    )) {
      headers.set(name, value);
    }
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    const secrets = this.#sensitiveValues(headers);
    if (isSignalAborted(callerSignal)) {
      throw cancellationError(providerId, callerSignal?.reason, secrets);
    }

    const limiter = this.#limiter(request.provider, request.rateLimitKey);
    if (limiter !== undefined) {
      try {
        await limiter.acquire(callerSignal);
      } catch (error) {
        if (isSignalAborted(callerSignal)) throw cancellationError(providerId, error, secrets);
        throw error;
      }
    }

    if (request.authenticate === true) {
      const token = await this.#bearerToken(request.provider, callerSignal);
      if (token !== undefined) {
        headers.set("Authorization", `Bearer ${token}`);
        secrets.push(token);
      }
    }

    const method = request.method ?? "GET";
    const url = addQuery(request.url, request.query);
    const controller = new AbortController();
    const onCallerAbort = (): void => controller.abort(callerSignal?.reason);
    callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
    if (isSignalAborted(callerSignal)) onCallerAbort();
    let connectTimedOut = false;
    const connectTimeout = setTimeout(() => {
      connectTimedOut = true;
      controller.abort();
    }, this.#config.timeoutMs);

    let response: Response;
    try {
      const init: RequestInit = { method, headers, signal: controller.signal };
      if (request.body !== undefined) {
        headers.set("Content-Type", "application/json");
        init.body = JSON.stringify(request.body);
      }
      response = await this.#fetchWithSafeRedirects(providerId, url, init);
    } catch (error) {
      if (isSignalAborted(callerSignal)) throw cancellationError(providerId, error, secrets);
      if (connectTimedOut) {
        throw new RequestTimeoutError(
          `${providerId} stream did not respond within ${this.#config.timeoutMs}ms.`,
          { provider: providerId, cause: sanitizedCause(error, secrets) },
        );
      }
      if (error instanceof ProviderError) throw error;
      throw new ProviderError(`${providerId} stream failed to open.`, {
        provider: providerId,
        cause: sanitizedCause(error, secrets),
      });
    } finally {
      // Cleared as soon as headers arrive, so the timeout bounds connecting
      // rather than the lifetime of the stream.
      clearTimeout(connectTimeout);
    }

    try {
      if (!response.ok) {
        // A rejected token may simply have been revoked upstream; drop it so the
        // next call acquires a fresh one instead of replaying a dead credential.
        if (response.status === 401) this.#tokens.forget(providerId);
        throw providerResponseError({
          provider: providerId,
          status: response.status,
          retryAfterMs: parseRetryAfter(response.headers.get("Retry-After")),
          resourceDescription: request.description ?? "stream",
        });
      }
      const body = response.body;
      if (body === null) {
        throw new ProviderError(`${providerId} stream response had no body.`, {
          provider: providerId,
          statusCode: response.status,
        });
      }
      yield* parseNdjson(body, {
        schema: request.schema,
        provider: providerId,
        ...(callerSignal === undefined ? {} : { signal: callerSignal }),
        ...(request.maxRecordSize === undefined ? {} : { maxRecordSize: request.maxRecordSize }),
        ...(request.description === undefined ? {} : { description: request.description }),
      });
    } finally {
      callerSignal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** Removes every response this client may have cached. */
  async clearCache(): Promise<void> {
    await this.#cache.clear();
  }

  /**
   * Fails before any network access when a provider's declared configuration is
   * missing, so the caller sees the provider's own instructions rather than an
   * HTTP 401.
   */
  #requireConfigured(provider: ProviderDescriptor): AvailableAuthValues {
    const available = availableAuthValues(this.#config, provider.id as ProviderId);
    if (missingAuthFields(provider, available).length > 0) {
      throw new ConfigurationError(missingAuthMessage(provider), { provider: provider.id });
    }
    return available;
  }

  /**
   * Acquires this provider's bearer token, or returns undefined for a provider
   * that does not use the client-credentials grant.
   */
  async #bearerToken(
    provider: ProviderDescriptor,
    signal: AbortSignal | undefined,
  ): Promise<string | undefined> {
    const oauth = provider.oauth;
    if (oauth === undefined) return undefined;
    const available = this.#requireConfigured(provider);
    // Both were just proven present and non-empty by #requireConfigured.
    return this.#tokens.token(
      {
        provider: provider.id,
        tokenUrl: oauth.tokenUrl,
        scope: oauth.scope,
        clientId: available.clientId ?? "",
        clientSecret: available.clientSecret ?? "",
      },
      signal,
    );
  }

  /**
   * Builds a provider's identifying headers from the resolved configuration.
   *
   * Throws before any network access when a declared requirement is missing, so
   * the caller sees the provider's own instructions rather than an HTTP 401.
   */
  #identificationHeaders(provider: ProviderDescriptor): Record<string, string> {
    const available = this.#requireConfigured(provider);
    const auth = provider.auth;
    if (auth === undefined) return {};
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
    // Resolve the budget name before keying the limiter. Keying by the requested
    // name would give an undeclared one its own limiter carrying a copy of the
    // default policy, letting that budget be spent twice over instead of shared.
    const budget =
      operationClass !== undefined && provider.rateLimit[operationClass] !== undefined
        ? operationClass
        : "default";
    const key = `${provider.id}:${budget}`;
    const existing = this.#limiters.get(key);
    if (existing !== undefined) return existing;
    const created = new RateLimiter(provider.rateLimit[budget] ?? provider.rateLimit.default);
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
        // Resolved per attempt, so a retry after a refresh carries the new token
        // rather than replaying the one that had expired.
        if (request.authenticate === true) {
          const token = await this.#bearerToken(request.provider, callerSignal);
          if (token !== undefined) {
            headers.set("Authorization", `Bearer ${token}`);
            if (!secrets.includes(token)) secrets.push(token);
          }
        }
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
          // A rejected token may have been revoked upstream; drop it so a retry
          // or a later call acquires a fresh one rather than replaying a dead
          // credential until the process restarts.
          if (response.status === 401) this.#tokens.forget(providerId);
          // A stated delay is obeyed exactly. Only when the provider gave none
          // does the SDK's own capped backoff apply, and a delay longer than the
          // SDK will wait out stops the retry rather than resuming early.
          const waitMs =
            retryAfterMs === undefined
              ? retryDelayMs(attempt)
              : providerDirectedDelayMs(retryAfterMs);
          if (
            RETRYABLE_STATUS_CODES.has(response.status) &&
            attempt < this.#config.retries &&
            waitMs !== undefined
          ) {
            await delay(waitMs, callerSignal);
            continue;
          }
          throw providerResponseError({
            provider: providerId,
            status: response.status,
            ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
            ...(request.resourceDescription === undefined
              ? {}
              : { resourceDescription: request.resourceDescription }),
            ...(request.notFoundHint === undefined ? {} : { notFoundHint: request.notFoundHint }),
          });
        }

        let payload: unknown;
        try {
          // HTTP 204 carries no body, so parsing one would fail. It is handed to
          // the schema as `null`, letting a provider that answers "no data here"
          // with an empty response be modelled as a nullable result instead of
          // being reported as an unreadable payload.
          payload =
            response.status === 204
              ? null
              : request.responseType === "text"
                ? await response.text()
                : await response.json();
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
      values.push(credential?.clientSecret);
      // A client id is not a bearer credential on its own, but BarentsWatch
      // formats it as `account@example.com:clientname`, so it carries the
      // caller's own address and is redacted for the same reason contactEmail is.
      values.push(credential?.clientId);
    }
    for (const name of SECRET_HEADER_NAMES) {
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
