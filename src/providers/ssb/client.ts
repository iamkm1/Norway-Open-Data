import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { ssbProvider } from "./provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { parseJsonStat, parseTableMetadata } from "./json-stat.js";
import { jsonStatSchema, type RawJsonStat } from "./schemas.js";
import type {
  JsonStatDataset,
  StatisticsQuery,
  StatisticsResult,
  StatisticsTableMetadata,
} from "./types.js";

const BASE_URL = "https://data.ssb.no/api/pxwebapi/v2";

const tableIdSchema = z.string().regex(/^\d{5}$/, "SSB table IDs contain five digits.");
const querySchema = z.object({
  tableId: tableIdSchema,
  selections: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
  language: z.enum(["en", "no"]).optional(),
});

function isExpression(value: string): boolean {
  return /[*?()[\]]/.test(value);
}

function validateSelections(query: StatisticsQuery, metadata: StatisticsTableMetadata): void {
  const dimensions = new Map(metadata.dimensions.map((dimension) => [dimension.code, dimension]));
  for (const [code, values] of Object.entries(query.selections)) {
    const dimension = dimensions.get(code);
    if (dimension === undefined) {
      throw new InputValidationError(`SSB table ${query.tableId} has no dimension "${code}".`, {
        provider: ssbProvider.id,
      });
    }
    const knownValues = new Set(dimension.values.map((value) => value.code));
    for (const value of values) {
      if (!isExpression(value) && !knownValues.has(value)) {
        throw new InputValidationError(`SSB dimension "${code}" has no value code "${value}".`, {
          provider: ssbProvider.id,
        });
      }
    }
  }
}

/** Client for Statistics Norway's current PxWeb API v2. */
export class SsbClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Fetches detailed JSON-stat2 metadata for an SSB table. */
  async getTableMetadata(
    tableId: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<StatisticsTableMetadata>> {
    const parsed = tableIdSchema.safeParse(tableId);
    if (!parsed.success) {
      throw new InputValidationError("Invalid SSB table ID.", {
        provider: ssbProvider.id,
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: ssbProvider,
      url: `${BASE_URL}/tables/${parsed.data}/metadata`,
      query: { lang: "en" },
      resourceDescription: `table ${parsed.data}`,
      schema: jsonStatSchema,
      transform: (data) => {
        parseTableMetadata(parsed.data, data as JsonStatDataset);
        return data;
      },
      options,
      cacheTtlMs: ssbProvider.cacheTtlMs.metadata,
    });
    return createResponse(
      parseTableMetadata(parsed.data, result.data as JsonStatDataset),
      responseSource(ssbProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Runs a validated SSB query and flattens the JSON-stat2 cube into rows. */
  async query(
    query: StatisticsQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<StatisticsResult>> {
    const raw = await this.#executeQuery(query, options);
    return createResponse(
      parseJsonStat(query.tableId, raw.data as JsonStatDataset),
      responseSource(ssbProvider),
      raw.data,
      raw.cached,
      options,
    );
  }

  /**
   * Runs a validated SSB query against table metadata the caller already holds.
   *
   * A composition that resolves a dimension value from the metadata -- the
   * municipality profile resolves a region there -- would otherwise pay for the
   * same document twice inside one call, against the tightest request budget any
   * supported provider documents.
   *
   * @internal
   */
  async queryWithMetadata(
    query: StatisticsQuery,
    metadata: StatisticsTableMetadata,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<StatisticsResult>> {
    const parsed = this.#parseQuery(query);
    if (metadata.tableId !== parsed.tableId) {
      throw new InputValidationError(
        `SSB metadata for table ${metadata.tableId} cannot validate a query for table ${parsed.tableId}.`,
        { provider: ssbProvider.id },
      );
    }
    const raw = await this.#requestQuery(parsed, metadata, options);
    return createResponse(
      parseJsonStat(parsed.tableId, raw.data as JsonStatDataset),
      responseSource(ssbProvider),
      raw.data,
      raw.cached,
      options,
    );
  }

  /** Runs a validated SSB query and returns the provider's JSON-stat2 dataset. */
  async queryRaw(
    query: StatisticsQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<JsonStatDataset>> {
    const raw = await this.#executeQuery(query, options);
    return createResponse(
      raw.data as JsonStatDataset,
      responseSource(ssbProvider),
      raw.data,
      raw.cached,
      options,
    );
  }

  #parseQuery(query: StatisticsQuery): StatisticsQuery {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new InputValidationError("Invalid SSB statistics query.", {
        provider: ssbProvider.id,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  async #executeQuery(
    query: StatisticsQuery,
    options?: RequestOptions,
  ): Promise<{ data: RawJsonStat; cached: boolean }> {
    const parsed = this.#parseQuery(query);
    const metadataResponse = await this.getTableMetadata(parsed.tableId, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    });
    return this.#requestQuery(parsed, metadataResponse.data, options);
  }

  async #requestQuery(
    query: StatisticsQuery,
    metadata: StatisticsTableMetadata,
    options?: RequestOptions,
  ): Promise<{ data: RawJsonStat; cached: boolean }> {
    validateSelections(query, metadata);
    return this.#http.request({
      provider: ssbProvider,
      url: `${BASE_URL}/tables/${query.tableId}/data`,
      resourceDescription: `table ${query.tableId}`,
      method: "POST",
      query: {
        lang: query.language ?? "no",
        outputFormat: "json-stat2",
      },
      body: {
        selection: Object.entries(query.selections).map(([variableCode, valueCodes]) => ({
          variableCode,
          valueCodes,
        })),
      },
      schema: jsonStatSchema,
      transform: (data) => {
        parseJsonStat(query.tableId, data as JsonStatDataset);
        return data;
      },
      options,
      cacheTtlMs: ssbProvider.cacheTtlMs.query,
    });
  }
}
