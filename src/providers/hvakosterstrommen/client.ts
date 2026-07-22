import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
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
const HOUR_MS = 60 * 60 * 1_000;

const areaSchema = z.enum(["NO1", "NO2", "NO3", "NO4", "NO5"]);

const parametersSchema = z.object({
  area: areaSchema,
  date: z.iso.date().optional(),
});

const currentParametersSchema = z.object({ area: areaSchema });

const osloTimestampFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Oslo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** Returns the current calendar date in Europe/Oslo as `YYYY-MM-DD`. */
function osloToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Oslo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizePrices(
  raw: RawElectricityPrices,
  area: PriceArea,
  date: string,
): ElectricityPrice[] {
  const followingMidnight = osloIsoTimestamp(osloMidnight(followingDate(date)));
  return raw.map((entry, index) => ({
    area,
    startsAt: entry.time_start,
    endsAt: raw[index + 1]?.time_start ?? followingMidnight,
    nokPerKwh: entry.NOK_per_kWh,
    eurPerKwh: entry.EUR_per_kWh,
    exchangeRate: entry.EXR,
  }));
}

function followingDate(date: string): string {
  const instant = new Date(`${date}T00:00:00Z`);
  instant.setUTCDate(instant.getUTCDate() + 1);
  return instant.toISOString().slice(0, 10);
}

function osloLocalTimestamp(instant: number): string {
  const parts = Object.fromEntries(
    osloTimestampFormatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}`;
}

function osloMidnight(date: string): number {
  const targetAsUtc = Date.parse(`${date}T00:00:00Z`);
  let instant = targetAsUtc;

  // Convert the requested wall-clock midnight to its exact Europe/Oslo instant.
  // Iterating also keeps this independent of whether the date uses CET or CEST.
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const renderedAsUtc = Date.parse(`${osloLocalTimestamp(instant)}Z`);
    instant -= renderedAsUtc - targetAsUtc;
  }
  return instant;
}

function osloIsoTimestamp(instant: number): string {
  const localTimestamp = osloLocalTimestamp(instant);
  const localAsUtc = Date.parse(`${localTimestamp}Z`);
  const offsetMinutes = Math.round((localAsUtc - instant) / (60 * 1_000));
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${localTimestamp}${sign}${hours}:${minutes}`;
}

function invalidPriceIntervals(): ResponseValidationError {
  return new ResponseValidationError(
    "Hva koster strømmen returned incomplete, invalid, or non-contiguous hourly price intervals.",
    { provider: "hvakosterstrommen" },
  );
}

function validatePriceIntervals(raw: RawElectricityPrices, date: string): RawElectricityPrices {
  const dayStart = osloMidnight(date);
  const dayEnd = osloMidnight(followingDate(date));
  const expectedIntervals = (dayEnd - dayStart) / HOUR_MS;
  if (![23, 24, 25].includes(expectedIntervals) || raw.length !== expectedIntervals) {
    throw invalidPriceIntervals();
  }

  for (const [index, entry] of raw.entries()) {
    const start = Date.parse(entry.time_start);
    const end = Date.parse(entry.time_end);
    const expectedStart = dayStart + index * HOUR_MS;
    const nextStartValue = raw[index + 1]?.time_start;
    const followingStartValue = raw[index + 2]?.time_start;
    const expectedEnd = nextStartValue === undefined ? dayEnd : Date.parse(nextStartValue);
    const usesOsloStart =
      Number.isFinite(start) && entry.time_start.slice(0, 19) === osloLocalTimestamp(start);
    const usesOsloEnd =
      Number.isFinite(end) && entry.time_end.slice(0, 19) === osloLocalTimestamp(end);

    // Hva koster strømmen has historically ended the first repeated 02:00
    // interval at 03:00 CET on valid autumn fallback days. Accept only that
    // narrow provider-native anomaly; normalized output still ends at the next
    // chronological start (02:00 CET).
    const isAutumnFallbackEndAnomaly =
      expectedIntervals === 25 &&
      nextStartValue !== undefined &&
      followingStartValue !== undefined &&
      entry.time_start.slice(0, 19) === nextStartValue.slice(0, 19) &&
      Date.parse(nextStartValue) === start + HOUR_MS &&
      Date.parse(followingStartValue) === start + 2 * HOUR_MS &&
      end === Date.parse(followingStartValue);

    if (
      start !== expectedStart ||
      !usesOsloStart ||
      !usesOsloEnd ||
      (end !== expectedEnd && !isAutumnFallbackEndAnomaly)
    ) {
      throw invalidPriceIntervals();
    }
  }
  return raw;
}

/** Client for hourly Norwegian electricity spot prices from Hva koster strømmen? */
export class ElectricityClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Gets the hourly spot prices for one bidding zone and date.
   *
   * A Norwegian local day normally has 24 intervals, but daylight-saving
   * transitions can produce 23 or 25.
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
      resourceDescription: `price data for ${parsed.data.area} on ${date}`,
      notFoundHint: "Next-day prices are normally published in the early afternoon.",
      schema: electricityPricesSchema,
      transform: (data) => validatePriceIntervals(data, date),
      options,
      cacheTtlMs: PRICE_TTL_MS,
    });
    return createResponse(
      normalizePrices(result.data, parsed.data.area, date),
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
