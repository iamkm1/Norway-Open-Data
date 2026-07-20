import { vi } from "vitest";

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
