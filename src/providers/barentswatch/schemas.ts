/**
 * Runtime schemas for the BarentsWatch wave forecast API.
 *
 * Field names and nullability mirror `BwRasterWavePoint` and
 * `BwRasterSeaCurrentPoint` in the provider's published OpenAPI document at
 * `https://www.barentswatch.no/bwapi/openapi/waveforecast/openapi.json`.
 */
import { z } from "zod";

const waveForecastFieldsSchema = z.object({
  totalSignificantWaveHeight: z.number().nullish(),
  expectedMaximumWaveHeight: z.number().nullish(),
  totalMeanWaveDirection: z.number().int().nullish(),
  totalPeakPeriod: z.number().nullish(),
  forecastTime: z.string().nullish(),
  longitude: z.number(),
  latitude: z.number(),
  // Documented by the provider as debugging-only, so deliberately not surfaced on
  // the normalized type.
  source: z.string().nullish(),
  fileSource: z.string().nullish(),
});

/**
 * A single wave forecast point.
 *
 * Nullable at the top level because the endpoint answers HTTP 204 for a
 * coordinate outside the model area, which the HTTP client hands to the schema as
 * `null`. Modelling that as a nullable result is what lets "no forecast covers
 * this point" be a normal answer rather than an error.
 */
export const waveForecastPointSchema = waveForecastFieldsSchema.nullable();

/** @internal */
export type RawWaveForecastPoint = z.infer<typeof waveForecastFieldsSchema>;

/**
 * A series of wave forecast points, one per available model time.
 *
 * Nullable for the same reason as the single point: the provider documents HTTP
 * 204 for this endpoint too, so a coordinate outside every model area yields no
 * body at all rather than an empty array. The client turns that into an empty
 * series.
 */
export const waveForecastSeriesSchema = z.array(waveForecastFieldsSchema).nullable();

const seaCurrentFieldsSchema = z.object({
  // Declared non-nullable upstream, unlike every wave field: a sea-current point
  // that exists always carries both a speed and a direction. Absence of coverage
  // is expressed by HTTP 204, handled at the top level below.
  current: z.number(),
  direction: z.number(),
  forecastTime: z.string().nullish(),
  longitude: z.number(),
  latitude: z.number(),
});

/** A single sea-current forecast point; nullable for the same reason as waves. */
export const seaCurrentPointSchema = seaCurrentFieldsSchema.nullable();

/** @internal */
export type RawSeaCurrentPoint = z.infer<typeof seaCurrentFieldsSchema>;
