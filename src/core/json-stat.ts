import { ResponseValidationError } from "./errors.js";

/**
 * Structural JSON-stat2 dataset shared by statistics providers. Cell values may
 * be numbers, provider flag symbols (strings) or null; providers narrow this
 * through their own response schemas.
 *
 * @internal
 */
export type JsonStatCube = {
  version: string;
  class: string;
  label?: string | null;
  updated?: string | null;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label?: string | null;
      category: {
        index: Record<string, number> | string[];
        label?: Record<string, string>;
      };
    }
  >;
  value: Array<number | string | null> | Record<string, number | string | null>;
  [key: string]: unknown;
};

/** Names the provider in JSON-stat validation errors. @internal */
export type JsonStatContext = {
  /** Provider registry id attached to thrown errors, e.g. `ssb`. */
  provider: string;
  /** Human label used in error messages, e.g. `SSB`. */
  label: string;
};

/** One JSON-stat dimension with its ordered category values. @internal */
export type JsonStatCubeDimension = {
  code: string;
  label?: string;
  values: Array<{ code: string; label?: string }>;
};

function orderedCodes(index: Record<string, number> | string[]): string[] {
  if (Array.isArray(index)) return index;
  return Object.entries(index)
    .sort(([, left], [, right]) => left - right)
    .map(([code]) => code);
}

/**
 * Validates JSON-stat2 structural invariants and returns the cube cell count.
 *
 * @internal
 */
export function validateJsonStatStructure(
  dataset: JsonStatCube,
  validateValues: boolean,
  context: JsonStatContext,
): number {
  if (dataset.version !== "2.0" || dataset.class !== "dataset") {
    throw new ResponseValidationError(`${context.label} returned a non-JSON-stat2 dataset.`, {
      provider: context.provider,
    });
  }
  if (dataset.id.length !== dataset.size.length || new Set(dataset.id).size !== dataset.id.length) {
    throw new ResponseValidationError(`${context.label} JSON-stat2 dimensions are inconsistent.`, {
      provider: context.provider,
    });
  }
  for (const [dimensionIndex, code] of dataset.id.entries()) {
    const dimension = dataset.dimension[code];
    if (dimension === undefined) {
      throw new ResponseValidationError(
        `${context.label} JSON-stat2 dimension "${code}" is missing.`,
        { provider: context.provider },
      );
    }
    const codes = orderedCodes(dimension.category.index);
    if (codes.length !== dataset.size[dimensionIndex] || new Set(codes).size !== codes.length) {
      throw new ResponseValidationError(
        `${context.label} JSON-stat2 dimension "${code}" has an inconsistent size.`,
        { provider: context.provider },
      );
    }
    if (!Array.isArray(dimension.category.index)) {
      const positions = Object.values(dimension.category.index).sort((left, right) => left - right);
      if (positions.some((position, index) => position !== index)) {
        throw new ResponseValidationError(
          `${context.label} JSON-stat2 dimension "${code}" has invalid category positions.`,
          { provider: context.provider },
        );
      }
    }
  }
  const cellCount = dataset.size.reduce((total, size) => total * size, 1);
  if (!Number.isSafeInteger(cellCount)) {
    throw new ResponseValidationError(
      `${context.label} JSON-stat2 cell count is not safe to process.`,
      { provider: context.provider },
    );
  }
  if (validateValues) {
    if (Array.isArray(dataset.value)) {
      if (dataset.value.length !== cellCount) {
        throw new ResponseValidationError(
          `${context.label} JSON-stat2 value count is inconsistent.`,
          { provider: context.provider },
        );
      }
    } else if (
      Object.keys(dataset.value).some(
        (offset) => !/^(?:0|[1-9]\d*)$/.test(offset) || Number(offset) >= cellCount,
      )
    ) {
      throw new ResponseValidationError(
        `${context.label} JSON-stat2 sparse value offsets are invalid.`,
        { provider: context.provider },
      );
    }
  }
  return cellCount;
}

/** Converts JSON-stat2 dimensions into their ordered metadata representation. @internal */
export function jsonStatCubeDimensions(
  dataset: JsonStatCube,
  context: JsonStatContext,
): JsonStatCubeDimension[] {
  return dataset.id.map((code) => {
    const dimension = dataset.dimension[code];
    if (dimension === undefined) {
      throw new ResponseValidationError(
        `${context.label} JSON-stat2 dimension "${code}" is missing.`,
        { provider: context.provider },
      );
    }
    return {
      code,
      ...(dimension.label === undefined || dimension.label === null
        ? {}
        : { label: dimension.label }),
      values: orderedCodes(dimension.category.index).map((valueCode) => ({
        code: valueCode,
        ...(dimension.category.label?.[valueCode] === undefined
          ? {}
          : { label: dimension.category.label[valueCode] }),
      })),
    };
  });
}

function observationAt(values: JsonStatCube["value"], offset: number): number | string | null {
  if (Array.isArray(values)) return values[offset] ?? null;
  return values[String(offset)] ?? null;
}

/**
 * Flattens a JSON-stat2 cube into one deterministic row-major cell per
 * dimension combination. The caller decides how each observation (a number, a
 * provider flag symbol, or null) becomes row fields.
 *
 * @internal
 */
export function flattenJsonStat(
  dataset: JsonStatCube,
  context: JsonStatContext,
): {
  dimensions: JsonStatCubeDimension[];
  cells: Array<{ coordinates: Record<string, string>; observation: number | string | null }>;
} {
  const cellCount = validateJsonStatStructure(dataset, true, context);
  const dimensions = jsonStatCubeDimensions(dataset, context);
  const cells: Array<{
    coordinates: Record<string, string>;
    observation: number | string | null;
  }> = [];
  for (let offset = 0; offset < cellCount; offset += 1) {
    const coordinates: Record<string, string> = {};
    let stride = cellCount;
    for (const [dimensionIndex, dimension] of dimensions.entries()) {
      const size = dataset.size[dimensionIndex] ?? 0;
      stride /= size;
      const valueIndex = Math.floor(offset / stride) % size;
      coordinates[dimension.code] = dimension.values[valueIndex]?.code ?? "";
    }
    cells.push({ coordinates, observation: observationAt(dataset.value, offset) });
  }
  return { dimensions, cells };
}
