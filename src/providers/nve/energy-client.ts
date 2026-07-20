import { createResponse, HttpClient } from "../../core/client.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  hydropowerPlantsSchema,
  reservoirStatisticsSchema,
  type RawHydropowerPlants,
  type RawReservoirStatistics,
  type RawWindPowerPlants,
  windPowerPlantsSchema,
} from "./schemas.js";
import type { PowerPlant, ReservoirStatistic } from "./types.js";

const RESERVOIR_URL =
  "https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligDataSisteUke";
const HYDROPOWER_URL = "https://api.nve.no/web/Powerplant/GetHydroPowerPlantsInOperation";
const WIND_POWER_URL = "https://api.nve.no/web/WindPowerplant/GetWindPowerPlantsInOperation";
const RESERVOIR_TTL_MS = 60 * 60 * 1_000;
const POWER_PLANT_TTL_MS = 24 * 60 * 60 * 1_000;

function normalizeReservoir(raw: RawReservoirStatistics[number]): ReservoirStatistic {
  return {
    date: raw.dato_Id,
    areaType: raw.omrType,
    areaNumber: raw.omrnr,
    year: raw.iso_aar,
    week: raw.iso_uke,
    fillLevel: raw.fyllingsgrad,
    capacityTwh: raw.kapasitet_TWh,
    storedEnergyTwh: raw.fylling_TWh,
    ...(raw.fyllingsgrad_forrige_uke == null
      ? {}
      : { previousWeekFillLevel: raw.fyllingsgrad_forrige_uke }),
    ...(raw.endring_fyllingsgrad == null ? {} : { fillLevelChange: raw.endring_fyllingsgrad }),
    ...(raw.neste_Publiseringsdato == null ? {} : { nextPublishedAt: raw.neste_Publiseringsdato }),
  };
}

function normalizeHydropower(raw: RawHydropowerPlants[number]): PowerPlant {
  return {
    id: String(raw.VannKraftverkID),
    name: raw.Navn,
    type: "hydropower",
    ...(raw.KommuneNr == null ? {} : { municipalityCode: String(raw.KommuneNr) }),
    ...(raw.Kommune == null ? {} : { municipalityName: raw.Kommune }),
    ...(raw.MaksYtelse == null ? {} : { capacityMw: raw.MaksYtelse }),
    ...(raw.MidProd_91_20 == null ? {} : { annualProductionGwh: raw.MidProd_91_20 }),
    ...(raw.Kraftverkstatus == null
      ? raw.ErIDrift == null
        ? {}
        : { status: raw.ErIDrift ? "in operation" : "not in operation" }
      : { status: raw.Kraftverkstatus }),
  };
}

function normalizeWindPower(raw: RawWindPowerPlants[number]): PowerPlant {
  return {
    id: String(raw.VindkraftAnleggId),
    name: raw.Navn,
    type: "wind",
    ...(raw.Kommunenummer == null ? {} : { municipalityCode: String(raw.Kommunenummer) }),
    ...(raw.Kommune == null ? {} : { municipalityName: raw.Kommune }),
    ...(raw.InstallertEffekt_MW == null ? {} : { capacityMw: raw.InstallertEffekt_MW }),
    ...(raw.NormalAArsproduksjon_GWh == null
      ? {}
      : { annualProductionGwh: raw.NormalAArsproduksjon_GWh }),
  };
}

/** Client for NVE's anonymous reservoir and operational power-plant APIs. */
export class NveEnergyClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Gets NVE's latest published weekly reservoir statistics. */
  async getReservoirStatistics(
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ReservoirStatistic[]>> {
    const result = await this.#http.request({
      provider: "nve",
      url: RESERVOIR_URL,
      schema: reservoirStatisticsSchema,
      options,
      cacheTtlMs: RESERVOIR_TTL_MS,
    });
    return createResponse(
      result.data.map(normalizeReservoir),
      responseSource(providers.nve),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets all hydropower plants that NVE currently marks as operational. */
  async getHydropowerPlants(options?: RequestOptions): Promise<OpenDataResponse<PowerPlant[]>> {
    const result = await this.#http.request({
      provider: "nve",
      url: HYDROPOWER_URL,
      schema: hydropowerPlantsSchema,
      options,
      cacheTtlMs: POWER_PLANT_TTL_MS,
    });
    return createResponse(
      result.data.map(normalizeHydropower),
      responseSource(providers.nve),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets all wind-power plants that NVE currently marks as operational. */
  async getWindPowerPlants(options?: RequestOptions): Promise<OpenDataResponse<PowerPlant[]>> {
    const result = await this.#http.request({
      provider: "nve",
      url: WIND_POWER_URL,
      schema: windPowerPlantsSchema,
      options,
      cacheTtlMs: POWER_PLANT_TTL_MS,
    });
    return createResponse(
      result.data.map(normalizeWindPower),
      responseSource(providers.nve),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets operational hydropower and wind-power plants in one response. */
  async getPowerPlants(options?: RequestOptions): Promise<OpenDataResponse<PowerPlant[]>> {
    const childOptions: RequestOptions = {
      includeRaw: true,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    };
    const [hydropower, wind] = await Promise.all([
      this.getHydropowerPlants(childOptions),
      this.getWindPowerPlants(childOptions),
    ]);
    return createResponse(
      [...hydropower.data, ...wind.data],
      responseSource(providers.nve),
      { hydropower: hydropower.raw, wind: wind.raw },
      hydropower.cached && wind.cached,
      options,
    );
  }
}
