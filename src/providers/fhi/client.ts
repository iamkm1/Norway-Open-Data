import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { flattenJsonStat, type JsonStatContext } from "../../core/json-stat.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  fhiJsonStatSchema,
  sourceListSchema,
  tableDimensionsSchema,
  tableListSchema,
  tableMetadataSchema,
  type RawDimensionCategory,
  type RawFhiJsonStat,
} from "./schemas.js";
import type {
  HealthDimension,
  HealthDimensionValue,
  HealthJsonStatDataset,
  HealthStatisticsQuery,
  HealthStatisticsResult,
  HealthStatisticsRow,
  HealthStatisticsSource,
  HealthStatisticsTable,
  HealthTableDimensions,
  HealthTableMetadata,
} from "./types.js";

const BASE_URL = "https://statistikk-data.fhi.no/api/open/v1";
const SOURCE_TTL_MS = 24 * 60 * 60 * 1_000;
const TABLE_LIST_TTL_MS = 6 * 60 * 60 * 1_000;
const METADATA_TTL_MS = 24 * 60 * 60 * 1_000;
const QUERY_TTL_MS = 60 * 60 * 1_000;

const FHI_CONTEXT: JsonStatContext = { provider: "fhi", label: "FHI" };

/** Source ids are URL path segments, so only plain identifier characters pass. */
const sourceIdSchema = z
  .string()
  .regex(/^[a-z0-9_-]{1,50}$/i, "FHI source ids contain letters, digits, dashes or underscores.");
const tableIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const querySchema = z.object({
  source: sourceIdSchema,
  tableId: tableIdSchema,
  selections: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
  maxRowCount: z.number().int().positive().max(1_000_000).optional(),
});

function invalidInput(message: string, cause: unknown): InputValidationError {
  return new InputValidationError(message, { provider: "fhi", cause });
}

function normalizeCategory(category: RawDimensionCategory): HealthDimensionValue {
  const children = (category.children ?? []).map(normalizeCategory);
  return {
    code: category.value,
    ...(category.label === undefined || category.label === null ? {} : { label: category.label }),
    ...(children.length === 0 ? {} : { children }),
  };
}

function flattenValueCodes(values: HealthDimensionValue[], into: Set<string>): Set<string> {
  for (const value of values) {
    into.add(value.code);
    if (value.children !== undefined) flattenValueCodes(value.children, into);
  }
  return into;
}

function validateSelections(query: HealthStatisticsQuery, dimensions: HealthDimension[]): void {
  const byCode = new Map(dimensions.map((dimension) => [dimension.code, dimension]));
  for (const [code, values] of Object.entries(query.selections)) {
    const dimension = byCode.get(code);
    if (dimension === undefined) {
      throw new InputValidationError(
        `FHI table ${query.tableId} in source ${query.source} has no dimension "${code}".`,
        { provider: "fhi" },
      );
    }
    if (values.includes("*")) continue;
    const known = flattenValueCodes(dimension.values, new Set());
    for (const value of values) {
      if (!known.has(value)) {
        throw new InputValidationError(`FHI dimension "${code}" has no value code "${value}".`, {
          provider: "fhi",
        });
      }
    }
  }
}

function normalizeResult(
  query: HealthStatisticsQuery,
  dataset: RawFhiJsonStat,
): HealthStatisticsResult {
  const { dimensions, cells } = flattenJsonStat(dataset, FHI_CONTEXT);
  const rows: HealthStatisticsRow[] = cells.map((cell) => ({
    ...cell.coordinates,
    ...(typeof cell.observation === "string"
      ? { value: null, flag: cell.observation }
      : { value: cell.observation }),
  }));
  return {
    source: query.source,
    tableId: query.tableId,
    ...(dataset.label === undefined || dataset.label === null ? {} : { title: dataset.label }),
    ...(dataset.updated === undefined || dataset.updated === null
      ? {}
      : { updatedAt: dataset.updated }),
    dimensions,
    flags: { ...dataset.extension?.flags?.label },
    rows,
  };
}

/**
 * Client for the FHI Statistikk open API: statistics from Norwegian health
 * registers such as the Cause of Death Registry and the public-health profiles.
 *
 * FHI suppresses or cannot compute some observations, publishing a flag symbol
 * instead of a number. Normalized rows preserve those symbols in `flag` with
 * `value: null`, and each result carries the provider's flag legend. Flagged
 * cells must stay suppressed in downstream use.
 */
export class FhiClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists the registers and statistics banks publishing data through the API. */
  async getSources(options?: RequestOptions): Promise<OpenDataResponse<HealthStatisticsSource[]>> {
    const result = await this.#http.request({
      provider: "fhi",
      url: `${BASE_URL}/Common/source`,
      schema: sourceListSchema,
      options,
      cacheTtlMs: SOURCE_TTL_MS,
    });
    return createResponse(
      result.data.map((source) => ({
        id: source.id,
        title: source.title,
        ...(source.description === undefined || source.description === null
          ? {}
          : { description: source.description }),
        ...(source.aboutUrl === undefined || source.aboutUrl === null
          ? {}
          : { aboutUrl: source.aboutUrl }),
        ...(source.publishedBy === undefined || source.publishedBy === null
          ? {}
          : { publishedBy: source.publishedBy }),
      })),
      responseSource(providers.fhi),
      result.data,
      result.cached,
      options,
    );
  }

  /** Lists the published tables of one source. */
  async getTables(
    source: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HealthStatisticsTable[]>> {
    const parsedSource = this.#parseSource(source);
    const result = await this.#http.request({
      provider: "fhi",
      url: `${BASE_URL}/${parsedSource}/table`,
      resourceDescription: `source ${parsedSource}`,
      schema: tableListSchema,
      options,
      cacheTtlMs: TABLE_LIST_TTL_MS,
    });
    return createResponse(
      result.data.map((table) => ({
        tableId: table.tableId,
        title: table.title,
        ...(table.publishedAt === undefined || table.publishedAt === null
          ? {}
          : { publishedAt: table.publishedAt }),
        ...(table.modifiedAt === undefined || table.modifiedAt === null
          ? {}
          : { modifiedAt: table.modifiedAt }),
      })),
      responseSource(providers.fhi),
      result.data,
      result.cached,
      options,
    );
  }

  /** Fetches the provider-authored descriptive documentation for one table. */
  async getTableMetadata(
    source: string,
    tableId: number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HealthTableMetadata>> {
    const parsedSource = this.#parseSource(source);
    const parsedTableId = this.#parseTableId(tableId);
    const result = await this.#http.request({
      provider: "fhi",
      url: `${BASE_URL}/${parsedSource}/table/${parsedTableId}/metadata`,
      resourceDescription: `table ${parsedTableId} in source ${parsedSource}`,
      schema: tableMetadataSchema,
      options,
      cacheTtlMs: METADATA_TTL_MS,
    });
    return createResponse(
      {
        source: parsedSource,
        tableId: parsedTableId,
        name: result.data.name,
        ...(result.data.isOfficialStatistics === undefined ||
        result.data.isOfficialStatistics === null
          ? {}
          : { isOfficialStatistics: result.data.isOfficialStatistics }),
        paragraphs: (result.data.paragraphs ?? []).map((paragraph) => ({
          ...(paragraph.header === undefined || paragraph.header === null
            ? {}
            : { header: paragraph.header }),
          ...(paragraph.content === undefined || paragraph.content === null
            ? {}
            : { content: paragraph.content }),
        })),
      },
      responseSource(providers.fhi),
      result.data,
      result.cached,
      options,
    );
  }

  /** Fetches the queryable dimensions of one table, preserving category hierarchy. */
  async getTableDimensions(
    source: string,
    tableId: number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HealthTableDimensions>> {
    const parsedSource = this.#parseSource(source);
    const parsedTableId = this.#parseTableId(tableId);
    const result = await this.#http.request({
      provider: "fhi",
      url: `${BASE_URL}/${parsedSource}/table/${parsedTableId}/dimension`,
      resourceDescription: `table ${parsedTableId} in source ${parsedSource}`,
      schema: tableDimensionsSchema,
      options,
      cacheTtlMs: METADATA_TTL_MS,
    });
    return createResponse(
      {
        source: parsedSource,
        tableId: parsedTableId,
        dimensions: result.data.dimensions.map((dimension) => ({
          code: dimension.code,
          ...(dimension.label === undefined || dimension.label === null
            ? {}
            : { label: dimension.label }),
          values: dimension.categories.map(normalizeCategory),
        })),
      },
      responseSource(providers.fhi),
      result.data,
      result.cached,
      options,
    );
  }

  /** Runs a validated selection query and flattens the JSON-stat2 cube into rows. */
  async query(
    query: HealthStatisticsQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HealthStatisticsResult>> {
    const parsed = this.#parseQuery(query);
    const raw = await this.#executeQuery(parsed, options);
    return createResponse(
      normalizeResult(parsed, raw.data),
      responseSource(providers.fhi),
      raw.data,
      raw.cached,
      options,
    );
  }

  /** Runs a validated selection query and returns FHI's JSON-stat2 dataset. */
  async queryRaw(
    query: HealthStatisticsQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HealthJsonStatDataset>> {
    const parsed = this.#parseQuery(query);
    const raw = await this.#executeQuery(parsed, options);
    return createResponse(
      raw.data as HealthJsonStatDataset,
      responseSource(providers.fhi),
      raw.data,
      raw.cached,
      options,
    );
  }

  #parseSource(source: string): string {
    const parsed = sourceIdSchema.safeParse(source);
    if (!parsed.success) throw invalidInput("Invalid FHI source id.", parsed.error);
    return parsed.data;
  }

  #parseTableId(tableId: number): number {
    const parsed = tableIdSchema.safeParse(tableId);
    if (!parsed.success) throw invalidInput("Invalid FHI table id.", parsed.error);
    return parsed.data;
  }

  #parseQuery(query: HealthStatisticsQuery): HealthStatisticsQuery {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) throw invalidInput("Invalid FHI statistics query.", parsed.error);
    return parsed.data;
  }

  async #executeQuery(
    query: HealthStatisticsQuery,
    options?: RequestOptions,
  ): Promise<{ data: RawFhiJsonStat; cached: boolean }> {
    const dimensionsResponse = await this.getTableDimensions(query.source, query.tableId, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    });
    validateSelections(query, dimensionsResponse.data.dimensions);
    return this.#http.request({
      provider: "fhi",
      url: `${BASE_URL}/${query.source}/table/${query.tableId}/data`,
      resourceDescription: `table ${query.tableId} in source ${query.source}`,
      method: "POST",
      body: {
        dimensions: Object.entries(query.selections).map(([code, values]) => ({
          code,
          filter: values.includes("*") ? "all" : "item",
          values: values.includes("*") ? ["*"] : values,
        })),
        response: {
          format: "json-stat2",
          ...(query.maxRowCount === undefined ? {} : { maxRowCount: query.maxRowCount }),
        },
      },
      schema: fhiJsonStatSchema,
      options,
      cacheTtlMs: QUERY_TTL_MS,
    });
  }
}
