/**
 * Reusable OAuth2 client-credentials support.
 *
 * A provider that declares {@link ProviderOAuth} in its descriptor gets bearer
 * tokens acquired, cached and refreshed by this module. Nothing here is specific
 * to one provider: the token URL, scope and instructions all come from the
 * descriptor, so a future provider needs no change to this file.
 *
 * Deliberate limits:
 *
 * - Tokens live in memory for the lifetime of one {@link OAuth2TokenStore}, and
 *   are never written to the response cache or to any persistent store. A cached
 *   bearer token is a credential; the SDK's cache may be shared across processes
 *   and is keyed only by request shape, so it is the wrong place for one.
 * - There is no hosted proxy or shared broker. Credentials go from the caller's
 *   configuration to the provider's own token endpoint and nowhere else.
 */
import { z } from "zod";

import {
  ConfigurationError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "./errors.js";

/**
 * How a provider issues bearer tokens from a client id and secret.
 *
 * Only the client-credentials grant is supported. Interactive grants need a
 * browser redirect and a place to keep a refresh token, neither of which a
 * server-side data SDK should own.
 */
export type ProviderOAuth = {
  /** Absolute token endpoint URL, from the provider's own documentation. */
  readonly tokenUrl: string;
  /** Scope requested for this provider's data endpoints. */
  readonly scope: string;
  /** Tells the caller exactly what to configure when credentials are missing. */
  readonly missing: string;
};

/**
 * Declares a provider's client-credentials configuration.
 *
 * Present for symmetry with {@link defineAuth}, so a descriptor reads the same
 * way whether the provider identifies callers with headers or with tokens.
 */
export function defineOAuth(oauth: ProviderOAuth): ProviderOAuth {
  return oauth;
}

/**
 * Seconds of headroom subtracted from a token's stated lifetime.
 *
 * A token is refreshed before it expires rather than after a request has already
 * failed with HTTP 401, which would otherwise surface as a provider error the
 * caller can do nothing about. The window also absorbs clock skew between this
 * process and the issuer.
 */
const EXPIRY_SKEW_MS = 60_000;

/**
 * Floor applied to a token's usable lifetime.
 *
 * A provider that issues very short-lived tokens must not make the subtracted
 * skew produce an already-expired token, which would request a new one on every
 * single call.
 */
const MINIMUM_LIFETIME_MS = 5_000;

/** Status codes that mean the credentials themselves are the problem. */
const CREDENTIAL_REJECTED_STATUS_CODES = new Set([400, 401, 403]);

/**
 * The subset of a token response this SDK uses.
 *
 * `access_token` and `expires_in` are the only fields read. `token_type` is
 * checked case-insensitively against `bearer`, because issuers spell it both
 * `Bearer` and `bearer`, and anything else would need a different Authorization
 * header than the one built here.
 */
const tokenResponseSchema = z.object({
  access_token: z.string().min(1),
  token_type: z
    .string()
    .refine((value) => value.toLowerCase() === "bearer", {
      message: "Only bearer tokens are supported.",
    })
    .optional(),
  expires_in: z.number().positive().optional(),
});

type CachedToken = { accessToken: string; expiresAtMs: number };

/** Everything {@link OAuth2TokenStore} needs from the resolved configuration. */
export type OAuth2TokenStoreOptions = {
  fetch: typeof globalThis.fetch;
  /** Applied to the token request itself, independently of the data request. */
  timeoutMs: number;
  /** Injectable clock, so expiry and refresh are testable without waiting. */
  now?: () => number;
};

/** Credentials and endpoint for one provider's token requests. */
export type OAuth2Client = {
  provider: string;
  tokenUrl: string;
  scope: string;
  clientId: string;
  clientSecret: string;
};

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

/**
 * Rejects as soon as `signal` aborts.
 *
 * Used to let one caller give up on a shared token request without cancelling it
 * for the other callers waiting on the same request.
 */
function abortRejection(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    const fail = (): void =>
      reject(
        new ProviderError("Token request was cancelled by the caller.", {
          cause: signal.reason,
        }),
      );
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

/**
 * Acquires and caches bearer tokens for providers using the client-credentials
 * grant.
 *
 * One store is created per {@link HttpClient}, and holds
 * one cache entry and at most one in-flight request per provider.
 *
 * @internal
 */
export class OAuth2TokenStore {
  readonly #fetch: typeof globalThis.fetch;
  readonly #timeoutMs: number;
  readonly #now: () => number;
  readonly #tokens = new Map<string, CachedToken>();
  /**
   * In-flight token requests, keyed by provider.
   *
   * This is the single-flight guarantee: concurrent data requests for the same
   * provider await one shared token request instead of each starting their own,
   * which would burn the provider's token budget and could rotate a token out
   * from under a request that had just received it.
   */
  readonly #inFlight = new Map<string, Promise<string>>();

  constructor(options: OAuth2TokenStoreOptions) {
    this.#fetch = options.fetch;
    this.#timeoutMs = options.timeoutMs;
    this.#now = options.now ?? (() => Date.now());
  }

  /**
   * Returns a valid bearer token for one provider, acquiring one if the cached
   * token is absent or close to expiring.
   *
   * Aborting `signal` rejects this call only. A token request shared with other
   * callers keeps running for them, because one consumer cancelling its stream
   * is not a reason to fail every other in-flight request.
   */
  async token(client: OAuth2Client, signal?: AbortSignal): Promise<string> {
    if (isAborted(signal)) {
      throw new ProviderError(`${client.provider} token request was cancelled by the caller.`, {
        provider: client.provider,
        cause: signal?.reason,
      });
    }

    const cached = this.#tokens.get(client.provider);
    if (cached !== undefined && cached.expiresAtMs > this.#now()) return cached.accessToken;

    const pending = this.#inFlight.get(client.provider) ?? this.#start(client);
    if (signal === undefined) return pending;
    // Race, rather than passing the signal into the shared request, so this
    // caller's cancellation cannot cancel a request the others still need.
    return Promise.race([pending, abortRejection(signal)]);
  }

  /** Discards a provider's cached token, forcing the next call to acquire one. */
  forget(provider: string): void {
    this.#tokens.delete(provider);
  }

  #start(client: OAuth2Client): Promise<string> {
    const request = this.#requestToken(client)
      .then((token) => {
        this.#tokens.set(client.provider, token);
        return token.accessToken;
      })
      .finally(() => {
        // Cleared on success and on failure alike: keeping a rejected promise
        // would make one transient token failure permanent for this instance.
        this.#inFlight.delete(client.provider);
      });
    this.#inFlight.set(client.provider, request);
    return request;
  }

  async #requestToken(client: OAuth2Client): Promise<CachedToken> {
    // `client_secret_post` is used rather than HTTP Basic because it is the
    // method BarentsWatch documents, and every issuer supporting the
    // client-credentials grant accepts it.
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scope: client.scope,
    });

    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(client.tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) {
        throw new RequestTimeoutError(
          `${client.provider} token request timed out after ${this.#timeoutMs}ms.`,
          { provider: client.provider },
        );
      }
      // The original error is deliberately not attached as a cause: a failed fetch
      // can carry the request, and therefore the secret, on its own `cause` chain.
      throw new ProviderError(`${client.provider} token request failed due to a network error.`, {
        provider: client.provider,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) throw tokenRequestError(client.provider, response);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ResponseValidationError(
        `${client.provider} returned an unreadable token response.`,
        { provider: client.provider, statusCode: response.status },
      );
    }
    const parsed = tokenResponseSchema.safeParse(payload);
    if (!parsed.success) {
      // The validation issues are attached, but never the payload: a token
      // response body contains the token itself.
      throw new ResponseValidationError(
        `${client.provider} returned a token response with an unexpected structure.`,
        {
          provider: client.provider,
          statusCode: response.status,
          cause: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            code: issue.code,
          })),
        },
      );
    }

    const lifetimeMs = (parsed.data.expires_in ?? 0) * 1_000;
    return {
      accessToken: parsed.data.access_token,
      expiresAtMs: this.#now() + Math.max(lifetimeMs - EXPIRY_SKEW_MS, MINIMUM_LIFETIME_MS),
    };
  }
}

/**
 * Classifies a failed token request.
 *
 * The response body is never read. An OAuth2 error response carries
 * `error_description` text that issuers populate freely, and echoing it risks
 * repeating the submitted client id -- which contains the caller's account
 * name -- back into an error message and any log that records it.
 */
function tokenRequestError(provider: string, response: Response): Error {
  if (CREDENTIAL_REJECTED_STATUS_CODES.has(response.status)) {
    return new ConfigurationError(
      `${provider} rejected the configured client credentials with HTTP ${response.status}. Check credentials.${provider}.clientId and clientSecret, and that the client is registered for this API.`,
      { provider, statusCode: response.status },
    );
  }
  if (response.status === 429) {
    return new RateLimitError(`${provider} rate limited the token request.`, {
      provider,
      statusCode: 429,
    });
  }
  return new ProviderError(`${provider} token request returned HTTP ${response.status}.`, {
    provider,
    statusCode: response.status,
  });
}
