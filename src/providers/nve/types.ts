/** Weekly Norwegian reservoir storage statistics published by NVE. */
export type ReservoirStatistic = {
  date: string;
  areaType: string;
  areaNumber: number;
  year: number;
  week: number;
  fillLevel: number;
  capacityTwh: number;
  storedEnergyTwh: number;
  previousWeekFillLevel?: number;
  fillLevelChange?: number;
  nextPublishedAt?: string;
};

/** A normalized operational power plant from NVE. */
export type PowerPlant = {
  id?: string;
  name: string;
  type: "hydropower" | "wind" | "other";
  municipalityCode?: string;
  municipalityName?: string;
  capacityMw?: number;
  annualProductionGwh?: number;
  status?: string;
  latitude?: number;
  longitude?: number;
};

/** Date and language filters shared by NVE warning feeds. */
export type HazardWarningParameters = {
  /** First warning date, as YYYY-MM-DD. Defaults to today in Europe/Oslo. */
  startDate?: string;
  /** Last warning date, as YYYY-MM-DD. Defaults to startDate. */
  endDate?: string;
  /** Warning text language. Defaults to Norwegian. */
  language?: "no" | "en";
};

/** A normalized warning from NVE's Varsom forecast APIs. */
export type HazardWarning = {
  id?: string;
  type: "flood" | "avalanche" | "landslide" | "other";
  level?: string;
  title?: string;
  description?: string;
  validFrom?: string;
  validTo?: string;
  /** The provider's forecast region. Context only; not an administrative-area match. */
  forecastRegion?: {
    id?: string;
    name?: string;
  };
  /** Counties attached by NVE; these can be parent context when municipalities are present. */
  counties?: Array<{
    code?: string;
    name: string;
  }>;
  /** Official municipalities explicitly attached to the warning by NVE. */
  municipalities?: Array<{
    code?: string;
    name: string;
  }>;
  /**
   * Flattened forecast-region and administrative-area names.
   *
   * Retained for backwards compatibility. Use `counties` and `municipalities`
   * when deciding whether a warning applies to an administrative area.
   */
  regions?: string[];
  coordinates?: {
    latitude?: number;
    longitude?: number;
  };
};

/** Filters supported by NVE HydAPI's station endpoint. */
export type HydrologyStationParameters = {
  stationId?: string;
  stationName?: string;
  municipalityCode?: string;
  municipalityName?: string;
  countyName?: string;
  /** Defaults to true. Set false to include inactive stations. */
  active?: boolean;
};

/** Public station metadata returned by NVE HydAPI. */
export type HydrologyStation = {
  id: string;
  name?: string;
  latitude?: number;
  longitude?: number;
  elevationMasl?: number;
  riverName?: string;
  municipalityCode?: string;
  municipalityName?: string;
  countyName?: string;
  status?: string;
};

/** Parameters required to select an NVE HydAPI observation series. */
export type HydrologyObservationParameters = {
  stationId: string;
  /** One numeric HydAPI parameter ID. One series per call preserves observation identity. */
  parameter: string;
  resolutionTime: "inst" | "hour" | "day" | "0" | "60" | "1440";
  startDate?: string;
  endDate?: string;
};

/** A normalized observation from the credential-protected NVE HydAPI. */
export type HydrologyObservation = {
  stationId: string;
  parameter?: string;
  unit?: string;
  time: string;
  value: number | null;
};
