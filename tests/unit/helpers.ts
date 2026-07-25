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

/**
 * Wraps chunks in a `ReadableStream`, as a streaming `fetch` body would arrive.
 *
 * Chunks are handed out one per `read()` so a test controls exactly where the
 * boundaries fall. A string chunk is encoded as UTF-8; pass a `Uint8Array` to
 * split a multi-byte character deliberately.
 */
export function chunkedStream(
  chunks: readonly (string | Uint8Array)[],
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index++];
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(typeof next === "string" ? encoder.encode(next) : next);
    },
  });
}

/**
 * A `ReadableStream` that yields the given chunks and then errors.
 *
 * Models an upstream failure part-way through a live feed, which a stream must
 * surface rather than treat as a clean end.
 */
export function failingStream(
  chunks: readonly string[],
  failure: Error,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index++];
      if (next === undefined) {
        controller.error(failure);
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
  });
}

/**
 * A stream that reports whether its underlying source was cancelled.
 *
 * The parser releases the connection through the reader, which does not call
 * `ReadableStream.prototype.cancel`, so a spy on that method proves nothing. The
 * source's own `cancel` callback is the actual signal that the connection was
 * released.
 */
export function observableStream(chunks: readonly string[]): {
  body: ReadableStream<Uint8Array>;
  cancelled: () => boolean;
} {
  const encoder = new TextEncoder();
  let index = 0;
  let wasCancelled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index++];
      if (next === undefined) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(next));
    },
    cancel() {
      wasCancelled = true;
    },
  });
  return { body, cancelled: () => wasCancelled };
}

/** Creates a streaming NDJSON response for fetch mocks. */
export function ndjsonResponse(chunks: readonly (string | Uint8Array)[], status = 200): Response {
  return new Response(chunkedStream(chunks), {
    status,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

/** Collects an async iterable into an array, optionally stopping early. */
export async function collect<T>(source: AsyncIterable<T>, limit = Infinity): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
    if (items.length >= limit) break;
  }
  return items;
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
