import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
import { parseCoordinates } from "../../core/geo.js";
import { responseSource } from "../../core/provider.js";
import { metProvider } from "./provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  airQualityResponseSchema,
  AWARENESS_LEVEL_PATTERN,
  AWARENESS_TYPE_PATTERN,
  forecastResponseSchema,
  moonResponseSchema,
  nowcastResponseSchema,
  oceanForecastResponseSchema,
  type RawAirQuality,
  type RawForecast,
  type RawMoon,
  type RawNowcast,
  type RawOceanForecast,
  type RawSun,
  type RawWarningFeature,
  sunResponseSchema,
  warningCollectionSchema,
} from "./schemas.js";
import type {
  AirQualityArea,
  AirQualityComponent,
  AirQualityForecast,
  CelestialEvent,
  CelestialParameters,
  CelestialPosition,
  ForecastParameters,
  MetPoint,
  MetPointParameters,
  MoonTimes,
  Nowcast,
  OceanForecast,
  SunTimes,
  WeatherForecast,
  WeatherTimeseriesEntry,
  WeatherWarning,
  WeatherWarningCollection,
  WeatherWarningColor,
  WeatherWarningParameters,
} from "./types.js";

const API_BASE = "https://api.met.no/weatherapi";
const FORECAST_URL = `${API_BASE}/locationforecast/2.0/compact`;
const WARNINGS_URL = `${API_BASE}/metalerts/2.0/current.json`;
const NOWCAST_URL = `${API_BASE}/nowcast/2.0/complete`;
const SUN_URL = `${API_BASE}/sunrise/3.0/sun`;
const MOON_URL = `${API_BASE}/sunrise/3.0/moon`;
const OCEAN_URL = `${API_BASE}/oceanforecast/2.0/complete`;
const AIR_QUALITY_URL = `${API_BASE}/airqualityforecast/0.1/`;

/**
 * MET Norway's answer for a point outside a product's model area: HTTP 422 with
 * an explanation in the body. Verified against Nowcast and Oceanforecast.
 */
const OUTSIDE_MODEL_AREA = { status: 422, bodyIncludes: "outside the geographic area" };

const WARNING_EVENTS = [
  "blowingSnow",
  "forestFire",
  "gale",
  "ice",
  "icing",
  "lightning",
  "polarLow",
  "rain",
  "rainFlood",
  "snow",
  "stormSurge",
  "wind",
] as const;

const inputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

const warningParametersSchema = z
  .object({
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    countyCode: z
      .string()
      .regex(/^\d{2}$/)
      .optional(),
    event: z.enum(WARNING_EVENTS).optional(),
    geographicDomain: z.enum(["land", "marine"]).optional(),
    riskMatrixColor: z.enum(["green", "yellow", "orange", "red"]).optional(),
    language: z.enum(["no", "en"]).optional(),
  })
  .refine((value) => (value.latitude === undefined) === (value.longitude === undefined), {
    message: "Give latitude and longitude together, or neither.",
    path: ["longitude"],
  });

const celestialParametersSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  date: z.iso.date().optional(),
});

const osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const osloClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function optional<K extends string, T>(key: K, value: T | null | undefined): Partial<Record<K, T>> {
  return value === null || value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function roundedPoint(parameters: MetPointParameters): MetPointParameters {
  const point = parseCoordinates(
    { latitude: parameters.latitude, longitude: parameters.longitude },
    metProvider.id,
  );
  return { latitude: roundCoordinate(point.latitude), longitude: roundCoordinate(point.longitude) };
}

function pointFromGeometry(coordinates: readonly number[]): MetPoint {
  // The schema guarantees a valid longitude and latitude in the first two places.
  const [longitude = 0, latitude = 0, altitude] = coordinates;
  return { latitude, longitude, ...optional("altitude", altitude) };
}

/** Returns today's calendar date in Europe/Oslo as `YYYY-MM-DD`. */
function osloToday(): string {
  return osloDateFormatter.format(new Date());
}

/**
 * Returns the Europe/Oslo UTC offset in force on a date, e.g. `+02:00`.
 *
 * Measured at 12:00 UTC, when Norway is never mid-transition, so the answer is
 * the offset of the civil day rather than of a changeover hour.
 */
function osloOffset(date: string): string {
  const noon = Date.parse(`${date}T12:00:00Z`);
  const parts = Object.fromEntries(
    osloClockFormatter
      .formatToParts(new Date(noon))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const local = Date.parse(
    `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:00Z`,
  );
  const minutes = Math.round((local - noon) / 60_000);
  const sign = minutes < 0 ? "-" : "+";
  const absolute = Math.abs(minutes);
  return `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function normalizeTimeseriesEntry(
  entry: RawForecast["properties"]["timeseries"][number],
): WeatherTimeseriesEntry {
  const details = entry.data.instant.details;
  return {
    time: entry.time,
    ...(details.air_temperature === undefined ? {} : { temperature: details.air_temperature }),
    ...(details.wind_speed === undefined ? {} : { windSpeed: details.wind_speed }),
    ...(details.wind_from_direction === undefined
      ? {}
      : { windDirection: details.wind_from_direction }),
    ...(details.relative_humidity === undefined ? {} : { humidity: details.relative_humidity }),
    ...(details.air_pressure_at_sea_level === undefined
      ? {}
      : { airPressure: details.air_pressure_at_sea_level }),
    ...(details.cloud_area_fraction === undefined
      ? {}
      : { cloudCover: details.cloud_area_fraction }),
    ...(entry.data.next_1_hours?.details?.precipitation_amount === undefined
      ? {}
      : { precipitationNextHour: entry.data.next_1_hours.details.precipitation_amount }),
    ...(entry.data.next_6_hours?.details?.precipitation_amount === undefined
      ? {}
      : { precipitationNextSixHours: entry.data.next_6_hours.details.precipitation_amount }),
    ...((entry.data.next_1_hours?.summary?.symbol_code ??
      entry.data.next_6_hours?.summary?.symbol_code) === undefined
      ? {}
      : {
          symbolCode:
            entry.data.next_1_hours?.summary?.symbol_code ??
            entry.data.next_6_hours?.summary?.symbol_code,
        }),
  };
}

function normalizeForecast(raw: RawForecast): WeatherForecast {
  const [longitude, latitude, altitude] = raw.geometry.coordinates;
  if (longitude === undefined || latitude === undefined) {
    throw new ResponseValidationError("MET Norway response omitted forecast coordinates.", {
      provider: metProvider.id,
    });
  }
  return {
    ...(raw.properties.meta.updated_at === undefined
      ? {}
      : { updatedAt: raw.properties.meta.updated_at }),
    coordinates: {
      latitude,
      longitude,
      ...(altitude === undefined ? {} : { altitude }),
    },
    timeseries: raw.properties.timeseries.map(normalizeTimeseriesEntry),
  };
}

function normalizeWarning(feature: RawWarningFeature): WeatherWarning {
  const properties = feature.properties;
  // The schema has already matched both patterns, so the groups are present.
  const level = AWARENESS_LEVEL_PATTERN.exec(properties.awareness_level);
  const type =
    properties.awareness_type === null || properties.awareness_type === undefined
      ? null
      : AWARENESS_TYPE_PATTERN.exec(properties.awareness_type);
  const [onset, expires] = feature.when?.interval ?? [];
  return {
    id: properties.id,
    event: properties.event,
    ...optional("eventName", properties.eventAwarenessName),
    title: properties.title,
    area: properties.area,
    description: properties.description,
    ...optional("instruction", properties.instruction),
    ...optional("consequences", properties.consequences),
    awarenessLevel: {
      level: Number(level?.[1]) as 1 | 2 | 3 | 4,
      color: (level?.[2] ?? "").toLowerCase() as WeatherWarningColor,
      severity: level?.[3] ?? "",
    },
    ...(type === null
      ? {}
      : { awarenessType: { code: Number(type[1]), name: (type[2] ?? "").toLowerCase() } }),
    ...optional("riskMatrixColor", properties.riskMatrixColor),
    severity: properties.severity,
    certainty: properties.certainty,
    messageType: properties.type,
    status: properties.status,
    ...optional("response", properties.awarenessResponse),
    ...optional("seriousness", properties.awarenessSeriousness),
    ...optional("triggerLevel", properties.triggerLevel),
    ...optional("geographicDomain", properties.geographicDomain),
    countyCodes: (properties.county ?? []).map((code) => code.padStart(2, "0")),
    municipalityCodes: properties.municipality ?? [],
    ...optional("incidentName", properties.incidentName),
    ...optional("onset", onset),
    ...optional("expires", expires),
    ...optional("eventEndingTime", properties.eventEndingTime),
    ...optional("web", properties.web),
    resources: (properties.resources ?? []).map((resource) => ({
      uri: resource.uri,
      ...optional("description", resource.description),
      ...optional("mimeType", resource.mimeType),
    })),
    geometry: feature.geometry,
  };
}

function normalizeNowcast(raw: RawNowcast): Nowcast {
  return {
    ...optional("updatedAt", raw.properties.meta.updated_at),
    coordinates: pointFromGeometry(raw.geometry.coordinates),
    ...optional("radarCoverage", raw.properties.meta.radar_coverage),
    entries: raw.properties.timeseries.map((entry) => {
      const details = entry.data.instant.details;
      return {
        time: entry.time,
        ...optional("precipitationRate", details.precipitation_rate),
        ...optional("temperature", details.air_temperature),
        ...optional("apparentTemperature", details.apparent_air_temperature),
        ...optional("humidity", details.relative_humidity),
        ...optional("windSpeed", details.wind_speed),
        ...optional("windGust", details.wind_speed_of_gust),
        ...optional("windDirection", details.wind_from_direction),
        ...optional("uvIndexClearSky", details.ultraviolet_index_clear_sky),
        ...optional("symbolCode", entry.data.next_1_hours?.summary?.symbol_code),
        ...optional(
          "precipitationNextHour",
          entry.data.next_1_hours?.details?.precipitation_amount,
        ),
      };
    }),
  };
}

type RawCelestialEvent = { time: string | null; azimuth?: number | null | undefined };
type RawCelestialPosition = {
  time: string | null;
  disc_centre_elevation?: number | null | undefined;
  visible?: boolean | null | undefined;
};

function celestialEvent(raw: RawCelestialEvent | null | undefined): CelestialEvent | undefined {
  const time = raw?.time;
  if (time === null || time === undefined) return undefined;
  return { time, ...optional("azimuth", raw?.azimuth) };
}

function celestialPosition(
  raw: RawCelestialPosition | null | undefined,
): CelestialPosition | undefined {
  const time = raw?.time;
  if (time === null || time === undefined) return undefined;
  return {
    time,
    ...optional("elevation", raw?.disc_centre_elevation),
    ...optional("visible", raw?.visible),
  };
}

function normalizeSun(raw: RawSun, date: string): SunTimes {
  const sunrise = celestialEvent(raw.properties.sunrise);
  const sunset = celestialEvent(raw.properties.sunset);
  const solarNoon = celestialPosition(raw.properties.solarnoon);
  const solarMidnight = celestialPosition(raw.properties.solarmidnight);
  const polarCondition =
    sunrise !== undefined || sunset !== undefined
      ? undefined
      : solarMidnight?.visible === true
        ? ("midnight-sun" as const)
        : solarNoon?.visible === false
          ? ("polar-night" as const)
          : undefined;
  return {
    date,
    coordinates: pointFromGeometry(raw.geometry.coordinates),
    ...optional("sunrise", sunrise),
    ...optional("sunset", sunset),
    ...optional("solarNoon", solarNoon),
    ...optional("solarMidnight", solarMidnight),
    ...optional("polarCondition", polarCondition),
  };
}

function normalizeMoon(raw: RawMoon, date: string): MoonTimes {
  return {
    date,
    coordinates: pointFromGeometry(raw.geometry.coordinates),
    ...optional("moonrise", celestialEvent(raw.properties.moonrise)),
    ...optional("moonset", celestialEvent(raw.properties.moonset)),
    ...optional("highMoon", celestialPosition(raw.properties.high_moon)),
    ...optional("lowMoon", celestialPosition(raw.properties.low_moon)),
    ...optional("phaseDegrees", raw.properties.moonphase),
  };
}

function normalizeOcean(raw: RawOceanForecast): OceanForecast | undefined {
  // Inland, the service answers HTTP 200 with `meta.error` and an empty series.
  if (raw.properties.timeseries.length === 0) return undefined;
  return {
    ...optional("updatedAt", raw.properties.meta.updated_at),
    coordinates: pointFromGeometry(raw.geometry.coordinates),
    entries: raw.properties.timeseries.map((entry) => {
      const details = entry.data.instant.details;
      return {
        time: entry.time,
        ...optional("seaTemperature", details.sea_water_temperature),
        ...optional("waveHeight", details.sea_surface_wave_height),
        ...optional("waveFromDirection", details.sea_surface_wave_from_direction),
        ...optional("currentSpeed", details.sea_water_speed),
        ...optional("currentToDirection", details.sea_water_to_direction),
      };
    }),
  };
}

type RawAirQualityLocation = RawAirQuality["meta"]["location"];
type RawAirQualityVariables = RawAirQuality["data"]["time"][number]["variables"];

function airQualityArea(location: RawAirQualityLocation): AirQualityArea {
  return {
    name: location.name,
    areaClass: location.areaclass,
    areaCode: location.areacode,
    ...optional("path", location.path),
    latitude: location.latitude,
    longitude: location.longitude,
  };
}

const CONCENTRATION_UNITS = new Set(["ug/m3", "µg/m3", "μg/m3"]);

function airQualityComponent(
  variables: RawAirQualityVariables,
  pollutant: "no2" | "pm10" | "pm25" | "o3",
): AirQualityComponent | undefined {
  const concentration = variables[`${pollutant}_concentration`];
  if (concentration !== undefined && !CONCENTRATION_UNITS.has(concentration.units)) {
    throw new ResponseValidationError(
      `MET Norway reported ${pollutant} in "${concentration.units}" rather than µg/m³.`,
      { provider: metProvider.id },
    );
  }
  const index = variables[`AQI_${pollutant}`]?.value;
  if (concentration === undefined && index === undefined) return undefined;
  return {
    ...optional("concentration", concentration?.value),
    ...optional("index", index),
  };
}

function normalizeAirQuality(raw: RawAirQuality): AirQualityForecast {
  return {
    referenceTime: raw.meta.reftime,
    area: airQualityArea(raw.meta.location),
    ...optional(
      "parentArea",
      raw.meta.superlocation === undefined ? undefined : airQualityArea(raw.meta.superlocation),
    ),
    entries: raw.data.time.map((entry) => ({
      from: entry.from,
      to: entry.to,
      ...optional("index", entry.variables["AQI"]?.value),
      ...optional("no2", airQualityComponent(entry.variables, "no2")),
      ...optional("pm10", airQualityComponent(entry.variables, "pm10")),
      ...optional("pm25", airQualityComponent(entry.variables, "pm25")),
      ...optional("o3", airQualityComponent(entry.variables, "o3")),
    })),
  };
}

/**
 * Client for MET Norway's api.met.no weather products.
 *
 * Every method requires `applicationName` and `contactEmail`, which MET Norway
 * uses to identify the caller. Coordinates are rounded to four decimals, as the
 * provider's terms ask, so nearby requests share cache entries.
 */
export class MetClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Fetches a compact point forecast. Coordinates are rounded to four decimals. */
  async forecast(
    parameters: ForecastParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WeatherForecast>> {
    const result = await this.#requestForecast(parameters, options);
    return createResponse(
      normalizeForecast(result.data),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Returns the first current/relevant entry from the compact point forecast. */
  async current(
    parameters: ForecastParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WeatherTimeseriesEntry | undefined>> {
    const result = await this.#requestForecast(parameters, options);
    const forecast = normalizeForecast(result.data);
    return createResponse(
      forecast.timeseries[0],
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns MET Norway's current official weather warnings.
   *
   * With `latitude` and `longitude`, only warnings whose area contains the point
   * are returned; MetAlerts performs that containment test itself. Other filters
   * narrow by county, event type, land or marine domain, and risk colour.
   *
   * An empty result is never an all-clear. MET Norway's warnings cover weather;
   * flood, landslide and avalanche warnings come from NVE through `hazards`.
   */
  async getWarnings(
    parameters: WeatherWarningParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WeatherWarningCollection>> {
    const parsed = warningParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid MET Norway warning parameters.", {
        provider: metProvider.id,
        cause: parsed.error,
      });
    }
    const filters = parsed.data;
    const language = filters.language ?? "no";
    const result = await this.#http.request({
      provider: metProvider,
      url: WARNINGS_URL,
      query: {
        lat: filters.latitude === undefined ? undefined : roundCoordinate(filters.latitude),
        lon: filters.longitude === undefined ? undefined : roundCoordinate(filters.longitude),
        county: filters.countyCode === undefined ? undefined : Number(filters.countyCode),
        event: filters.event,
        geographicDomain: filters.geographicDomain,
        riskMatrixColor: filters.riskMatrixColor,
        lang: language,
      },
      authenticate: true,
      schema: warningCollectionSchema,
      options,
      cacheTtlMs: metProvider.cacheTtlMs.warnings,
      resourceDescription: "weather warnings",
    });
    return createResponse(
      {
        ...optional("lastChange", result.data.lastChange),
        language,
        warnings: result.data.features.map(normalizeWarning),
      },
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns a radar-based precipitation nowcast for roughly the next two hours,
   * in five-minute steps, with current conditions in the first step.
   *
   * Resolves to `undefined` for a point outside the Nordic radar area, which
   * includes Svalbard. Check `radarCoverage` before relying on precipitation.
   */
  async getNowcast(
    parameters: MetPointParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Nowcast | undefined>> {
    const point = roundedPoint(parameters);
    const result = await this.#http.request({
      provider: metProvider,
      url: NOWCAST_URL,
      query: { lat: point.latitude, lon: point.longitude },
      authenticate: true,
      schema: nowcastResponseSchema,
      absentResponses: [OUTSIDE_MODEL_AREA],
      options,
      cacheTtlMs: metProvider.cacheTtlMs.nowcast,
      resourceDescription: "nowcast",
    });
    return createResponse(
      result.data === null ? undefined : normalizeNowcast(result.data),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns sunrise, sunset, solar noon and solar midnight for a date and place.
   *
   * Times carry the Europe/Oslo offset in force on `date`. A day with neither
   * sunrise nor sunset reports `polarCondition` instead.
   */
  async getSunTimes(
    parameters: CelestialParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<SunTimes>> {
    const request = this.#celestialRequest(parameters);
    const result = await this.#http.request({
      provider: metProvider,
      url: SUN_URL,
      query: request.query,
      authenticate: true,
      schema: sunResponseSchema,
      options,
      cacheTtlMs: metProvider.cacheTtlMs.celestial,
      resourceDescription: "sun times",
    });
    return createResponse(
      normalizeSun(result.data, request.date),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns moonrise, moonset, the moon's highest and lowest points and its
   * phase for a date and place, in the Europe/Oslo offset in force on `date`.
   */
  async getMoonTimes(
    parameters: CelestialParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<MoonTimes>> {
    const request = this.#celestialRequest(parameters);
    const result = await this.#http.request({
      provider: metProvider,
      url: MOON_URL,
      query: request.query,
      authenticate: true,
      schema: moonResponseSchema,
      options,
      cacheTtlMs: metProvider.cacheTtlMs.celestial,
      resourceDescription: "moon times",
    });
    return createResponse(
      normalizeMoon(result.data, request.date),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns sea temperature, waves and surface current for the ocean-model cell
   * nearest a point.
   *
   * Resolves to `undefined` inland and outside every model area. The returned
   * coordinate is the model cell's centre, which may be some distance away.
   */
  async getOceanForecast(
    parameters: MetPointParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<OceanForecast | undefined>> {
    const point = roundedPoint(parameters);
    const result = await this.#http.request({
      provider: metProvider,
      url: OCEAN_URL,
      query: { lat: point.latitude, lon: point.longitude },
      authenticate: true,
      schema: oceanForecastResponseSchema,
      absentResponses: [OUTSIDE_MODEL_AREA],
      options,
      cacheTtlMs: metProvider.cacheTtlMs.ocean,
      resourceDescription: "ocean forecast",
    });
    return createResponse(
      result.data === null ? undefined : normalizeOcean(result.data),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns MET Norway's hourly air-quality forecast for the statistical area
   * containing a point.
   *
   * Experimental: the upstream product is version 0.1. Resolves to `undefined`
   * for a location the model does not cover, which includes everywhere outside
   * Norway. Values are model forecasts, not measurements.
   */
  async getAirQualityForecast(
    parameters: MetPointParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AirQualityForecast | undefined>> {
    const point = roundedPoint(parameters);
    const result = await this.#http.request({
      provider: metProvider,
      url: AIR_QUALITY_URL,
      query: { lat: point.latitude, lon: point.longitude },
      authenticate: true,
      schema: airQualityResponseSchema,
      absentResponses: [{ status: 400, bodyIncludes: "unknown location" }],
      options,
      cacheTtlMs: metProvider.cacheTtlMs.airQuality,
      resourceDescription: "air-quality forecast",
    });
    return createResponse(
      result.data === null ? undefined : normalizeAirQuality(result.data),
      responseSource(metProvider),
      result.data,
      result.cached,
      options,
    );
  }

  #celestialRequest(parameters: CelestialParameters): {
    date: string;
    query: Record<string, string | number>;
  } {
    const parsed = celestialParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid MET Norway sunrise parameters.", {
        provider: metProvider.id,
        cause: parsed.error,
      });
    }
    const date = parsed.data.date ?? osloToday();
    return {
      date,
      query: {
        lat: roundCoordinate(parsed.data.latitude),
        lon: roundCoordinate(parsed.data.longitude),
        date,
        offset: osloOffset(date),
      },
    };
  }

  async #requestForecast(
    parameters: ForecastParameters,
    options?: RequestOptions,
  ): Promise<{ data: RawForecast; cached: boolean }> {
    const parsed = inputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid MET Norway forecast coordinates.", {
        provider: metProvider.id,
        cause: parsed.error,
      });
    }
    return this.#http.request({
      provider: metProvider,
      url: FORECAST_URL,
      query: {
        lat: roundCoordinate(parsed.data.latitude),
        lon: roundCoordinate(parsed.data.longitude),
        altitude: parsed.data.altitude,
      },
      authenticate: true,
      schema: forecastResponseSchema,
      options,
      cacheTtlMs: metProvider.cacheTtlMs.forecast,
    });
  }
}
