import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { nveProvider } from "./provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  hydrologyObservationsSchema,
  hydrologyStationsSchema,
  type RawHydrologyObservations,
  type RawHydrologyStations,
  type RawWarnings,
  warningsSchema,
} from "./schemas.js";
import type {
  HazardWarning,
  HazardWarningParameters,
  HydrologyObservation,
  HydrologyObservationParameters,
  HydrologyStation,
  HydrologyStationParameters,
} from "./types.js";

const FORECAST_BASE_URL = "https://api01.nve.no/hydrology/forecast";
const HYDAPI_BASE_URL = "https://hydapi.nve.no/api/v1";
const isoDateSchema = z.iso.date();
const osloDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const warningParametersSchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  language: z.enum(["no", "en"]).optional(),
});

const stationParametersSchema = z.object({
  stationId: z
    .string()
    .regex(/^(?:\d+\.\d+\.(?:\d+|\*)|\d+\.\*\.\*)$/)
    .optional(),
  stationName: z.string().trim().min(1).optional(),
  municipalityCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  municipalityName: z.string().trim().min(1).optional(),
  countyName: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
});

const observationParametersSchema = z.object({
  stationId: z.string().regex(/^\d+\.\d+\.\d+$/),
  parameter: z.string().regex(/^\d+$/),
  resolutionTime: z.enum(["inst", "hour", "day", "0", "60", "1440"]),
  startDate: z.iso.datetime({ local: true }).or(z.iso.date()).optional(),
  endDate: z.iso.datetime({ local: true }).or(z.iso.date()).optional(),
});

function todayOslo(): string {
  return osloDateFormatter.format(new Date());
}

function parseWarningParameters(parameters: HazardWarningParameters): {
  startDate: string;
  endDate: string;
  languageCode: number;
} {
  const parsed = warningParametersSchema.safeParse(parameters);
  if (!parsed.success) {
    throw new InputValidationError("Invalid NVE warning parameters.", {
      provider: nveProvider.id,
      cause: parsed.error,
    });
  }
  const startDate = parsed.data.startDate ?? todayOslo();
  const endDate = parsed.data.endDate ?? startDate;
  if (endDate < startDate) {
    throw new InputValidationError("NVE warning endDate cannot precede startDate.", {
      provider: nveProvider.id,
    });
  }
  return { startDate, endDate, languageCode: parsed.data.language === "en" ? 2 : 1 };
}

function normalizeWarnings(raw: RawWarnings, type: HazardWarning["type"]): HazardWarning[] {
  return raw.map((warning) => {
    const forecastRegion =
      warning.RegionId == null && warning.RegionName == null
        ? undefined
        : {
            ...(warning.RegionId == null ? {} : { id: String(warning.RegionId) }),
            ...(warning.RegionName == null ? {} : { name: warning.RegionName }),
          };
    const counties = (warning.CountyList ?? []).map((county) => {
      const code = county.Id == null ? undefined : normalizeAdministrativeCode(county.Id, 2);
      return {
        ...(code === undefined ? {} : { code }),
        name: county.Name.trim(),
      };
    });
    const municipalities = (warning.MunicipalityList ?? []).map((municipality) => {
      const code =
        municipality.Id == null ? undefined : normalizeAdministrativeCode(municipality.Id, 4);
      return {
        ...(code === undefined ? {} : { code }),
        name: municipality.Name.trim(),
      };
    });
    const regions = [
      warning.RegionName,
      ...counties.map((county) => county.name),
      ...municipalities.map((municipality) => municipality.name),
    ].filter((value): value is string => value != null && value.length > 0);
    const uniqueRegions = [...new Set(regions)];
    const avalancheRegIdIsSentinel =
      type === "avalanche" &&
      (warning.RegId === 0 || (typeof warning.RegId === "string" && warning.RegId.trim() === "0"));
    const idValue = avalancheRegIdIsSentinel
      ? warning.RegionId
      : (warning.RegId ?? warning.RegionId);
    const hasCoordinates = warning.Latitude != null || warning.Longitude != null;
    return {
      ...(idValue == null ? {} : { id: String(idValue) }),
      type,
      ...(warning.DangerLevel == null ? {} : { level: String(warning.DangerLevel) }),
      ...(warning.DangerLevelName == null ? {} : { title: warning.DangerLevelName }),
      ...(warning.MainText == null ? {} : { description: warning.MainText }),
      validFrom: warning.ValidFrom,
      validTo: warning.ValidTo,
      ...(forecastRegion === undefined ? {} : { forecastRegion }),
      ...(counties.length === 0 ? {} : { counties }),
      ...(municipalities.length === 0 ? {} : { municipalities }),
      ...(uniqueRegions.length === 0 ? {} : { regions: uniqueRegions }),
      ...(hasCoordinates
        ? {
            coordinates: {
              ...(warning.Latitude == null ? {} : { latitude: warning.Latitude }),
              ...(warning.Longitude == null ? {} : { longitude: warning.Longitude }),
            },
          }
        : {}),
    };
  });
}

function normalizeAdministrativeCode(value: string | number, width: 2 | 4): string | undefined {
  const code = String(value).trim();
  return /^0+$/u.test(code) ? undefined : code.padStart(width, "0");
}

function normalizeStation(
  raw: RawHydrologyStations["data"] extends (infer T)[] | null | undefined ? T : never,
): HydrologyStation | undefined {
  if (raw.stationId == null) return undefined;
  return {
    id: raw.stationId,
    ...(raw.stationName == null ? {} : { name: raw.stationName }),
    ...(raw.latitude == null ? {} : { latitude: raw.latitude }),
    ...(raw.longitude == null ? {} : { longitude: raw.longitude }),
    ...(raw.masl == null ? {} : { elevationMasl: raw.masl }),
    ...(raw.riverName == null ? {} : { riverName: raw.riverName }),
    ...(raw.councilNumber == null ? {} : { municipalityCode: raw.councilNumber }),
    ...(raw.councilName == null ? {} : { municipalityName: raw.councilName }),
    ...(raw.countyName == null ? {} : { countyName: raw.countyName }),
    ...(raw.stationStatusName == null ? {} : { status: raw.stationStatusName }),
  };
}

/**
 * Client for NVE's open warning feeds and API-key-protected HydAPI.
 *
 * Normalized warning records are discovery summaries. Public warning displays
 * must retain the complete provider payload and follow NVE/Varsom's current
 * service-specific attribution and presentation terms; use `includeRaw` when
 * building such a display.
 */
export class NveHazardsClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Gets public flood warnings for a bounded date interval. */
  async getFloodWarnings(
    parameters: HazardWarningParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HazardWarning[]>> {
    return this.#getWarnings("flood", parameters, options);
  }

  /** Gets public avalanche warnings for a bounded date interval. */
  async getAvalancheWarnings(
    parameters: HazardWarningParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HazardWarning[]>> {
    return this.#getWarnings("avalanche", parameters, options);
  }

  /** Gets public landslide warnings for a bounded date interval. */
  async getLandslideWarnings(
    parameters: HazardWarningParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HazardWarning[]>> {
    return this.#getWarnings("landslide", parameters, options);
  }

  /** Searches NVE hydrology stations. Requires a free HydAPI key. */
  async getHydrologyStations(
    parameters: HydrologyStationParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HydrologyStation[]>> {
    const parsed = stationParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid NVE hydrology station parameters.", {
        provider: nveProvider.id,
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: nveProvider,
      url: `${HYDAPI_BASE_URL}/Stations`,
      query: {
        StationId: parsed.data.stationId,
        StationName: parsed.data.stationName,
        CouncilNumber: parsed.data.municipalityCode,
        CouncilName: parsed.data.municipalityName,
        CountyName: parsed.data.countyName,
        Active: parsed.data.active === false ? 0 : 1,
      },
      authenticate: true,
      schema: hydrologyStationsSchema,
      options,
      cacheTtlMs: nveProvider.cacheTtlMs.station,
    });
    const stations = (result.data.data ?? [])
      .map(normalizeStation)
      .filter((station): station is HydrologyStation => station !== undefined);
    return createResponse(
      stations,
      responseSource(nveProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets observations for one HydAPI series. Requires a free HydAPI key. */
  async getHydrologyObservations(
    parameters: HydrologyObservationParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HydrologyObservation[]>> {
    const parsed = observationParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid NVE hydrology observation parameters.", {
        provider: nveProvider.id,
        cause: parsed.error,
      });
    }
    if (
      parsed.data.startDate !== undefined &&
      parsed.data.endDate !== undefined &&
      parsed.data.endDate < parsed.data.startDate
    ) {
      throw new InputValidationError("NVE observation endDate cannot precede startDate.", {
        provider: nveProvider.id,
      });
    }
    const referenceTime =
      parsed.data.startDate === undefined && parsed.data.endDate === undefined
        ? undefined
        : `${parsed.data.startDate ?? ""}/${parsed.data.endDate ?? ""}`;
    const result = await this.#http.request({
      provider: nveProvider,
      url: `${HYDAPI_BASE_URL}/Observations`,
      query: {
        StationId: parsed.data.stationId,
        Parameter: parsed.data.parameter,
        ResolutionTime: parsed.data.resolutionTime,
        ReferenceTime: referenceTime,
      },
      authenticate: true,
      schema: hydrologyObservationsSchema,
      options,
      cacheTtlMs: nveProvider.cacheTtlMs.observation,
    });
    const observations = normalizeObservations(result.data, parsed.data);
    return createResponse(
      observations,
      responseSource(nveProvider),
      result.data,
      result.cached,
      options,
    );
  }

  async #getWarnings(
    type: "flood" | "avalanche" | "landslide",
    parameters: HazardWarningParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<HazardWarning[]>> {
    const parsed = parseWarningParameters(parameters);
    const version = type === "avalanche" ? "v6.3.2" : "v1.0.10";
    const qualifier = type === "avalanche" ? "/All" : "";
    const result = await this.#http.request({
      provider: nveProvider,
      url: `${FORECAST_BASE_URL}/${type}/${version}/api/Warning${qualifier}/${parsed.languageCode}/${parsed.startDate}/${parsed.endDate}`,
      schema: warningsSchema,
      options,
      cacheTtlMs: nveProvider.cacheTtlMs.warning,
    });
    return createResponse(
      normalizeWarnings(result.data, type),
      responseSource(nveProvider),
      result.data,
      result.cached,
      options,
    );
  }
}

function normalizeObservations(
  raw: RawHydrologyObservations,
  parameters: Pick<HydrologyObservationParameters, "stationId" | "parameter">,
): HydrologyObservation[] {
  return (raw.data ?? []).map((observation) => ({
    stationId: parameters.stationId,
    parameter: parameters.parameter,
    time: observation.time,
    value: observation.value,
  }));
}
