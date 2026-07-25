import type { Coordinates } from "../../core/geo.js";

/** Parameters for a marine point forecast. */
export type MarineForecastParameters = Coordinates;

/**
 * A wave forecast for the model grid cell nearest a requested point.
 *
 * `latitude` and `longitude` are the grid cell's own centre, not the coordinate
 * that was asked for, so a caller can see how far the answer is from the query.
 */
export type WaveForecast = {
  /** Model time this forecast is valid for, ISO-8601. */
  forecastTime?: string;
  /** Significant wave height in metres. */
  significantWaveHeight?: number;
  /** Expected maximum wave height in metres. */
  maximumWaveHeight?: number;
  /** Mean wave direction in degrees. */
  meanWaveDirection?: number;
  /** Peak wave period in seconds. */
  peakPeriod?: number;
  /** Centre of the model grid cell that answered the query. */
  latitude: number;
  longitude: number;
};

/**
 * A sea-current forecast for the model grid cell nearest a requested point.
 *
 * `speed` and `direction` are always present: the provider declares both
 * non-nullable, and expresses "no model covers this point" by returning no
 * forecast at all rather than a forecast with missing values.
 */
export type SeaCurrentForecast = {
  /** Model time this forecast is valid for, ISO-8601. */
  forecastTime?: string;
  /** Current speed, in the units the model publishes. */
  speed: number;
  /** Current direction in degrees. */
  direction: number;
  /** Centre of the model grid cell that answered the query. */
  latitude: number;
  longitude: number;
};
