import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { electricityPricesSchema, type RawElectricityPrices } from "./schemas.js";
import type {
  CurrentElectricityPriceParameters,
  ElectricityPrice,
  ElectricityPriceParameters,
  PriceArea,
} from "./types.js";

const BASE_URL = "https://www.hvakosterstrommen.no/api/v1/prices";
const PRICE_TTL_MS = 30 * 60 * 1_000;

const areaSchema = z.enum(["NO1", "NO2", "NO3", "NO4", "NO5"]);

const parametersSchema = z.object({
  area: areaSchema,
  date: z.iso.date().optional(),
});

const currentParametersSchema = z.object({ area: areaSchema });

/** Returns the current calendar date in Europe/Oslo as `YYYY-MM-DD`. */
function osloToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizePrices(raw: RawElectricityPrices, area: PriceArea): ElectricityPrice[] {
  return raw.map((entry) => ({
    area,
    startsAt: entry.time_start,
    endsAt: entry.time_end,
    nokPerKwh: entry.NOK_per_kWh,
    eurPerKwh: entry.EUR_per_kWh,
    exchangeRate: entry.EXR,
  }));
}

/** Client for hourly Norwegian electricity spot prices from Hva koster strømmen? */
export class ElectricityClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Gets the 24 hourly spot prices for one bidding zone and date.
   *
   * Next-day prices are normally published in the early afternoon; requesting a
   * date before publication raises `NotFoundError`.
   */
  async getPrices(
    parameters: ElectricityPriceParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ElectricityPrice[]>> {
    const parsed = parametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid electricity price parameters.", {
        provider: "hvakosterstrommen",
        cause: parsed.error,
      });
    }
    const date = parsed.data.date ?? osloToday();
    const [year, month, day] = date.split("-");
    const result = await this.#http.request({
      provider: "hvakosterstrommen",
      url: `${BASE_URL}/${year}/${month}-${day}_${parsed.data.area}.json`,
      schema: electricityPricesSchema,
      options,
      cacheTtlMs: PRICE_TTL_MS,
    });
    return createResponse(
      normalizePrices(result.data, parsed.data.area),
      responseSource(providers.hvakosterstrommen),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets the spot price covering the current hour, or `undefined` outside the published day. */
  async getCurrentPrice(
    parameters: CurrentElectricityPriceParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ElectricityPrice | undefined>> {
    const parsed = currentParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid electricity price parameters.", {
        provider: "hvakosterstrommen",
        cause: parsed.error,
      });
    }
    const day = await this.getPrices({ area: parsed.data.area }, options);
    const now = Date.now();
    const current = day.data.find(
      (price) => Date.parse(price.startsAt) <= now && now < Date.parse(price.endsAt),
    );
    return { ...day, data: current };
  }
}
