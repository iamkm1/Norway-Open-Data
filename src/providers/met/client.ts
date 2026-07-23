import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { metProvider } from "./provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { forecastResponseSchema, type RawForecast } from "./schemas.js";
import type { ForecastParameters, WeatherForecast, WeatherTimeseriesEntry } from "./types.js";

const FORECAST_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact";

const inputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  altitude: z.number().optional(),
});

function roundCoordinate(value: number): number {
  return Math.round(value * 10_000) / 10_000;
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

/** Client for MET Norway's Locationforecast 2.0 compact service. */
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
