/**
 * Core streaming and OAuth2 transport behaviour, exercised through
 * {@link HttpClient} directly rather than through a provider client.
 *
 * These are the paths a provider cannot easily reach: a connect timeout, a
 * bodyless stream response, a revoked token, and the shared request budget.
 */
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { HttpClient } from "../../src/core/client.js";
import {
  ConfigurationError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
} from "../../src/core/errors.js";
import { defineOAuth } from "../../src/core/oauth.js";
import type { ProviderDescriptor } from "../../src/core/provider.js";
import type { ResolvedConfig } from "../../src/core/types.js";
import { chunkedStream, collect, jsonResponse, resolvedConfig, testProvider } from "./helpers.js";

const recordSchema = z.object({ mmsi: z.number().int() });

/** A descriptor that streams and uses the client-credentials grant. */
const streamingProvider = {
  id: "test",
  name: "Streaming test provider",
  homepage: "https://example.test/",
  documentation: "https://example.test/docs",
  access: "registration-required",
  authentication: "OAuth2 client credentials.",
  oauth: defineOAuth({
    tokenUrl: "https://id.example.test/connect/token",
    scope: "test",
    missing: "Streaming test requests require credentials.test.clientId and clientSecret.",
  }),
  cacheTtlMs: { default: 60_000 },
} as const satisfies ProviderDescriptor;

/**
 * Credentials for the fictional `test` provider.
 *
 * `ProviderCredentials` is keyed by registered provider id, which is exactly the
 * guarantee the configuration schema exists to give real callers. This test uses a
 * descriptor that is not in the registry, so the cast is deliberate and confined
 * to here.
 */
const credentials = {
  test: { clientId: "developer@example.test:client", clientSecret: "test-client-secret-value" },
} as unknown as ResolvedConfig["credentials"];

function ndjson(chunks: readonly string[], status = 200): Response {
  return new Response(chunkedStream(chunks), {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function tokenResponse(accessToken = "stream-token"): Response {
  return jsonResponse({ access_token: accessToken, token_type: "Bearer", expires_in: 3600 });
}

describe("HttpClient.stream", () => {
  it("streams validated records from an anonymous provider", async () => {
    const fetch = vi.fn(async () =>
      ndjson(['{"mmsi":1}\n', '{"mmsi":2}\n']),
    ) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    const records = await collect(
      client.stream({
        provider: testProvider,
        url: "https://example.test/stream",
        schema: recordSchema,
      }),
    );
    expect(records).toEqual([{ mmsi: 1 }, { mmsi: 2 }]);
  });

  it("sends a POST body and the JSON content type", async () => {
    let captured: RequestInit | undefined;
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      captured = init;
      return ndjson(['{"mmsi":1}\n']);
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await collect(
      client.stream({
        provider: testProvider,
        url: "https://example.test/stream",
        method: "POST",
        body: { filter: true },
        schema: recordSchema,
      }),
    );
    expect(captured?.method).toBe("POST");
    expect(new Headers(captured?.headers).get("Content-Type")).toBe("application/json");
    expect(String(captured?.body)).toBe('{"filter":true}');
  });

  it("appends query parameters to the stream URL", async () => {
    let requested = "";
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      requested = String(url);
      return ndjson(['{"mmsi":1}\n']);
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await collect(
      client.stream({
        provider: testProvider,
        url: "https://example.test/stream",
        query: { since: "2026-07-24T00:00:00Z" },
        schema: recordSchema,
      }),
    );
    expect(new URL(requested).searchParams.get("since")).toBe("2026-07-24T00:00:00Z");
  });

  it("times out a stream that never sends response headers", async () => {
    const fetch = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    ) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { timeoutMs: 20 }));
    await expect(
      collect(
        client.stream({
          provider: testProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
        }),
      ),
    ).rejects.toBeInstanceOf(RequestTimeoutError);
  });

  it("does not apply the timeout to a stream that is already delivering", async () => {
    // A live feed is expected to stay open far longer than the request timeout,
    // so the timeout must bound connecting only.
    const encoder = new TextEncoder();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        pulls += 1;
        if (pulls > 3) {
          controller.close();
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 15));
        controller.enqueue(encoder.encode(`{"mmsi":${pulls}}\n`));
      },
    });
    const fetch = vi.fn(async () => new Response(body)) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { timeoutMs: 20 }));
    const records = await collect(
      client.stream({
        provider: testProvider,
        url: "https://example.test/stream",
        schema: recordSchema,
      }),
    );
    expect(records).toHaveLength(3);
  });

  it("reports a stream that opened with no body", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await expect(
      collect(
        client.stream({
          provider: testProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
        }),
      ),
    ).rejects.toThrow(/no body/);
  });

  it("reports a network failure while opening the stream", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await expect(
      collect(
        client.stream({
          provider: testProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
        }),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("maps a rate-limited stream open onto RateLimitError", async () => {
    const fetch = vi.fn(async () => ndjson([], 429)) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await expect(
      collect(
        client.stream({
          provider: testProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
        }),
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
  });

  it("waits for the provider's request budget before opening", async () => {
    const budgeted = {
      ...testProvider,
      rateLimit: {
        default: {
          requests: 1,
          intervalMs: 50,
          basis: "sdk-courtesy",
          note: "Test budget.",
        },
      },
    } as const satisfies ProviderDescriptor;
    const fetch = vi.fn(async () => ndjson(['{"mmsi":1}\n'])) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));
    const started = Date.now();
    await collect(
      client.stream({ provider: budgeted, url: "https://example.test/a", schema: recordSchema }),
    );
    await collect(
      client.stream({ provider: budgeted, url: "https://example.test/b", schema: recordSchema }),
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
  });

  it("stops a stream whose budget wait is cancelled", async () => {
    const budgeted = {
      ...testProvider,
      rateLimit: {
        default: {
          requests: 1,
          intervalMs: 1_000,
          basis: "sdk-courtesy",
          note: "Test budget.",
        },
      },
    } as const satisfies ProviderDescriptor;
    const fetch = vi.fn(async () => ndjson(['{"mmsi":1}\n'])) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { rateLimit: { enabled: true } }));
    await collect(
      client.stream({ provider: budgeted, url: "https://example.test/a", schema: recordSchema }),
    );
    const controller = new AbortController();
    const waiting = collect(
      client.stream({
        provider: budgeted,
        url: "https://example.test/b",
        schema: recordSchema,
        options: { signal: controller.signal },
      }),
    );
    controller.abort();
    await expect(waiting).rejects.toBeInstanceOf(ProviderError);
  });
});

describe("HttpClient with a client-credentials provider", () => {
  it("acquires a token before streaming and sends it as a bearer header", async () => {
    const headers: Headers[] = [];
    const fetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      headers.push(new Headers(init?.headers));
      return String(url).includes("connect/token") ? tokenResponse() : ndjson(['{"mmsi":1}\n']);
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { credentials }));
    await collect(
      client.stream({
        provider: streamingProvider,
        url: "https://example.test/stream",
        schema: recordSchema,
        authenticate: true,
      }),
    );
    expect(headers[1]?.get("Authorization")).toBe("Bearer stream-token");
  });

  it("refuses to open a stream without the provider's credentials", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Network access must not be attempted.");
    }) as unknown as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await expect(
      collect(
        client.stream({
          provider: streamingProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
          authenticate: true,
        }),
      ),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("keeps the bearer token out of a stream cancellation error", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("connect/token")
        ? tokenResponse("secret-stream-token")
        : ndjson(['{"mmsi":1}\n', '{"mmsi":2}\n']),
    ) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { credentials }));
    const controller = new AbortController();
    let caught: unknown;
    try {
      for await (const record of client.stream({
        provider: streamingProvider,
        url: "https://example.test/stream",
        schema: recordSchema,
        authenticate: true,
        options: { signal: controller.signal },
      })) {
        void record;
        controller.abort();
      }
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    const serialized = `${String(caught)}|${JSON.stringify(caught)}`;
    expect(serialized).not.toContain("secret-stream-token");
    expect(serialized).not.toContain("test-client-secret-value");
  });

  it("discards a token the provider rejected so the next request acquires a new one", async () => {
    let issued = 0;
    let requests = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("connect/token")) {
        issued += 1;
        return tokenResponse(`token-${issued}`);
      }
      requests += 1;
      // The first data request is refused as if the token had been revoked.
      return requests === 1 ? jsonResponse({}, 401) : jsonResponse({ mmsi: 1 });
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { credentials }));

    await expect(
      client.request({
        provider: streamingProvider,
        url: "https://example.test/data",
        schema: recordSchema,
        authenticate: true,
      }),
    ).rejects.toBeInstanceOf(ProviderError);

    await expect(
      client.request({
        provider: streamingProvider,
        url: "https://example.test/data",
        schema: recordSchema,
        authenticate: true,
      }),
    ).resolves.toMatchObject({ data: { mmsi: 1 } });
    // A revoked token is not replayed until the process restarts.
    expect(issued).toBe(2);
  });

  it("does not spend a token request on a cache hit", async () => {
    let issued = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("connect/token")) {
        issued += 1;
        return tokenResponse();
      }
      return jsonResponse({ mmsi: 1 });
    }) as typeof globalThis.fetch;
    const client = new HttpClient(
      resolvedConfig(fetch, { credentials, cache: { enabled: true, maxEntries: 10 } }),
    );
    const send = (): Promise<{ cached: boolean }> =>
      client.request({
        provider: streamingProvider,
        url: "https://example.test/data",
        schema: recordSchema,
        authenticate: true,
        cacheTtlMs: 60_000,
      });
    await send();
    const cached = await send();
    expect(cached.cached).toBe(true);
    expect(issued).toBe(1);
  });

  it("discards a 401 on a stream open too", async () => {
    let issued = 0;
    const fetch = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("connect/token")) {
        issued += 1;
        return tokenResponse(`token-${issued}`);
      }
      return ndjson([], 401);
    }) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch, { credentials }));
    const open = (): Promise<unknown[]> =>
      collect(
        client.stream({
          provider: streamingProvider,
          url: "https://example.test/stream",
          schema: recordSchema,
          authenticate: true,
        }),
      );
    await expect(open()).rejects.toBeInstanceOf(ProviderError);
    await expect(open()).rejects.toBeInstanceOf(ProviderError);
    expect(issued).toBe(2);
  });
});

describe("HTTP 204 handling", () => {
  it("hands an empty body to the schema as null", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    const response = await client.request({
      provider: testProvider,
      url: "https://example.test/maybe",
      schema: recordSchema.nullable(),
    });
    expect(response.data).toBeNull();
  });

  it("still rejects a 204 for an operation whose schema requires a value", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 204 })) as typeof globalThis.fetch;
    const client = new HttpClient(resolvedConfig(fetch));
    await expect(
      client.request({
        provider: testProvider,
        url: "https://example.test/required",
        schema: recordSchema,
      }),
    ).rejects.toThrow(/unexpected structure/);
  });
});
