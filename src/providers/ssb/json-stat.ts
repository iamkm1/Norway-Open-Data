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

function validateJsonStatStructure(dataset: JsonStatDataset, validateValues: boolean): number {
  if (dataset.version !== "2.0" || dataset.class !== "dataset") {
    throw new ResponseValidationError("SSB returned a non-JSON-stat2 dataset.", {
      provider: "ssb",
    });
  }
  if (dataset.id.length !== dataset.size.length || new Set(dataset.id).size !== dataset.id.length) {
    throw new ResponseValidationError("SSB JSON-stat2 dimensions are inconsistent.", {
      provider: "ssb",
    });
  }
  for (const [dimensionIndex, code] of dataset.id.entries()) {
    const dimension = dataset.dimension[code];
    if (dimension === undefined) {
      throw new ResponseValidationError(`SSB JSON-stat2 dimension "${code}" is missing.`, {
        provider: "ssb",
      });
    }
    const codes = orderedCodes(dimension.category.index);
    if (codes.length !== dataset.size[dimensionIndex] || new Set(codes).size !== codes.length) {
      throw new ResponseValidationError(
        `SSB JSON-stat2 dimension "${code}" has an inconsistent size.`,
        { provider: "ssb" },
      );
    }
    if (!Array.isArray(dimension.category.index)) {
      const positions = Object.values(dimension.category.index).sort((left, right) => left - right);
      if (positions.some((position, index) => position !== index)) {
        throw new ResponseValidationError(
          `SSB JSON-stat2 dimension "${code}" has invalid category positions.`,
          { provider: "ssb" },
        );
      }
    }
  }
  const cellCount = dataset.size.reduce((total, size) => total * size, 1);
  if (!Number.isSafeInteger(cellCount)) {
    throw new ResponseValidationError("SSB JSON-stat2 cell count is not safe to process.", {
      provider: "ssb",
    });
  }
  if (validateValues) {
    if (Array.isArray(dataset.value)) {
      if (dataset.value.length !== cellCount) {
        throw new ResponseValidationError("SSB JSON-stat2 value count is inconsistent.", {
          provider: "ssb",
        });
      }
    } else if (
      Object.keys(dataset.value).some(
        (offset) => !/^(?:0|[1-9]\d*)$/.test(offset) || Number(offset) >= cellCount,
      )
    ) {
      throw new ResponseValidationError("SSB JSON-stat2 sparse value offsets are invalid.", {
        provider: "ssb",
      });
    }
  }
  return cellCount;
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
  validateJsonStatStructure(dataset, false);
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
  const cellCount = validateJsonStatStructure(dataset, true);
  const dimensions = jsonStatDimensions(dataset);
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
