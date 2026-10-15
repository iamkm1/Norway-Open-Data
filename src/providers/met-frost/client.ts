import { z } from "zod";

import { createResponse, type HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { days, formatUtcSecond, parseTimeWindow } from "../../core/time-window.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { metFrostProvider as provider } from "./provider.js";
import {
  climateNormalResponseSchema,
  observationResponseSchema,
  type RawObservationRecord,
  type RawSource,
  type RawTimeSeries,
  sourceResponseSchema,
  timeSeriesResponseSchema,
} from "./schemas.js";
import type {
  ClimateLatestObservationParameters,
  ClimateLevel,
  ClimateNormal,
  ClimateNormalParameters,
  ClimateObservationParameters,
  ClimateObservationRecord,
  ClimateStation,
  ClimateStationSearchParameters,
  ClimateTimeSeries,
  ClimateTimeSeriesParameters,
} from "./types.js";

const BASE_URL = "https://frost.met.no";
/** Frost's statuses for "nothing matches this query". */
const NO_DATA = { status: 404 };
const NO_TIME_SERIES = { status: 412 };
const MAX_WINDOW_DAYS = 31;
const MAX_DAILY_WINDOW_DAYS = 366;

const ISO_DURATION_PATTERN =
  /^P(?!$)(?:\d+Y)?(?:\d+M)?(?:\d+W)?(?:\d+D)?(?:T(?=\d)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/;
const durationSchema = z.string().regex(ISO_DURATION_PATTERN, "Expected an ISO-8601 duration.");
const stationIdSchema = z.string().regex(/^SN\d+$/, "Expected a Frost station ID such as SN18700.");
const sensorIdSchema = z
  .string()
  .regex(/^SN\d+(?::(?:\d+|all))?$/, "Expected a Frost station ID such as SN18700 or SN18700:0.");
// Element IDs can contain spaces and parentheses, but never the list separator.
const elementSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine((value) => !value.includes(","), "Element IDs may not contain commas.");
const filterSchema = z.string().trim().min(1).max(100);

const searchSchema = z
  .object({
    ids: z.array(stationIdSchema).min(1).max(100).optional(),
    name: filterSchema.optional(),
    municipality: filterSchema.optional(),
    county: filterSchema.optional(),
    elements: z.array(elementSchema).min(1).max(20).optional(),
    near: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        maxCount: z.number().int().min(1).max(100).optional(),
      })
      .optional(),
    activeOnly: z.boolean().optional(),
  })
  .refine(
    (value) =>
      [value.ids, value.name, value.municipality, value.county, value.elements, value.near].some(
        (filter) => filter !== undefined,
      ),
    { message: "Give at least one of ids, name, municipality, county, elements or near." },
  );

const timeSeriesSchema = z
  .object({
    stationIds: z.array(sensorIdSchema).min(1).max(10),
    elements: z.array(elementSchema).min(1).max(20).optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .refine((value) => (value.from === undefined) === (value.to === undefined), {
    message: "Give from and to together, or neither.",
    path: ["to"],
  });

const observationSchema = z.object({
  stationIds: z.array(sensorIdSchema).min(1).max(10),
  elements: z.array(elementSchema).min(1).max(20),
  from: z.string(),
  to: z.string(),
  timeResolutions: z.array(durationSchema).min(1).max(10).optional(),
  timeOffsets: z.union([z.literal("default"), z.array(durationSchema).min(1).max(10)]).optional(),
  levels: z.union([z.literal("default"), z.array(z.number()).min(1).max(10)]).optional(),
  qualities: z.array(z.number().int().min(0).max(9)).min(1).max(10).optional(),
});

const latestSchema = z.object({
  stationIds: z.array(sensorIdSchema).min(1).max(10),
  elements: z.array(elementSchema).min(1).max(20),
  maxAge: durationSchema.optional(),
});

const normalSchema = z.object({
  stationIds: z.array(stationIdSchema).min(1).max(10),
  elements: z.array(elementSchema).min(1).max(20).optional(),
  period: z
    .string()
    .regex(/^\d{4}\/\d{4}$/, "Expected a period such as 1991/2020.")
    .optional(),
});

function optional<K extends string, T>(key: K, value: T | null | undefined): Partial<Record<K, T>> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}

function parseParameters<T>(schema: z.ZodType<T>, parameters: unknown, label: string): T {
  const parsed = schema.safeParse(parameters);
  if (!parsed.success) {
    throw new InputValidationError(`Invalid Frost ${label} parameters.`, {
      provider: provider.id,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/** Whether a duration is a whole number of days or longer, with no time part. */
function isDailyOrCoarser(duration: string): boolean {
  return !duration.includes("T") && /[1-9]/.test(duration);
}

function coordinates(
  geometry: { coordinates: [number, number] } | undefined,
): Partial<Record<"coordinates", { latitude: number; longitude: number }>> {
  if (geometry === undefined) return {};
  const [longitude, latitude] = geometry.coordinates;
  return { coordinates: { latitude, longitude } };
}

function level(
  raw:
    | { levelType?: string | undefined; unit?: string | undefined; value?: number | undefined }
    | undefined,
): ClimateLevel | undefined {
  if (raw === undefined) return undefined;
  return {
    ...optional("type", raw.levelType),
    ...optional("unit", raw.unit),
    ...optional("value", raw.value),
  };
}

function normalizeStation(source: RawSource): ClimateStation {
  return {
    id: source.id,
    name: source.name,
    ...optional("shortName", source.shortName),
    ...optional("countryCode", source.countryCode),
    ...optional("wmoId", source.wmoId),
    ...optional("wigosId", source.wigosId),
    ...coordinates(source.geometry),
    ...optional("elevationMetres", source.masl),
    ...optional("distanceKm", source.distance),
    ...optional("validFrom", source.validFrom),
    ...optional("validTo", source.validTo),
    ...optional("county", source.county),
    ...optional("countyId", source.countyId),
    ...optional("municipality", source.municipality),
    ...optional("municipalityId", source.municipalityId),
    externalIds: source.externalIds ?? [],
    icaoCodes: source.icaoCodes ?? [],
  };
}

function normalizeTimeSeries(series: RawTimeSeries): ClimateTimeSeries {
  return {
    stationId: series.sourceId,
    elementId: series.elementId,
    ...optional("unit", series.unit),
    ...optional("timeResolution", series.timeResolution),
    ...optional("timeOffset", series.timeOffset),
    ...optional("level", level(series.level)),
    ...optional("validFrom", series.validFrom),
    ...optional("validTo", series.validTo),
    ...optional("timeSeriesId", series.timeSeriesId),
    ...optional("performanceCategory", series.performanceCategory),
    ...optional("exposureCategory", series.exposureCategory),
    ...optional("status", series.status),
    ...coordinates(series.geometry),
  };
}

function normalizeRecord(record: RawObservationRecord): ClimateObservationRecord {
  return {
    stationId: record.sourceId,
    referenceTime: record.referenceTime,
    ...coordinates(record.geometry),
    observations: record.observations.map((observation) => ({
      elementId: observation.elementId,
      value: observation.value,
      ...optional("unit", observation.unit),
      ...optional("codeTable", observation.codeTable),
      ...optional("level", level(observation.level)),
      ...optional("timeOffset", observation.timeOffset),
      ...optional("timeResolution", observation.timeResolution),
      ...optional("timeSeriesId", observation.timeSeriesId),
      ...optional("performanceCategory", observation.performanceCategory),
      ...optional("exposureCategory", observation.exposureCategory),
      ...optional("qualityCode", observation.qualityCode),
    })),
  };
}

/**
 * Client for MET Norway's Frost archive of weather observations and climate
 * statistics.
 *
 * Every method requires `credentials["met-frost"].clientId`, a free client ID
 * from Frost's self-service registration. A query that matches nothing resolves
 * to an empty array: Frost does not distinguish "no data for this station" from
 * "no such station", so neither does the SDK.
 */
export class ClimateClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Searches Frost's weather stations, including the nearest stations to a point. */
  async searchStations(
    parameters: ClimateStationSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ClimateStation[]>> {
    const parsed = parseParameters(searchSchema, parameters, "station search");
    const near = parsed.near;
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/sources/v0.jsonld`,
      query: {
        types: "SensorSystem",
        ids: parsed.ids?.join(","),
        name: parsed.name,
        municipality: parsed.municipality,
        county: parsed.county,
        elements: parsed.elements?.join(","),
        geometry:
          near === undefined
            ? undefined
            : `nearest(POINT(${roundCoordinate(near.longitude)} ${roundCoordinate(near.latitude)}))`,
        nearestmaxcount: near === undefined ? undefined : (near.maxCount ?? 1),
        validtime: parsed.activeOnly === true ? "now" : undefined,
      },
      authenticate: true,
      schema: sourceResponseSchema,
      absentResponses: [NO_DATA],
      options,
      cacheTtlMs: provider.cacheTtlMs.stations,
      resourceDescription: "stations",
    });
    return createResponse(
      (result.data?.data ?? []).map(normalizeStation),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Lists the time series Frost holds for stations and, optionally, elements. */
  async getAvailableTimeSeries(
    parameters: ClimateTimeSeriesParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ClimateTimeSeries[]>> {
    const parsed = parseParameters(timeSeriesSchema, parameters, "time-series");
    const window =
      parsed.from === undefined || parsed.to === undefined
        ? undefined
        : parseTimeWindow(
            { from: parsed.from, to: parsed.to },
            { provider: provider.id, maxDurationMs: Number.MAX_SAFE_INTEGER },
          );
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/observations/availableTimeSeries/v0.jsonld`,
      query: {
        sources: parsed.stationIds.join(","),
        elements: parsed.elements?.join(","),
        referencetime:
          window === undefined
            ? undefined
            : `${formatUtcSecond(window.from)}/${formatUtcSecond(window.to)}`,
      },
      authenticate: true,
      schema: timeSeriesResponseSchema,
      absentResponses: [NO_DATA],
      options,
      cacheTtlMs: provider.cacheTtlMs.timeSeries,
      resourceDescription: "available time series",
    });
    return createResponse(
      (result.data?.data ?? []).map(normalizeTimeSeries),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns observations for stations, elements and a window.
   *
   * The window may span at most 31 days, or 366 days when every requested time
   * resolution is daily or coarser. Frost's recommended default time offset and
   * sensor level are used unless overridden, which avoids near-duplicate
   * parallel series. Records keep Frost's reference time, offset and resolution
   * exactly as published.
   */
  async getObservations(
    parameters: ClimateObservationParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ClimateObservationRecord[]>> {
    const parsed = parseParameters(observationSchema, parameters, "observation");
    const daily = parsed.timeResolutions?.every(isDailyOrCoarser) === true;
    const window = parseTimeWindow(parsed, {
      provider: provider.id,
      maxDurationMs: days(daily ? MAX_DAILY_WINDOW_DAYS : MAX_WINDOW_DAYS),
    });
    const timeOffsets = parsed.timeOffsets ?? "default";
    const levels = parsed.levels ?? "default";
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/observations/v0.jsonld`,
      query: {
        sources: parsed.stationIds.join(","),
        elements: parsed.elements.join(","),
        referencetime: `${formatUtcSecond(window.from)}/${formatUtcSecond(window.to)}`,
        timeresolutions: parsed.timeResolutions?.join(","),
        timeoffsets: timeOffsets === "default" ? "default" : timeOffsets.join(","),
        levels: levels === "default" ? "default" : levels.join(","),
        qualities: parsed.qualities?.join(","),
      },
      authenticate: true,
      schema: observationResponseSchema,
      absentResponses: [NO_DATA, NO_TIME_SERIES],
      options,
      cacheTtlMs: provider.cacheTtlMs.observations,
      resourceDescription: "observations",
    });
    return createResponse(
      (result.data?.data ?? []).map(normalizeRecord),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Returns the most recent observation of each element at each station. */
  async getLatestObservations(
    parameters: ClimateLatestObservationParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ClimateObservationRecord[]>> {
    const parsed = parseParameters(latestSchema, parameters, "latest-observation");
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/observations/v0.jsonld`,
      query: {
        sources: parsed.stationIds.join(","),
        elements: parsed.elements.join(","),
        referencetime: "latest",
        maxage: parsed.maxAge ?? "PT3H",
        timeoffsets: "default",
        levels: "default",
      },
      authenticate: true,
      schema: observationResponseSchema,
      absentResponses: [NO_DATA, NO_TIME_SERIES],
      options,
      cacheTtlMs: provider.cacheTtlMs.latest,
      resourceDescription: "latest observations",
    });
    return createResponse(
      (result.data?.data ?? []).map(normalizeRecord),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Returns climate normals, such as 1991-2020 monthly means, for stations. */
  async getClimateNormals(
    parameters: ClimateNormalParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ClimateNormal[]>> {
    const parsed = parseParameters(normalSchema, parameters, "climate-normal");
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/climatenormals/v0.jsonld`,
      query: {
        sources: parsed.stationIds.join(","),
        elements: parsed.elements?.join(","),
        period: parsed.period,
      },
      authenticate: true,
      schema: climateNormalResponseSchema,
      absentResponses: [NO_DATA],
      options,
      cacheTtlMs: provider.cacheTtlMs.normals,
      resourceDescription: "climate normals",
    });
    return createResponse(
      (result.data?.data ?? []).map((normal) => ({
        stationId: normal.sourceId,
        elementId: normal.elementId,
        period: normal.period,
        ...optional("month", normal.month),
        ...optional("day", normal.day),
        ...optional("normal", normal.normal),
      })),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }
}
