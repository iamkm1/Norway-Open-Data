import { describe, expect, it, vi } from "vitest";

import {
  ConfigurationError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import { defineOAuth, type OAuth2Client, OAuth2TokenStore } from "../../src/core/oauth.js";
import { jsonResponse } from "./helpers.js";

const client: OAuth2Client = {
  provider: "test-oauth",
  tokenUrl: "https://id.example.test/connect/token",
  scope: "ais",
  clientId: "developer@example.test:test-client",
  clientSecret: "test-client-secret-value",
};

function tokenStore(
  fetch: typeof globalThis.fetch,
  options: { now?: () => number; timeoutMs?: number } = {},
): OAuth2TokenStore {
  return new OAuth2TokenStore({
    fetch,
    timeoutMs: options.timeoutMs ?? 1_000,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
}

function tokenResponse(accessToken: string, expiresIn = 3_600): Response {
  return jsonResponse({ access_token: accessToken, token_type: "Bearer", expires_in: expiresIn });
}

describe("OAuth2 client credentials", () => {
  it("sends the documented form-encoded client-credentials body", async () => {
    const fetch = vi.fn(async () =>
      tokenResponse("first-token"),
    ) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);
    await expect(store.token(client)).resolves.toBe("first-token");

    const mock = vi.mocked(fetch);
    const [url, init] = mock.mock.calls[0] ?? [];
    expect(String(url)).toBe(client.tokenUrl);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = new URLSearchParams(String(init?.body));
    expect(Object.fromEntries(body)).toEqual({
      grant_type: "client_credentials",
      client_id: client.clientId,
      client_secret: client.clientSecret,
      scope: "ais",
    });
  });

  it("reuses a cached token instead of requesting another", async () => {
    const fetch = vi.fn(async () =>
      tokenResponse("cached-token"),
    ) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);
    expect(await store.token(client)).toBe("cached-token");
    expect(await store.token(client)).toBe("cached-token");
    expect(await store.token(client)).toBe("cached-token");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("refreshes before the stated expiry rather than after a request has failed", async () => {
    let issued = 0;
    const fetch = vi.fn(async () =>
      tokenResponse(`token-${(issued += 1)}`, 120),
    ) as unknown as typeof globalThis.fetch;
    let now = 1_000_000;
    const store = tokenStore(fetch, { now: () => now });

    expect(await store.token(client)).toBe("token-1");
    // Still inside the usable lifetime: 120s stated, 60s of skew subtracted.
    now += 30_000;
    expect(await store.token(client)).toBe("token-1");
    // Past the skew-adjusted expiry but before the provider's own 120s deadline,
    // which is exactly the window the headroom exists to cover.
    now += 40_000;
    expect(await store.token(client)).toBe("token-2");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("keeps a very short-lived token usable instead of refetching on every call", async () => {
    let issued = 0;
    const fetch = vi.fn(async () =>
      tokenResponse(`short-${(issued += 1)}`, 1),
    ) as unknown as typeof globalThis.fetch;
    let now = 0;
    const store = tokenStore(fetch, { now: () => now });
    expect(await store.token(client)).toBe("short-1");
    now += 1_000;
    // Subtracting the skew from a one-second lifetime would leave the token
    // already expired; the minimum lifetime keeps it in use for a moment.
    expect(await store.token(client)).toBe("short-1");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("collapses concurrent requests into one token request", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return tokenResponse("single-flight-token");
    }) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);

    const waiting = Promise.all([
      store.token(client),
      store.token(client),
      store.token(client),
      store.token(client),
    ]);
    release?.();
    await expect(waiting).resolves.toEqual([
      "single-flight-token",
      "single-flight-token",
      "single-flight-token",
      "single-flight-token",
    ]);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("keeps separate providers on separate tokens and separate requests", async () => {
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const scope = new URLSearchParams(String(init?.body)).get("scope");
      return tokenResponse(`${scope}-token`);
    }) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);
    const other: OAuth2Client = { ...client, provider: "other-oauth", scope: "api" };

    expect(await store.token(client)).toBe("ais-token");
    expect(await store.token(other)).toBe("api-token");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed token request rather than caching the failure", async () => {
    let attempt = 0;
    const fetch = vi.fn(async () => {
      attempt += 1;
      return attempt === 1 ? jsonResponse({}, 500) : tokenResponse("recovered-token");
    }) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);

    await expect(store.token(client)).rejects.toBeInstanceOf(ProviderError);
    await expect(store.token(client)).resolves.toBe("recovered-token");
  });

  it.each([
    [400, ConfigurationError],
    [401, ConfigurationError],
    [403, ConfigurationError],
    [429, RateLimitError],
    [500, ProviderError],
    [503, ProviderError],
  ] as const)("classifies HTTP %i from the token endpoint", async (status, expected) => {
    const fetch = vi.fn(async () => jsonResponse({}, status)) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch).token(client)).rejects.toBeInstanceOf(expected);
  });

  it("tells the caller which configuration keys to fix when credentials are rejected", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ error: "invalid_client" }, 401),
    ) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch).token(client)).rejects.toThrow(/clientId and clientSecret/);
  });

  it("reports a network failure as a provider error without a leaking cause", async () => {
    const fetch = vi.fn(async () => {
      // Node attaches the request, and therefore the body, to a fetch failure.
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    let caught: unknown;
    try {
      await tokenStore(fetch).token(client);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect((caught as ProviderError).cause).toBeUndefined();
  });

  it("times out a hanging token request", async () => {
    const fetch = vi.fn(
      async (_url: unknown, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    ) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch, { timeoutMs: 20 }).token(client)).rejects.toBeInstanceOf(
      RequestTimeoutError,
    );
  });

  it.each([
    { description: "no access token", payload: {} },
    { description: "an empty access token", payload: { access_token: "" } },
    { description: "a non-string access token", payload: { access_token: 42 } },
    {
      description: "an unsupported token type",
      payload: { access_token: "t", token_type: "mac" },
    },
    { description: "a negative lifetime", payload: { access_token: "t", expires_in: -5 } },
  ])("rejects a token response with $description", async ({ payload }) => {
    const fetch = vi.fn(async () => jsonResponse(payload)) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch).token(client)).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("accepts a lowercase token_type and a response with no stated lifetime", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({ access_token: "lenient-token", token_type: "bearer" }),
    ) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch).token(client)).resolves.toBe("lenient-token");
  });

  it("rejects an unreadable token response", async () => {
    const fetch = vi.fn(
      async () => new Response("not json", { headers: { "Content-Type": "application/json" } }),
    ) as unknown as typeof globalThis.fetch;
    await expect(tokenStore(fetch).token(client)).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("never puts the secret, the client id or the token into an error", async () => {
    const leaked = [client.clientSecret, client.clientId, "leaked-access-token"];
    const payloads: Response[] = [
      jsonResponse({ error_description: `bad secret ${client.clientSecret}` }, 401),
      jsonResponse({ error: `unknown client ${client.clientId}` }, 500),
      jsonResponse({ access_token: 1, echoed: client.clientSecret }),
    ];
    for (const payload of payloads) {
      const fetch = vi.fn(async () => payload.clone()) as unknown as typeof globalThis.fetch;
      let caught: unknown;
      try {
        await tokenStore(fetch).token(client);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      const serialized = `${String(caught)}|${JSON.stringify(caught)}|${JSON.stringify(
        (caught as Error).cause,
      )}`;
      for (const secret of leaked) expect(serialized).not.toContain(secret);
    }
  });

  it("rejects only the aborting caller and leaves the shared request intact", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetch = vi.fn(async () => {
      await gate;
      return tokenResponse("survivor-token");
    }) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);

    const controller = new AbortController();
    const abandoned = store.token(client, controller.signal);
    const patient = store.token(client);
    controller.abort();

    await expect(abandoned).rejects.toBeInstanceOf(ProviderError);
    release?.();
    // One consumer giving up must not fail the request the others are waiting on.
    await expect(patient).resolves.toBe("survivor-token");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("rejects immediately when the signal is already aborted", async () => {
    const fetch = vi.fn(async () => tokenResponse("unused")) as unknown as typeof globalThis.fetch;
    const controller = new AbortController();
    controller.abort();
    await expect(tokenStore(fetch).token(client, controller.signal)).rejects.toBeInstanceOf(
      ProviderError,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("acquires a new token after one is forgotten", async () => {
    let issued = 0;
    const fetch = vi.fn(async () =>
      tokenResponse(`token-${(issued += 1)}`),
    ) as unknown as typeof globalThis.fetch;
    const store = tokenStore(fetch);
    expect(await store.token(client)).toBe("token-1");
    store.forget(client.provider);
    expect(await store.token(client)).toBe("token-2");
    // Forgetting a provider that has no cached token is a no-op, not a failure.
    store.forget("never-used");
  });
});

describe("defineOAuth", () => {
  it("returns the declaration unchanged so a descriptor stays the single source", () => {
    const declaration = {
      tokenUrl: "https://id.example.test/connect/token",
      scope: "ais",
      missing: "Configure credentials.example.clientId and clientSecret.",
    };
    expect(defineOAuth(declaration)).toEqual(declaration);
  });
});
