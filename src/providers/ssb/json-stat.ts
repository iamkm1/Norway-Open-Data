import {
  flattenJsonStat,
  jsonStatCubeDimensions,
  validateJsonStatStructure,
  type JsonStatContext,
} from "../../core/json-stat.js";
import type {
  JsonStatDataset,
  StatisticsDimension,
  StatisticsResult,
  StatisticsTableMetadata,
} from "./types.js";
import { ssbProvider } from "./provider.js";

const SSB_CONTEXT: JsonStatContext = { provider: ssbProvider.id, label: "SSB" };

/** Converts JSON-stat2 dimensions into the SDK metadata representation. */
export function jsonStatDimensions(dataset: JsonStatDataset): StatisticsDimension[] {
  return jsonStatCubeDimensions(dataset, SSB_CONTEXT);
}

/** Converts JSON-stat2 table metadata to a public metadata object. */
export function parseTableMetadata(
  tableId: string,
  dataset: JsonStatDataset,
): StatisticsTableMetadata {
  validateJsonStatStructure(dataset, false, SSB_CONTEXT);
  return {
    tableId,
    ...(dataset.label === undefined ? {} : { title: dataset.label }),
    ...(dataset.updated === undefined ? {} : { updatedAt: dataset.updated }),
    dimensions: jsonStatDimensions(dataset),
  };
}

/** Flattens an SSB JSON-stat2 multidimensional cube into deterministic rows. */
export function parseJsonStat(tableId: string, dataset: JsonStatDataset): StatisticsResult {
  const { dimensions, cells } = flattenJsonStat(dataset, SSB_CONTEXT);
  const rows = cells.map((cell) => ({
    ...cell.coordinates,
    // SSB's response schema restricts observations to numbers and nulls.
    value: typeof cell.observation === "number" ? cell.observation : null,
  }));
  return {
    tableId,
    ...(dataset.label === undefined ? {} : { title: dataset.label }),
    ...(dataset.updated === undefined ? {} : { updatedAt: dataset.updated }),
    dimensions,
    rows,
  };
}
