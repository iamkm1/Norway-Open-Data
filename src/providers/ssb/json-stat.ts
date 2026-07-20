import { ResponseValidationError } from "../../core/errors.js";
import type {
  JsonStatDataset,
  StatisticsDimension,
  StatisticsResult,
  StatisticsTableMetadata,
} from "./types.js";

function orderedCodes(index: Record<string, number> | string[]): string[] {
  if (Array.isArray(index)) return index;
  return Object.entries(index)
    .sort(([, left], [, right]) => left - right)
    .map(([code]) => code);
}

/** Converts JSON-stat2 dimensions into the SDK metadata representation. */
export function jsonStatDimensions(dataset: JsonStatDataset): StatisticsDimension[] {
  return dataset.id.map((code) => {
    const dimension = dataset.dimension[code];
    if (dimension === undefined) {
      throw new ResponseValidationError(`SSB JSON-stat2 dimension "${code}" is missing.`, {
        provider: "ssb",
      });
    }
    return {
      code,
      ...(dimension.label === undefined ? {} : { label: dimension.label }),
      values: orderedCodes(dimension.category.index).map((valueCode) => ({
        code: valueCode,
        ...(dimension.category.label?.[valueCode] === undefined
          ? {}
          : { label: dimension.category.label[valueCode] }),
      })),
    };
  });
}

/** Converts JSON-stat2 table metadata to a public metadata object. */
export function parseTableMetadata(
  tableId: string,
  dataset: JsonStatDataset,
): StatisticsTableMetadata {
  return {
    tableId,
    ...(dataset.label === undefined ? {} : { title: dataset.label }),
    ...(dataset.updated === undefined ? {} : { updatedAt: dataset.updated }),
    dimensions: jsonStatDimensions(dataset),
  };
}

function observationAt(values: JsonStatDataset["value"], offset: number): number | null {
  if (Array.isArray(values)) return values[offset] ?? null;
  return values[String(offset)] ?? null;
}

/** Flattens an SSB JSON-stat2 multidimensional cube into deterministic rows. */
export function parseJsonStat(tableId: string, dataset: JsonStatDataset): StatisticsResult {
  if (dataset.id.length !== dataset.size.length) {
    throw new ResponseValidationError("SSB JSON-stat2 id and size arrays have different lengths.", {
      provider: "ssb",
    });
  }
  const dimensions = jsonStatDimensions(dataset);
  for (const [index, dimension] of dimensions.entries()) {
    if (dimension.values.length !== dataset.size[index]) {
      throw new ResponseValidationError(
        `SSB JSON-stat2 dimension "${dimension.code}" has an inconsistent size.`,
        { provider: "ssb" },
      );
    }
  }
  const cellCount = dataset.size.reduce((total, size) => total * size, 1);
  const rows: Array<Record<string, string | number | null>> = [];
  for (let offset = 0; offset < cellCount; offset += 1) {
    const row: Record<string, string | number | null> = {};
    let stride = cellCount;
    for (const [dimensionIndex, dimension] of dimensions.entries()) {
      const size = dataset.size[dimensionIndex] ?? 0;
      stride /= size;
      const valueIndex = Math.floor(offset / stride) % size;
      row[dimension.code] = dimension.values[valueIndex]?.code ?? "";
    }
    row["value"] = observationAt(dataset.value, offset);
    rows.push(row);
  }
  return {
    tableId,
    ...(dataset.label === undefined ? {} : { title: dataset.label }),
    ...(dataset.updated === undefined ? {} : { updatedAt: dataset.updated }),
    dimensions,
    rows,
  };
}
