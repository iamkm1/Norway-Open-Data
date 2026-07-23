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

  async #executeQuery(
    query: StatisticsQuery,
    options?: RequestOptions,
  ): Promise<{ data: RawJsonStat; cached: boolean }> {
    const parsed = querySchema.safeParse(query);
    if (!parsed.success) {
      throw new InputValidationError("Invalid SSB statistics query.", {
        provider: ssbProvider.id,
        cause: parsed.error,
      });
    }
    const metadataResponse = await this.getTableMetadata(parsed.data.tableId, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    });
    validateSelections(parsed.data, metadataResponse.data);
    return this.#http.request({
      provider: ssbProvider,
      url: `${BASE_URL}/tables/${parsed.data.tableId}/data`,
      resourceDescription: `table ${parsed.data.tableId}`,
      method: "POST",
      query: {
        lang: parsed.data.language ?? "no",
        outputFormat: "json-stat2",
      },
      body: {
        selection: Object.entries(parsed.data.selections).map(([variableCode, valueCodes]) => ({
          variableCode,
          valueCodes,
        })),
      },
      schema: jsonStatSchema,
      transform: (data) => {
        parseJsonStat(parsed.data.tableId, data as JsonStatDataset);
        return data;
      },
      options,
      cacheTtlMs: ssbProvider.cacheTtlMs.query,
    });
  }
}
