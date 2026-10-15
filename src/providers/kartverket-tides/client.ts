import { z } from "zod";

import { createResponse, type HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { days, formatUtcMinute, parseTimeWindow } from "../../core/time-window.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  parseLocationData,
  parseLocationLevels,
  parseStations,
  parseTideDocument,
  serviceMessages,
  tideEvents,
} from "./parse.js";
import { kartverketTidesProvider as provider } from "./provider.js";
import type {
  TideReferenceLevel,
  TideReferenceLevelParameters,
  TideReferenceLevels,
  TideStation,
  TideTable,
  TideTableParameters,
  WaterLevelParameters,
  WaterLevels,
} from "./types.js";

const API_URL = "https://vannstand.kartverket.no/tideapi.php";

const REFERENCE_CODES: Readonly<Record<TideReferenceLevel, string>> = {
  "chart-datum": "cd",
  "mean-sea-level": "msl",
  nn2000: "nn2000",
};

/** Longest window per request, kept well inside the provider's own 366-day cap. */
const MAX_WINDOW_DAYS = { 10: 7, 60: 31 } as const;
const MAX_TIDE_TABLE_DAYS = 366;

const positionSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  referenceLevel: z.enum(["chart-datum", "mean-sea-level", "nn2000"]).optional(),
  language: z.enum(["nb", "nn", "en"]).optional(),
});

const waterLevelSchema = positionSchema.extend({
  from: z.string(),
  to: z.string(),
  interval: z.union([z.literal(10), z.literal(60)]).optional(),
});

const tideTableSchema = positionSchema.extend({ from: z.string(), to: z.string() });

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function parseParameters<T>(schema: z.ZodType<T>, parameters: unknown, label: string): T {
  const parsed = schema.safeParse(parameters);
  if (!parsed.success) {
    throw new InputValidationError(`Invalid Kartverket ${label} parameters.`, {
      provider: provider.id,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function positionQuery(
  parameters: z.infer<typeof positionSchema>,
): Record<string, string | number> {
  return {
    lat: roundCoordinate(parameters.latitude),
    lon: roundCoordinate(parameters.longitude),
    refcode: REFERENCE_CODES[parameters.referenceLevel ?? "chart-datum"],
    lang: parameters.language ?? "nb",
  };
}

/**
 * Client for Kartverket's water-level and tide API.
 *
 * Covers the Norwegian coast and the waters around Svalbard. Methods that take
 * a position resolve to `undefined` when Kartverket has no sea-level data for it,
 * which is the normal answer inland and far offshore. Times are requested and
 * returned in UTC.
 */
export class TidesClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Lists Kartverket's permanent tide gauges. */
  async listStations(options?: RequestOptions): Promise<OpenDataResponse<TideStation[]>> {
    const result = await this.#request(
      { tide_request: "stationlist", type: "perm" },
      provider.cacheTtlMs.stations,
      "station list",
      options,
    );
    return createResponse(
      parseStations(parseTideDocument(result.data)),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns observed, predicted, weather-effect and forecast water levels for a
   * position and window.
   *
   * Values are measurements only at a permanent gauge; elsewhere they are modelled
   * from a reference station, as `location` explains. Forecast values carry an
   * uncertainty band.
   */
  async getWaterLevels(
    parameters: WaterLevelParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WaterLevels | undefined>> {
    const parsed = parseParameters(waterLevelSchema, parameters, "water-level");
    const interval = parsed.interval ?? 60;
    const window = parseTimeWindow(parsed, {
      provider: provider.id,
      maxDurationMs: days(MAX_WINDOW_DAYS[interval]),
    });
    const result = await this.#request(
      {
        tide_request: "locationdata",
        ...positionQuery(parsed),
        fromtime: formatUtcMinute(window.from, "floor"),
        totime: formatUtcMinute(window.to, "ceil"),
        datatype: "all",
        interval,
        dst: 0,
        tzone: 0,
        uncertainty: 1,
      },
      provider.cacheTtlMs.waterLevels,
      "water levels",
      options,
    );
    const root = parseTideDocument(result.data);
    const data = parseLocationData(root);
    return createResponse(
      data === undefined
        ? undefined
        : {
            location: data.location,
            referenceLevel: data.referenceLevel,
            serviceMessages: serviceMessages(root),
            series: data.series,
          },
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Returns predicted high and low waters for a position and window of up to 366 days. */
  async getTideTable(
    parameters: TideTableParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<TideTable | undefined>> {
    const parsed = parseParameters(tideTableSchema, parameters, "tide-table");
    const window = parseTimeWindow(parsed, {
      provider: provider.id,
      maxDurationMs: days(MAX_TIDE_TABLE_DAYS),
    });
    const result = await this.#request(
      {
        tide_request: "locationdata",
        ...positionQuery(parsed),
        fromtime: formatUtcMinute(window.from, "floor"),
        totime: formatUtcMinute(window.to, "ceil"),
        datatype: "tab",
        dst: 0,
        tzone: 0,
      },
      provider.cacheTtlMs.tideTable,
      "tide table",
      options,
    );
    const root = parseTideDocument(result.data);
    const data = parseLocationData(root);
    if (data === undefined) {
      return createResponse(
        undefined,
        responseSource(provider),
        result.data,
        result.cached,
        options,
      );
    }
    const { unit, events } = tideEvents(data.series);
    return createResponse(
      {
        location: data.location,
        referenceLevel: data.referenceLevel,
        unit,
        serviceMessages: serviceMessages(root),
        events,
      },
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns every level Kartverket defines at a position: reference datums,
   * astronomical tide levels, observed extremes and statistical return levels.
   */
  async getReferenceLevels(
    parameters: TideReferenceLevelParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<TideReferenceLevels | undefined>> {
    const parsed = parseParameters(positionSchema, parameters, "reference-level");
    const result = await this.#request(
      { tide_request: "locationlevels", ...positionQuery(parsed) },
      provider.cacheTtlMs.levels,
      "reference levels",
      options,
    );
    const root = parseTideDocument(result.data);
    const levels = parseLocationLevels(root);
    return createResponse(
      levels === undefined ? undefined : { ...levels, serviceMessages: serviceMessages(root) },
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  #request(
    query: Record<string, string | number>,
    cacheTtlMs: number,
    resourceDescription: string,
    options: RequestOptions | undefined,
  ): Promise<{ data: string; cached: boolean }> {
    return this.#http.request({
      provider,
      url: API_URL,
      query,
      headers: { Accept: "application/xml, text/xml" },
      responseType: "text",
      schema: z.string().min(1),
      options,
      cacheTtlMs,
      resourceDescription,
    });
  }
}
