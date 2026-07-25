import { createResponse, type HttpClient } from "../../core/client.js";
import { parseCoordinates } from "../../core/geo.js";
import { responseSource } from "../../core/provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { barentswatchProvider as provider } from "./provider.js";
import {
  type RawSeaCurrentPoint,
  type RawWaveForecastPoint,
  seaCurrentPointSchema,
  waveForecastPointSchema,
  waveForecastSeriesSchema,
} from "./schemas.js";
import type { MarineForecastParameters, SeaCurrentForecast, WaveForecast } from "./types.js";

const BASE_URL = "https://www.barentswatch.no/bwapi";

function optional<K extends string, T>(key: K, value: T | null | undefined): Record<K, T> | object {
  return value === null || value === undefined ? {} : { [key]: value };
}

/**
 * Whether a forecast entry carries any measurement at all.
 *
 * For a coordinate outside every model area the series endpoint does not answer
 * HTTP 204 as its OpenAPI document implies: it returns HTTP 200 and one entry per
 * model time with every wave value null, keeping only the echoed coordinate and
 * timestamp. Verified against the live service. Those entries state nothing, so
 * treating them as forecasts would make an uncovered point look like a covered
 * one with 73 readings.
 */
function hasMeasurement(point: RawWaveForecastPoint): boolean {
  return [
    point.totalSignificantWaveHeight,
    point.expectedMaximumWaveHeight,
    point.totalMeanWaveDirection,
    point.totalPeakPeriod,
  ].some((value) => value !== null && value !== undefined);
}

function normalizeWave(point: RawWaveForecastPoint): WaveForecast {
  return {
    ...optional("forecastTime", point.forecastTime),
    ...optional("significantWaveHeight", point.totalSignificantWaveHeight),
    ...optional("maximumWaveHeight", point.expectedMaximumWaveHeight),
    ...optional("meanWaveDirection", point.totalMeanWaveDirection),
    ...optional("peakPeriod", point.totalPeakPeriod),
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

function normalizeCurrent(point: RawSeaCurrentPoint): SeaCurrentForecast {
  return {
    ...optional("forecastTime", point.forecastTime),
    speed: point.current,
    direction: point.direction,
    latitude: point.latitude,
    longitude: point.longitude,
  };
}

/**
 * Client for BarentsWatch's marine point forecasts.
 *
 * Forecasts are drawn from numerical wave and current models covering the
 * Norwegian coast, not the whole ocean. A coordinate outside a model's area is a
 * normal outcome and resolves to `undefined` rather than an error, so a caller can
 * tell "no model covers this point" apart from "the provider failed".
 *
 * The returned coordinate is the centre of the model grid cell that answered,
 * which may be some distance from the requested point.
 */
export class MarineClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Returns the wave forecast valid now for the model cell nearest a point.
   *
   * Resolves to `undefined` when no model covers the coordinate.
   */
  async getWaveForecast(
    parameters: MarineForecastParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WaveForecast | undefined>> {
    const point = parseCoordinates(parameters, provider.id);
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/v1/waveforecastpoint/nearest`,
      query: { x: point.longitude, y: point.latitude },
      authenticate: true,
      schema: waveForecastPointSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.forecast,
      resourceDescription: "wave forecast point",
    });
    return createResponse(
      result.data === null ? undefined : normalizeWave(result.data),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns the wave forecast for every available model time at the cell nearest a
   * point, in the provider's own order.
   *
   * An empty array means no model covers the coordinate. The provider expresses
   * that in two different ways -- HTTP 204 with no body, and HTTP 200 with one
   * value-free entry per model time -- and both are surfaced here as an empty
   * series, so the answer does not depend on which form the service chose. Entries
   * carrying no measurement at all are therefore dropped; `{ includeRaw: true }`
   * still exposes the provider's untouched payload.
   */
  async getWaveForecastSeries(
    parameters: MarineForecastParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<WaveForecast[]>> {
    const point = parseCoordinates(parameters, provider.id);
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/v1/waveforecastpoint/nearest/all`,
      query: { x: point.longitude, y: point.latitude },
      authenticate: true,
      schema: waveForecastSeriesSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.forecast,
      resourceDescription: "wave forecast series",
    });
    return createResponse(
      result.data === null ? [] : result.data.filter(hasMeasurement).map(normalizeWave),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns the sea-current forecast for the model cell nearest a point.
   *
   * Resolves to `undefined` when no model covers the coordinate.
   */
  async getSeaCurrent(
    parameters: MarineForecastParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<SeaCurrentForecast | undefined>> {
    const point = parseCoordinates(parameters, provider.id);
    const result = await this.#http.request({
      provider,
      url: `${BASE_URL}/v1/seacurrent/nearest`,
      query: { x: point.longitude, y: point.latitude },
      authenticate: true,
      schema: seaCurrentPointSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.forecast,
      resourceDescription: "sea current point",
    });
    return createResponse(
      result.data === null ? undefined : normalizeCurrent(result.data),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }
}
