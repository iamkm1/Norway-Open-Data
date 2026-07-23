import { vi } from "vitest";

import type { ProviderDescriptor } from "../../src/core/provider.js";
import type { ResolvedConfig } from "../../src/core/types.js";

/**
 * A minimal descriptor for exercising core HTTP behaviour without involving a
 * real provider. Deliberately declares no auth and no rate limit.
 */
export const testProvider = {
  id: "test",
  name: "Test provider",
  homepage: "https://example.test/",
  documentation: "https://example.test/docs",
  access: "open",
  authentication: "None.",
  cacheTtlMs: { default: 60_000 },
} as const satisfies ProviderDescriptor;

/**
 * Builds a resolved config for direct `HttpClient` construction.
 *
 * Rate limiting defaults to off so unit tests never wait on a request budget;
 * the limiter has its own dedicated tests.
 */
export function resolvedConfig(
  fetch: typeof globalThis.fetch,
  overrides: Partial<ResolvedConfig> = {},
): ResolvedConfig {
  return {
    timeoutMs: 1_000,
    retries: 0,
    fetch,
    cache: { enabled: false, maxEntries: 10 },
    rateLimit: { enabled: false },
    credentials: {},
    ...overrides,
  };
}

/** Creates a JSON response for fetch mocks. */
export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

/** Creates a fetch mock that returns responses in order. */
export function sequenceFetch(...responses: Array<Response | (() => Promise<Response>)>): {
  fetch: typeof globalThis.fetch;
  mock: ReturnType<typeof vi.fn>;
} {
  let index = 0;
  const mock = vi.fn(async () => {
    const next = responses[index++];
    if (next === undefined) throw new Error("Unexpected fetch call.");
    return typeof next === "function" ? next() : next.clone();
  });
  return { fetch: mock as typeof globalThis.fetch, mock };
}
