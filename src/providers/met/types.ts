import type { GeoJsonGeometry } from "../../core/geojson.js";

/** Coordinates accepted by MET Norway Locationforecast. */
export type ForecastParameters = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

/** A normalized point in a MET Norway forecast time series. */
export type WeatherTimeseriesEntry = {
  time: string;
  temperature?: number;
  windSpeed?: number;
  windDirection?: number;
  humidity?: number;
  airPressure?: number;
  cloudCover?: number;
  precipitationNextHour?: number;
  precipitationNextSixHours?: number;
  symbolCode?: string;
};

/** A normalized MET Norway Locationforecast response. */
export type WeatherForecast = {
  updatedAt?: string;
  coordinates: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  timeseries: WeatherTimeseriesEntry[];
};

/** A WGS84 point accepted by MET Norway's point products. Rounded to four decimals. */
export type MetPointParameters = {
  latitude: number;
  longitude: number;
};

/** The point a MET Norway product answered for, which may be a model grid cell. */
export type MetPoint = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

/**
 * Warning types MET Norway publishes through MetAlerts.
 *
 * MetAlerts may add a type; `WeatherWarning.event` is therefore a plain string
 * and this list documents the values known when the SDK was released.
 */
export type WeatherWarningEvent =
  | "blowingSnow"
  | "forestFire"
  | "gale"
  | "ice"
  | "icing"
  | "lightning"
  | "polarLow"
  | "rain"
  | "rainFlood"
  | "snow"
  | "stormSurge"
  | "wind";

/** MET Norway's four-step warning colour scale. */
export type WeatherWarningColor = "green" | "yellow" | "orange" | "red";

/** Filters for {@link MetClient.getWarnings}. Every filter is optional. */
export type WeatherWarningParameters = {
  /**
   * Returns only warnings whose area contains this point. Give `latitude` and
   * `longitude` together or not at all.
   */
  latitude?: number;
  longitude?: number;
  /** Two-digit Norwegian county number, e.g. `"46"`. */
  countyCode?: string;
  event?: WeatherWarningEvent;
  /** `land` warnings cover counties and municipalities; `marine` ones cover sea areas. */
  geographicDomain?: "land" | "marine";
  riskMatrixColor?: WeatherWarningColor;
  /** Language of the free-text fields. Defaults to Norwegian, as MetAlerts does. */
  language?: "no" | "en";
};

/** The awareness level MET Norway assigns a warning. */
export type WeatherWarningLevel = {
  /** 1 (green) to 4 (red). */
  level: 1 | 2 | 3 | 4;
  color: WeatherWarningColor;
  /** The CAP severity word published with the level, e.g. `Moderate`. */
  severity: string;
};

/** A link MET Norway attaches to a warning. The SDK never follows it. */
export type WeatherWarningResource = {
  uri: string;
  description?: string;
  mimeType?: string;
};

/**
 * One official MET Norway weather warning.
 *
 * MET Norway warns about weather: wind, gale, rain, snow, ice, icing, storm
 * surge, forest-fire danger, lightning and polar lows. Flood, landslide and
 * avalanche warnings are issued by NVE and are available through `hazards`.
 */
export type WeatherWarning = {
  /** CAP identifier, stable across the warning's updates. */
  id: string;
  /** MetAlerts event type; see {@link WeatherWarningEvent}. */
  event: string;
  /** Localized event name, e.g. `Gale` or `Kuling`. */
  eventName?: string;
  title: string;
  /** Localized description of the affected area. */
  area: string;
  description: string;
  instruction?: string;
  consequences?: string;
  awarenessLevel: WeatherWarningLevel;
  /** MeteoAlarm awareness type, e.g. `{ code: 1, name: "wind" }`. */
  awarenessType?: { code: number; name: string };
  riskMatrixColor?: WeatherWarningColor;
  /** CAP severity: `Minor`, `Moderate`, `Severe`, `Extreme` or `Unknown`. */
  severity: string;
  /** CAP certainty: `Observed`, `Likely`, `Possible`, `Unlikely` or `Unknown`. */
  certainty: string;
  /** CAP message type: `Alert`, `Update` or `Cancel`. */
  messageType: string;
  /** CAP status, normally `Actual`. */
  status: string;
  /** Localized recommended response, e.g. `Be prepared`. */
  response?: string;
  /** Localized seriousness, e.g. `Challenging situation`. */
  seriousness?: string;
  /** Threshold the warning refers to, exactly as MET Norway wrote it, e.g. `20.8 m/s`. */
  triggerLevel?: string;
  geographicDomain?: "land" | "marine";
  /** Two-digit county numbers the warning names. Often empty for marine warnings. */
  countyCodes: string[];
  /** Four-digit municipality numbers the warning names, when MET Norway lists them. */
  municipalityCodes: string[];
  /** Name MET Norway gave an extreme-weather event, e.g. `Amy`. */
  incidentName?: string;
  /** Start of the warning's validity. */
  onset?: string;
  /** End of the warning's validity. */
  expires?: string;
  /** When MET Norway expects the weather event itself to end. */
  eventEndingTime?: string;
  /** MET Norway page explaining the phenomenon. */
  web?: string;
  resources: WeatherWarningResource[];
  /** Area the warning covers, in WGS84, exactly as published. */
  geometry: GeoJsonGeometry | null;
};

/**
 * The warnings MetAlerts currently publishes for a query.
 *
 * An empty `warnings` array means MetAlerts had no current warning matching the
 * filters. It is never an all-clear: check yr.no, varsom.no and local
 * authorities before any safety decision.
 */
export type WeatherWarningCollection = {
  /** When MET Norway last changed the published set of warnings. */
  lastChange?: string;
  language: "no" | "en";
  warnings: WeatherWarning[];
};

/** One step of a MET Norway nowcast. */
export type NowcastEntry = {
  time: string;
  /** Precipitation intensity in mm/h, derived from weather radar. */
  precipitationRate?: number;
  temperature?: number;
  apparentTemperature?: number;
  humidity?: number;
  windSpeed?: number;
  windGust?: number;
  windDirection?: number;
  /** UV index for a clear sky. */
  uvIndexClearSky?: number;
  /** Weather symbol for the coming hour, when published for this step. */
  symbolCode?: string;
  /** Precipitation expected over the coming hour, in mm. */
  precipitationNextHour?: number;
};

/**
 * A short-range MET Norway nowcast: radar-based precipitation for roughly the
 * next two hours in five-minute steps, plus current conditions.
 */
export type Nowcast = {
  updatedAt?: string;
  coordinates: MetPoint;
  /**
   * Radar status for the point as MET Norway reports it, e.g. `ok` or
   * `temporarily unavailable`. Precipitation values are unreliable unless `ok`.
   */
  radarCoverage?: string;
  entries: NowcastEntry[];
};

/** Parameters for {@link MetClient.getSunTimes} and {@link MetClient.getMoonTimes}. */
export type CelestialParameters = MetPointParameters & {
  /** Calendar date `YYYY-MM-DD` in Norwegian time. Defaults to today in Europe/Oslo. */
  date?: string;
};

/** A rise or set event. */
export type CelestialEvent = {
  time: string;
  /** Compass direction of the event, in degrees. */
  azimuth?: number;
};

/** The body's position at its highest or lowest point of the day. */
export type CelestialPosition = {
  time: string;
  /** Elevation of the disc centre above the horizon, in degrees. */
  elevation?: number;
  /** Whether the body is above the horizon at that moment. */
  visible?: boolean;
};

/**
 * Sun times for one date and place, in the Europe/Oslo offset for that date.
 *
 * North of the Arctic Circle a day can have no sunrise and no sunset at all;
 * `polarCondition` then says which kind of day it is rather than leaving the
 * absence unexplained.
 */
export type SunTimes = {
  date: string;
  coordinates: MetPoint;
  sunrise?: CelestialEvent;
  sunset?: CelestialEvent;
  solarNoon?: CelestialPosition;
  solarMidnight?: CelestialPosition;
  /**
   * `midnight-sun` when the sun stays above the horizon all day, `polar-night`
   * when it stays below. Absent on ordinary days.
   */
  polarCondition?: "midnight-sun" | "polar-night";
};

/** Moon times for one date and place, in the Europe/Oslo offset for that date. */
export type MoonTimes = {
  date: string;
  coordinates: MetPoint;
  moonrise?: CelestialEvent;
  moonset?: CelestialEvent;
  highMoon?: CelestialPosition;
  lowMoon?: CelestialPosition;
  /**
   * Moon phase in degrees: 0 is new moon, 90 first quarter, 180 full moon and
   * 270 last quarter.
   */
  phaseDegrees?: number;
};

/** One time step of a MET Norway ocean forecast. */
export type OceanForecastEntry = {
  time: string;
  /** Sea surface temperature in °C. */
  seaTemperature?: number;
  /** Significant wave height in metres. */
  waveHeight?: number;
  /** Direction waves come from, in degrees. */
  waveFromDirection?: number;
  /** Surface current speed in m/s. */
  currentSpeed?: number;
  /** Direction the current flows towards, in degrees. */
  currentToDirection?: number;
};

/** A MET Norway ocean forecast for the model cell nearest a point. */
export type OceanForecast = {
  updatedAt?: string;
  /** Centre of the model cell that answered, which may be some distance away. */
  coordinates: MetPoint;
  entries: OceanForecastEntry[];
};

/** A pollutant's forecast concentration and its contribution to the index. */
export type AirQualityComponent = {
  /** Concentration in µg/m³. */
  concentration?: number;
  /** This pollutant's air-quality index value. */
  index?: number;
};

/** One hour of a MET Norway air-quality forecast. */
export type AirQualityForecastEntry = {
  from: string;
  to: string;
  /** Overall air-quality index, the highest of the component indices. */
  index?: number;
  no2?: AirQualityComponent;
  pm10?: AirQualityComponent;
  pm25?: AirQualityComponent;
  o3?: AirQualityComponent;
};

/** An area the air-quality model resolves a point to. */
export type AirQualityArea = {
  name: string;
  /** Area level, e.g. `grunnkrets` (basic statistical unit) or `kommune`. */
  areaClass: string;
  areaCode: string;
  /** Slash-separated path from county to area, when published. */
  path?: string;
  latitude: number;
  longitude: number;
};

/**
 * A MET Norway air-quality forecast for the statistical area containing a point.
 *
 * Experimental: MET Norway publishes this product as version 0.1, and its contract
 * may change. Values are model forecasts, not measurements.
 */
export type AirQualityForecast = {
  /** Model run the forecast is based on. */
  referenceTime: string;
  area: AirQualityArea;
  parentArea?: AirQualityArea;
  entries: AirQualityForecastEntry[];
};
