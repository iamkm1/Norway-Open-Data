import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../src/core/errors.js";
import {
  jsonStatDimensions,
  parseJsonStat,
  parseTableMetadata,
} from "../../src/providers/ssb/json-stat.js";
import type { JsonStatDataset } from "../../src/providers/ssb/types.js";

function baseDataset(): JsonStatDataset {
  return {
    version: "2.0",
    class: "dataset",
    label: "Test",
    updated: "2026-01-01T00:00:00Z",
    id: ["A", "B"],
    size: [2, 2],
    dimension: {
      A: { category: { index: { a0: 0, a1: 1 } } },
      B: { category: { index: { b0: 0, b1: 1 } } },
    },
    value: [1, 2, 3, 4],
  } as unknown as JsonStatDataset;
}

describe("parseJsonStat validation", () => {
  it("rejects an array value whose length does not match the cell count", () => {
    expect(() =>
      parseJsonStat("t", { ...baseDataset(), value: [1] } as unknown as JsonStatDataset),
    ).toThrow(ResponseValidationError);
  });

  it("reads a sparse object value and fills missing offsets with null", () => {
    const result = parseJsonStat("t", {
      ...baseDataset(),
      value: { "0": 10, "3": 40 },
    } as unknown as JsonStatDataset);
    expect(result.rows.map((row) => row["value"])).toEqual([10, null, null, 40]);
  });

  it("rejects sparse value offsets outside the cell range", () => {
    expect(() =>
      parseJsonStat("t", { ...baseDataset(), value: { "99": 1 } } as unknown as JsonStatDataset),
    ).toThrow(/sparse value offsets/);
  });

  it("rejects non-numeric sparse value offsets", () => {
    expect(() =>
      parseJsonStat("t", { ...baseDataset(), value: { x: 1 } } as unknown as JsonStatDataset),
    ).toThrow(ResponseValidationError);
  });

  it("rejects an unsafe cell count", () => {
    const ids = Array.from({ length: 54 }, (_, index) => `D${index}`);
    const dimension = Object.fromEntries(
      ids.map((id) => [id, { category: { index: { [`${id}a`]: 0, [`${id}b`]: 1 } } }]),
    );
    const dataset = {
      version: "2.0",
      class: "dataset",
      id: ids,
      size: ids.map(() => 2),
      dimension,
      value: [],
    } as unknown as JsonStatDataset;
    expect(() => parseTableMetadata("t", dataset)).toThrow(/cell count is not safe/);
  });

  it("rejects non-sequential object category positions", () => {
    const dataset = {
      version: "2.0",
      class: "dataset",
      id: ["A"],
      size: [2],
      dimension: { A: { category: { index: { a: 0, b: 2 } } } },
      value: [],
    } as unknown as JsonStatDataset;
    expect(() => parseTableMetadata("t", dataset)).toThrow(/invalid category positions/);
  });

  it("builds metadata with title and update time", () => {
    const meta = parseTableMetadata("07459", baseDataset());
    expect(meta).toMatchObject({
      tableId: "07459",
      title: "Test",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(meta.dimensions).toHaveLength(2);
  });

  it("throws when a declared dimension is missing from the dimension map", () => {
    expect(() =>
      jsonStatDimensions({ id: ["Missing"], dimension: {} } as unknown as JsonStatDataset),
    ).toThrow(/dimension "Missing" is missing/);
  });

  it("rejects a non-JSON-stat2 dataset", () => {
    expect(() =>
      parseTableMetadata("t", { ...baseDataset(), version: "1.0" } as unknown as JsonStatDataset),
    ).toThrow(/non-JSON-stat2/);
    expect(() =>
      parseTableMetadata("t", { ...baseDataset(), class: "error" } as unknown as JsonStatDataset),
    ).toThrow(/non-JSON-stat2/);
  });

  it("rejects inconsistent dimension identifiers", () => {
    expect(() =>
      parseTableMetadata("t", { ...baseDataset(), id: ["A"] } as unknown as JsonStatDataset),
    ).toThrow(/dimensions are inconsistent/);
    expect(() =>
      parseTableMetadata("t", { ...baseDataset(), id: ["A", "A"] } as unknown as JsonStatDataset),
    ).toThrow(/dimensions are inconsistent/);
  });

  it("rejects a dimension whose category size is inconsistent", () => {
    expect(() =>
      parseTableMetadata("t", { ...baseDataset(), size: [3, 2] } as unknown as JsonStatDataset),
    ).toThrow(/inconsistent size/);
  });
});
