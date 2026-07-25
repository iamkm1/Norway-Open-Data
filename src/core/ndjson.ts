/**
 * Newline-delimited JSON parsing over a web `ReadableStream`.
 *
 * Built on `ReadableStream`, `TextDecoder` and `AbortSignal` only, so the same
 * code runs wherever `fetch` does. Nothing here imports a Node stream module.
 *
 * The parser is a generator, which is what makes it respect backpressure: a
 * chunk is pulled from the reader only when the consumer asks for the next
 * record, so a slow consumer slows the transport rather than filling memory.
 */
import { z } from "zod";

import { ProviderError, ResponseValidationError } from "./errors.js";

/**
 * Default cap on one buffered, not-yet-terminated record, counted in decoded
 * characters.
 *
 * A stream that never sends a newline would otherwise grow the buffer without
 * limit. One character is at least one UTF-8 byte, so this is also an effective
 * bound in bytes. A little over a million is far above any single AIS message and
 * still bounded.
 */
export const DEFAULT_MAX_RECORD_SIZE = 1_048_576;

/** Options for {@link parseNdjson}. */
export type NdjsonOptions<T> = {
  /** Validates every record independently. */
  schema: z.ZodType<T>;
  /** Provider id used in errors. */
  provider: string;
  /** Stops iteration and releases the stream when aborted. */
  signal?: AbortSignal;
  /**
   * Maximum number of decoded characters buffered for a single record before the
   * stream is rejected. Defaults to {@link DEFAULT_MAX_RECORD_SIZE}.
   */
  maxRecordSize?: number;
  /**
   * Describes the stream in error messages, e.g. `AIS position stream`.
   * Defaults to `stream`.
   */
  description?: string;
};

/**
 * Reads the signal through a function call.
 *
 * A direct `signal?.aborted === true` check would be narrowed by the compiler to
 * always-false after the first one, because `AbortSignal.aborted` is declared
 * readonly. It is not: it flips while this generator is suspended at an `await`,
 * which is precisely the case the later checks exist to catch.
 */
function aborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted ?? false;
}

function cancellation(provider: string, reason: unknown, description: string): ProviderError {
  return new ProviderError(`${provider} ${description} was cancelled by the caller.`, {
    provider,
    cause: reason,
  });
}

/**
 * Parses a newline-delimited JSON stream into validated records.
 *
 * Behaviour that a line-splitting one-liner tends to get wrong, and which is
 * covered by tests:
 *
 * - A record split across chunk boundaries is buffered until its newline
 *   arrives; multi-byte UTF-8 characters split across chunks are handled by the
 *   streaming decoder.
 * - Several records inside one chunk are all emitted.
 * - Blank and whitespace-only lines are skipped, including `\r\n` line endings.
 * - A final record with no trailing newline is emitted when the stream ends.
 * - Invalid JSON and schema-invalid records raise
 *   {@link ResponseValidationError}. Neither is skipped: a caller acting on
 *   vessel positions must not silently receive fewer than the provider sent.
 * - Leaving the loop early -- `break`, `return`, `throw`, or an aborted
 *   signal -- cancels the underlying stream in a `finally` block, so the socket
 *   is released rather than left open until the process exits.
 *
 * There is no automatic reconnection. A stream that the provider closes ends the
 * iteration; deciding whether and when to reopen it belongs to the caller, who
 * knows whether a gap in coverage is acceptable.
 */
export async function* parseNdjson<T>(
  body: ReadableStream<Uint8Array>,
  options: NdjsonOptions<T>,
): AsyncGenerator<T, void, undefined> {
  const { schema, provider, signal } = options;
  const description = options.description ?? "stream";
  const maxRecordSize = options.maxRecordSize ?? DEFAULT_MAX_RECORD_SIZE;
  if (aborted(signal)) throw cancellation(provider, signal?.reason, description);

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let emitted = 0;

  /** Validates one complete line, or returns nothing for a blank one. */
  const parseLine = (line: string): { value: T } | undefined => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return undefined;
    let payload: unknown;
    try {
      payload = JSON.parse(trimmed);
    } catch (cause) {
      throw new ResponseValidationError(
        `${provider} ${description} produced a record that is not valid JSON (record ${emitted + 1}).`,
        { provider, cause },
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ResponseValidationError(
        `${provider} ${description} produced a record with an unexpected structure (record ${emitted + 1}).`,
        { provider, cause: parsed.error },
      );
    }
    return { value: parsed.data };
  };

  try {
    for (;;) {
      if (aborted(signal)) throw cancellation(provider, signal?.reason, description);
      const { done, value } = await reader.read();
      if (done) break;
      // `stream: true` keeps a multi-byte character that straddles two chunks
      // intact instead of decoding it as replacement characters.
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const record = parseLine(line);
        if (record !== undefined) {
          emitted += 1;
          yield record.value;
          // Checked after the consumer resumes: a signal aborted while the
          // consumer held the value should stop the stream before the next read.
          if (aborted(signal)) throw cancellation(provider, signal?.reason, description);
        }
        newline = buffer.indexOf("\n");
      }

      if (buffer.length > maxRecordSize) {
        throw new ResponseValidationError(
          `${provider} ${description} buffered more than ${maxRecordSize} characters for a single record without a line break.`,
          { provider },
        );
      }
    }

    buffer += decoder.decode();
    const last = parseLine(buffer);
    if (last !== undefined) yield last.value;
  } finally {
    // Releases the connection whether iteration finished, threw, or the consumer
    // stopped early. `cancel` rejects if the stream is already errored, which is
    // not itself a failure worth replacing the original error with.
    try {
      await reader.cancel();
    } catch {
      /* the stream was already closed or errored */
    }
  }
}
