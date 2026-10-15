/** A WGS84 position published with a Frost station or observation. */
export type ClimateCoordinates = {
  latitude: number;
  longitude: number;
};

/**
 * Filters for {@link ClimateClient.searchStations}. At least one is required, so
 * an unfiltered call cannot download Frost's entire station catalogue.
 */
export type ClimateStationSearchParameters = {
  /** Frost station IDs, e.g. `["SN18700"]`. At most 100. */
  ids?: string[];
  /** Station name, as a Frost search filter: case-insensitive, `*` is a wildcard. */
  name?: string;
  /** Municipality name or Frost municipality ID, as a search filter. */
  municipality?: string;
  /** County name or Frost county ID, as a search filter. */
  county?: string;
  /** Only stations with observations for every one of these elements. At most 20. */
  elements?: string[];
  /** The stations nearest a point, closest first. */
  near?: ClimateCoordinates & {
    /** How many stations to return. Defaults to 1; at most 100. */
    maxCount?: number;
  };
  /** Only stations in operation now. */
  activeOnly?: boolean;
};

/**
 * A Frost weather station (a "SensorSystem" source).
 *
 * The administrative fields are Frost's own metadata. They can predate later
 * municipal and county reforms, so resolve current boundaries separately when
 * that matters. Frost's station-holder names are not included.
 */
export type ClimateStation = {
  /** Frost station ID, e.g. `SN18700`. */
  id: string;
  name: string;
  shortName?: string;
  countryCode?: string;
  /** WMO station number, when assigned. */
  wmoId?: number;
  wigosId?: string;
  coordinates?: ClimateCoordinates;
  /** Elevation in metres above sea level. */
  elevationMetres?: number;
  /** Distance from the point given in `near`, in kilometres. */
  distanceKm?: number;
  validFrom?: string;
  /** End of operation, for a station that has closed. */
  validTo?: string;
  county?: string;
  /** Frost's county ID. */
  countyId?: number;
  municipality?: string;
  /** Frost's municipality ID. */
  municipalityId?: number;
  externalIds: string[];
  icaoCodes: string[];
};

/** A sensor level, such as two metres above ground. */
export type ClimateLevel = {
  type?: string;
  unit?: string;
  value?: number;
};

/** Parameters for {@link ClimateClient.getAvailableTimeSeries}. */
export type ClimateTimeSeriesParameters = {
  /** Frost station IDs, optionally with a sensor suffix, e.g. `SN18700:0`. 1 to 10. */
  stationIds: string[];
  /** Element IDs or search filters. At most 20. */
  elements?: string[];
  /** Start of the period of interest, ISO-8601 with an offset. Give with `to`. */
  from?: string;
  /** End of the period of interest, ISO-8601 with an offset. Give with `from`. */
  to?: string;
};

/** Metadata for one time series Frost holds. */
export type ClimateTimeSeries = {
  /** Station and sensor, e.g. `SN18700:0`. */
  stationId: string;
  elementId: string;
  unit?: string;
  /** ISO-8601 duration between values, e.g. `PT1H`. */
  timeResolution?: string;
  /** ISO-8601 offset from midnight of the observation time, e.g. `PT6H`. */
  timeOffset?: string;
  level?: ClimateLevel;
  validFrom?: string;
  /** Absent while the series is still receiving data. */
  validTo?: string;
  timeSeriesId?: number;
  performanceCategory?: string;
  exposureCategory?: string;
  status?: string;
  coordinates?: ClimateCoordinates;
};

/** Parameters for {@link ClimateClient.getObservations}. */
export type ClimateObservationParameters = {
  /** Frost station IDs, optionally with a sensor suffix, e.g. `SN18700:0`. 1 to 10. */
  stationIds: string[];
  /** Element IDs, e.g. `air_temperature` or `sum(precipitation_amount P1D)`. 1 to 20. */
  elements: string[];
  /** Start of the window, inclusive, ISO-8601 with an offset. */
  from: string;
  /**
   * End of the window, exclusive, as Frost treats it. At most 31 days after
   * `from`, or 366 days when every `timeResolutions` entry is daily or coarser.
   */
  to: string;
  /** Only these ISO-8601 resolutions, e.g. `["PT1H"]` or `["P1D"]`. */
  timeResolutions?: string[];
  /**
   * Time offsets to include. Defaults to `"default"`, Frost's recommended offset
   * per element, which avoids near-duplicate parallel series.
   */
  timeOffsets?: "default" | string[];
  /**
   * Sensor levels to include, in the level's unit. Defaults to `"default"`, the
   * standard level per element.
   */
  levels?: "default" | number[];
  /** Only observations with these Frost quality codes. */
  qualities?: number[];
};

/** Parameters for {@link ClimateClient.getLatestObservations}. */
export type ClimateLatestObservationParameters = {
  /** Frost station IDs, optionally with a sensor suffix. 1 to 10. */
  stationIds: string[];
  /** Element IDs. 1 to 20. */
  elements: string[];
  /** Oldest acceptable observation, as an ISO-8601 duration. Defaults to `PT3H`. */
  maxAge?: string;
};

/** One observed value. */
export type ClimateObservation = {
  elementId: string;
  /** A number, or a UTC timestamp string for time-valued elements. */
  value: number | string;
  unit?: string;
  /** Code table describing a coded value, when `unit` is `code`. */
  codeTable?: string;
  level?: ClimateLevel;
  /**
   * ISO-8601 offset relative to the record's `referenceTime`. Whether it must be
   * added to recover the observation time depends on the element; see Frost's
   * documentation on reference time, offset and resolution.
   */
  timeOffset?: string;
  timeResolution?: string;
  timeSeriesId?: number;
  performanceCategory?: string;
  exposureCategory?: string;
  /** Frost quality-control code. */
  qualityCode?: number;
};

/** Every value one station reported for one reference time. */
export type ClimateObservationRecord = {
  /** Station and sensor, e.g. `SN18700:0`. */
  stationId: string;
  referenceTime: string;
  coordinates?: ClimateCoordinates;
  observations: ClimateObservation[];
};

/** Parameters for {@link ClimateClient.getClimateNormals}. */
export type ClimateNormalParameters = {
  /** Frost station IDs without a sensor suffix, e.g. `SN18700`. 1 to 10. */
  stationIds: string[];
  /** Element IDs or search filters. At most 20. */
  elements?: string[];
  /** Normal period `YYYY/YYYY`, e.g. `1991/2020`. */
  period?: string;
};

/** One climate-normal value. */
export type ClimateNormal = {
  stationId: string;
  elementId: string;
  /** Normal period, e.g. `1991/2020`. */
  period: string;
  month?: number;
  /** Day of month, for daily normals. */
  day?: number;
  /** Absent when Frost holds no value for the combination. */
  normal?: number;
};
