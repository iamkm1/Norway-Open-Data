import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ProviderError, ResponseValidationError } from "../../src/core/errors.js";
import { DEFAULT_MAX_RECORD_SIZE, parseNdjson } from "../../src/core/ndjson.js";
import { chunkedStream, collect, failingStream, observableStream } from "./helpers.js";

const recordSchema = z.object({ mmsi: z.number().int(), name: z.string().optional() });
type Record = z.infer<typeof recordSchema>;

function parse(
  chunks: readonly (string | Uint8Array)[],
  options: { signal?: AbortSignal; maxRecordSize?: number } = {},
): AsyncGenerator<Record, void, undefined> {
  return parseNdjson(chunkedStream(chunks), {
    schema: recordSchema,
    provider: "test",
    description: "test stream",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.maxRecordSize === undefined ? {} : { maxRecordSize: options.maxRecordSize }),
  });
}

describe("NDJSON parsing", () => {
  it("yields one record per chunk", async () => {
    const records = await collect(parse(['{"mmsi":1}\n', '{"mmsi":2}\n', '{"mmsi":3}\n']));
    expect(records).toEqual([{ mmsi: 1 }, { mmsi: 2 }, { mmsi: 3 }]);
  });

  it("yields several records contained in one chunk", async () => {
    const records = await collect(parse(['{"mmsi":1}\n{"mmsi":2}\n{"mmsi":3}\n']));
    expect(records).toEqual([{ mmsi: 1 }, { mmsi: 2 }, { mmsi: 3 }]);
  });

  it("reassembles a record split across chunk boundaries", async () => {
    const records = await collect(parse(['{"mm', 'si":1,"na', 'me":"Ka', 'ia"}', "\n"]));
    expect(records).toEqual([{ mmsi: 1, name: "Kaia" }]);
  });

  it("reassembles a multi-byte character split across chunks", async () => {
    // "Ærøy" encoded as UTF-8, cut in the middle of the Æ.
    const encoded = new TextEncoder().encode('{"mmsi":1,"name":"Ærøy"}\n');
    const records = await collect(parse([encoded.slice(0, 19), encoded.slice(19)]));
    expect(records).toEqual([{ mmsi: 1, name: "Ærøy" }]);
  });

  it("yields a final record that has no trailing newline", async () => {
    const records = await collect(parse(['{"mmsi":1}\n{"mmsi":2}']));
    expect(records).toEqual([{ mmsi: 1 }, { mmsi: 2 }]);
  });

  it("skips blank, whitespace-only and carriage-return line endings", async () => {
    const records = await collect(
      parse(["\n", "   \n", '{"mmsi":1}\r\n', "\r\n", '{"mmsi":2}\n', "\n"]),
    );
    expect(records).toEqual([{ mmsi: 1 }, { mmsi: 2 }]);
  });

  it("yields nothing for an empty stream", async () => {
    expect(await collect(parse([]))).toEqual([]);
    expect(await collect(parse(["\n\n\n"]))).toEqual([]);
  });

  it("rejects a record that is not valid JSON instead of skipping it", async () => {
    const stream = parse(['{"mmsi":1}\n', "not json\n", '{"mmsi":2}\n']);
    const seen: Record[] = [];
    await expect(
      (async () => {
        for await (const record of stream) seen.push(record);
      })(),
    ).rejects.toBeInstanceOf(ResponseValidationError);
    // The valid record before the bad one is still delivered; the stream stops
    // there rather than quietly continuing past a record it could not read.
    expect(seen).toEqual([{ mmsi: 1 }]);
  });

  it("rejects a record that does not match the schema instead of skipping it", async () => {
    const stream = parse(['{"mmsi":1}\n', '{"mmsi":"not-a-number"}\n']);
    const seen: Record[] = [];
    await expect(
      (async () => {
        for await (const record of stream) seen.push(record);
      })(),
    ).rejects.toBeInstanceOf(ResponseValidationError);
    expect(seen).toEqual([{ mmsi: 1 }]);
  });

  it("names the record position in a validation failure", async () => {
    await expect(collect(parse(['{"mmsi":1}\n', '{"mmsi":2}\n', "{bad}\n"]))).rejects.toThrow(
      /record 3/,
    );
  });

  it("rejects a record that exceeds the buffered-size limit", async () => {
    const oversized = `{"mmsi":1,"name":"${"x".repeat(200)}"`;
    await expect(collect(parse([oversized], { maxRecordSize: 64 }))).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    await expect(collect(parse([oversized], { maxRecordSize: 64 }))).rejects.toThrow(
      /64 characters/,
    );
  });

  it("does not reject a long record that is properly terminated", async () => {
    const name = "x".repeat(200);
    const records = await collect(parse([`{"mmsi":1,"name":"${name}"}\n`], { maxRecordSize: 512 }));
    expect(records).toEqual([{ mmsi: 1, name }]);
  });

  it("defaults the buffered-size limit to a bounded value", () => {
    expect(DEFAULT_MAX_RECORD_SIZE).toBeGreaterThan(0);
    expect(Number.isFinite(DEFAULT_MAX_RECORD_SIZE)).toBe(true);
  });

  it("surfaces an upstream failure part-way through the stream", async () => {
    const stream = parseNdjson(
      failingStream(['{"mmsi":1}\n', '{"mmsi":2}\n'], new Error("connection reset")),
      { schema: recordSchema, provider: "test", description: "test stream" },
    );
    const seen: Record[] = [];
    await expect(
      (async () => {
        for await (const record of stream) seen.push(record);
      })(),
    ).rejects.toThrow(/connection reset/);
    // Records received before the failure are not lost, and the failure is not
    // presented as a clean end of stream.
    expect(seen).toEqual([{ mmsi: 1 }, { mmsi: 2 }]);
  });

  it("releases the underlying stream when the consumer stops early", async () => {
    const { body, cancelled } = observableStream(['{"mmsi":1}\n', '{"mmsi":2}\n', '{"mmsi":3}\n']);
    const records = await collect(parseNdjson(body, { schema: recordSchema, provider: "test" }), 1);
    expect(records).toEqual([{ mmsi: 1 }]);
    // `break` out of `for await` runs the generator's finally block, which must
    // release the connection rather than leave it open.
    expect(cancelled()).toBe(true);
  });

  it("releases the underlying stream when a record fails validation", async () => {
    const { body, cancelled } = observableStream(["{bad}\n"]);
    await expect(
      collect(parseNdjson(body, { schema: recordSchema, provider: "test" })),
    ).rejects.toBeInstanceOf(ResponseValidationError);
    expect(cancelled()).toBe(true);
  });

  it("releases the underlying stream when the caller aborts", async () => {
    const controller = new AbortController();
    const { body, cancelled } = observableStream(['{"mmsi":1}\n', '{"mmsi":2}\n']);
    const stream = parseNdjson(body, {
      schema: recordSchema,
      provider: "test",
      signal: controller.signal,
    });
    await expect(
      (async () => {
        for await (const record of stream) {
          expect(record).toEqual({ mmsi: 1 });
          controller.abort();
        }
      })(),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(cancelled()).toBe(true);
  });

  it("rejects before reading when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const body = chunkedStream(['{"mmsi":1}\n']);
    const reader = vi.spyOn(body, "getReader");
    await expect(
      collect(
        parseNdjson(body, {
          schema: recordSchema,
          provider: "test",
          signal: controller.signal,
        }),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(reader).not.toHaveBeenCalled();
  });

  it("stops with a cancellation error when aborted mid-read", async () => {
    const controller = new AbortController();
    const seen: Record[] = [];
    const stream = parse(['{"mmsi":1}\n', '{"mmsi":2}\n', '{"mmsi":3}\n'], {
      signal: controller.signal,
    });
    await expect(
      (async () => {
        for await (const record of stream) {
          seen.push(record);
          // Abort while holding the first record, before the next read.
          if (seen.length === 1) controller.abort();
        }
      })(),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(seen).toEqual([{ mmsi: 1 }]);
  });

  it("names the provider and the stream in a cancellation error", async () => {
    const controller = new AbortController();
    controller.abort("caller stopped");
    let caught: unknown;
    try {
      await collect(parse(['{"mmsi":1}\n'], { signal: controller.signal }));
    } catch (error) {
      caught = error;
    }
    expect((caught as ProviderError).provider).toBe("test");
    expect((caught as ProviderError).message).toContain("test stream");
    expect((caught as ProviderError).cause).toBe("caller stopped");
  });

  it("preserves backpressure by reading only as records are consumed", async () => {
    let pulls = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 5) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(`{"mmsi":${pulls}}\n`));
      },
    });
    const stream = parseNdjson(body, { schema: recordSchema, provider: "test" });

    const first = await stream.next();
    expect(first.value).toEqual({ mmsi: 1 });
    // A generator that had eagerly drained the stream would show all five pulls
    // here. One chunk is fetched per requested record instead.
    expect(pulls).toBeLessThanOrEqual(2);
    await stream.return();
  });
});
