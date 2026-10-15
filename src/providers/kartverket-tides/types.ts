/**
 * Vertical reference a water level is measured from.
 *
 * `chart-datum` is the level used for depths in nautical charts and heights in
 * tide tables; `mean-sea-level` is the 1996-2014 mean; `nn2000` is Norway's
 * land-height datum. Chart datum and NN2000 are not defined everywhere.
 */
export type TideReferenceLevel = "chart-datum" | "mean-sea-level" | "nn2000";

/** Language of the provider's descriptive texts. */
export type TideLanguage = "nb" | "nn" | "en";

/** A permanent Norwegian tide gauge. */
export type TideStation = {
  /** Three-letter station code, e.g. `BGO`. */
  code: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Station category; `PERM` for a permanent gauge. */
  type?: string;
};

/**
 * How Kartverket derived values for a requested position.
 *
 * Along most of the coast a position is not a gauge. Kartverket then scales a
 * reference station's tidal prediction by `factor`, shifts it by `delayMinutes`,
 * and adds the observed weather effect from a possibly different permanent gauge,
 * `surgeStationCode`. Values are measurements only at a permanent gauge.
 */
export type TideLocation = {
  /** Station whose tidal prediction the values are based on. */
  name: string;
  code: string;
  /** The position the values apply to, as Kartverket echoed it. */
  latitude: number;
  longitude: number;
  /** Amplitude correction applied to the reference prediction. */
  factor?: number;
  /** Time shift applied to the reference prediction, in minutes. */
  delayMinutes?: number;
  /** Permanent gauge that supplies the observed weather effect (surge). */
  surgeStationName?: string;
  surgeStationCode?: string;
  description?: string;
};

/** A water-level position and window. */
export type WaterLevelParameters = {
  latitude: number;
  longitude: number;
  /** Start of the window, ISO-8601 with an offset. */
  from: string;
  /** End of the window, ISO-8601 with an offset. */
  to: string;
  /**
   * Minutes between values, 10 or 60. Defaults to 60. A 10-minute series may
   * span at most 7 days and an hourly one at most 31.
   */
  interval?: 10 | 60;
  /** Defaults to `chart-datum`. */
  referenceLevel?: TideReferenceLevel;
  /** Defaults to Norwegian Bokmål. */
  language?: TideLanguage;
};

/** The forecast uncertainty band Kartverket publishes around a forecast value. */
export type WaterLevelUncertainty = {
  lowerPercentile?: number;
  lowPercentile?: number;
  highPercentile?: number;
  higherPercentile?: number;
};

/** One value in a water-level series. */
export type WaterLevelValue = {
  time: string;
  /** Height above the reference level, in the series' `unit`. */
  value: number;
  /** Provider flag, e.g. `obs`, `pre` or `forecast`. */
  flag?: string;
  /** Present on forecast values. */
  uncertainty?: WaterLevelUncertainty;
};

/** Kartverket's quality assessment of a series. */
export type WaterLevelQuality = {
  /** Provider quality flag; 1 is the highest class, 0 means not assessed. */
  flag: number;
  class?: string;
  description?: string;
};

/**
 * One water-level series.
 *
 * `type` is the provider's own vocabulary: `observation` (measured at a gauge,
 * otherwise estimated), `prediction` (astronomical tide), `weathereffect`
 * (surge: the observed difference between the two) and `forecast`. Kartverket may
 * add types; unrecognized ones are passed through unchanged.
 */
export type WaterLevelSeries = {
  type: string;
  /** Unit of every value, normally `cm`. */
  unit: string;
  quality?: WaterLevelQuality;
  values: WaterLevelValue[];
};

/** Water levels for one position and window. */
export type WaterLevels = {
  location: TideLocation;
  /** Reference code the values are measured from, e.g. `CD`. */
  referenceLevel: string;
  /** Service notices Kartverket attached, e.g. about a delayed gauge. */
  serviceMessages: string[];
  series: WaterLevelSeries[];
};

/** A tide-table position and window. */
export type TideTableParameters = {
  latitude: number;
  longitude: number;
  /** Start of the window, ISO-8601 with an offset. */
  from: string;
  /** End of the window, ISO-8601 with an offset. At most 366 days after `from`. */
  to: string;
  /** Defaults to `chart-datum`. */
  referenceLevel?: TideReferenceLevel;
  /** Defaults to Norwegian Bokmål. */
  language?: TideLanguage;
};

/** One predicted high or low water. */
export type TideEvent = {
  time: string;
  /** Predicted height above the reference level, in the table's `unit`. */
  value: number;
  kind: "high" | "low";
};

/** Predicted high and low waters for one position and window. */
export type TideTable = {
  location: TideLocation;
  referenceLevel: string;
  unit: string;
  serviceMessages: string[];
  events: TideEvent[];
};

/** A position whose reference levels to fetch. */
export type TideReferenceLevelParameters = {
  latitude: number;
  longitude: number;
  /** Level the others are expressed relative to. Defaults to `chart-datum`. */
  referenceLevel?: TideReferenceLevel;
  /** Defaults to Norwegian Bokmål. */
  language?: TideLanguage;
};

/** One reference, astronomical, observed or statistical return level. */
export type TideLevel = {
  /** Provider code, e.g. `HAT`, `MSL` or `200YMAX`. */
  code: string;
  name: string;
  description?: string;
  /** Height above the requested reference level, in the result's `unit`. */
  value: number;
  /** Provider category, e.g. `REF`, `ASTRO`, `ASTROREF`, `OBS` or `RETURN`. */
  type: string;
  /** Extra provider detail, e.g. the date of an observed extreme. */
  info?: string;
  /** Averaging period, e.g. `1996-2014` for mean sea level. */
  epoch?: string;
};

/** Every level Kartverket defines at a position. */
export type TideReferenceLevels = {
  location: TideLocation;
  referenceLevel: string;
  unit: string;
  serviceMessages: string[];
  levels: TideLevel[];
};
