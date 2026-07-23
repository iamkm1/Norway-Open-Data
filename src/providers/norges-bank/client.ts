import type { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, NotFoundError, ResponseValidationError } from "../../core/errors.js";
import { responseSource } from "../../core/provider.js";
import { norgesBankProvider } from "./provider.js";
import type { OpenDataResponse, QueryParameters, RequestOptions } from "../../core/types.js";
import { parseCsvDocument } from "./csv.js";
import {
  csvTextSchema,
  exchangeRateInputSchema,
  exchangeRateRowSchema,
  nowaRowSchema,
  policyRateRowSchema,
  timeSeriesInputSchema,
  type RawExchangeRateRow,
} from "./schemas.js";
import type {
  CurrencyRate,
  ExchangeRateParameters,
  InterestRateObservation,
  TimeSeriesParameters,
} from "./types.js";

const BASE_URL = "https://data.norges-bank.no/api/data";
const POLICY_SERIES = "IR/B.KPRA.SD.R";
const NOWA_SERIES = "SHORT_RATES/B.NOWA.ON.R";

type ValidExchangeRateInput = z.output<typeof exchangeRateInputSchema>;
type RawCurrencyObservation = {
  currency: string;
  date: string;
  value: number;
  unit: number;
  seriesId: string;
};
type TextResult = { data: string; cached: boolean };
type ExchangeData = { rates: CurrencyRate[]; raw: unknown; cached: boolean };

function queryForDates(parameters: {
  date?: string;
  startDate?: string;
  endDate?: string;
}): QueryParameters {
  if (parameters.date !== undefined) {
    return {
      format: "csv-both",
      locale: "en",
      startPeriod: parameters.date,
      endPeriod: parameters.date,
    };
  }
  if (parameters.startDate !== undefined || parameters.endDate !== undefined) {
    return {
      format: "csv-both",
      locale: "en",
      startPeriod: parameters.startDate,
      endPeriod: parameters.endDate,
    };
  }
  return { format: "csv-both", locale: "en", lastNObservations: 1 };
}

function parseRows<T>(
  csv: string,
  schema: z.ZodType<T>,
  description: string,
  requiredColumns: readonly string[],
): T[] {
  let records: Array<Record<string, string>>;
  try {
    const parsedCsv = parseCsvDocument(csv);
    if (requiredColumns.some((column) => !parsedCsv.header.includes(column))) {
      throw new Error("CSV response omitted required columns.");
    }
    records = parsedCsv.records;
  } catch (cause) {
    throw new ResponseValidationError(`Norges Bank returned malformed ${description} CSV.`, {
      provider: norgesBankProvider.id,
      cause,
    });
  }
  const parsed = schema.array().safeParse(records);
  if (!parsed.success) {
    throw new ResponseValidationError(
      `Norges Bank returned ${description} data with an unexpected structure.`,
      { provider: norgesBankProvider.id, cause: parsed.error },
    );
  }
  return parsed.data;
}

function normalizeOfficialRate(row: RawExchangeRateRow): RawCurrencyObservation {
  const exponent = Number(row.UNIT_MULT);
  const unit = 10 ** exponent;
  const value = Number(row.OBS_VALUE);
  if (!Number.isSafeInteger(unit) || unit <= 0 || !Number.isFinite(value) || value <= 0) {
    throw new ResponseValidationError("Norges Bank returned an invalid exchange-rate value.", {
      provider: norgesBankProvider.id,
    });
  }
  return {
    currency: row.BASE_CUR,
    date: row.TIME_PERIOD,
    value,
    unit,
    seriesId: `EXR/B.${row.BASE_CUR}.NOK.SP`,
  };
}

function directRate(observation: RawCurrencyObservation): CurrencyRate {
  return {
    baseCurrency: observation.currency,
    quoteCurrency: "NOK",
    date: observation.date,
    value: observation.value,
    unit: observation.unit,
    seriesId: observation.seriesId,
  };
}

function inverseRate(observation: RawCurrencyObservation): CurrencyRate {
  return {
    baseCurrency: "NOK",
    quoteCurrency: observation.currency,
    date: observation.date,
    value: observation.unit / observation.value,
    unit: 1,
    sourceSeriesIds: [observation.seriesId],
  };
}

function crossRates(from: RawCurrencyObservation[], to: RawCurrencyObservation[]): CurrencyRate[] {
  const toByDate = new Map(to.map((observation) => [observation.date, observation]));
  return from.flatMap((baseObservation) => {
    const quoteObservation = toByDate.get(baseObservation.date);
    if (quoteObservation === undefined) return [];
    return [
      {
        baseCurrency: baseObservation.currency,
        quoteCurrency: quoteObservation.currency,
        date: baseObservation.date,
        value: baseObservation.value / (quoteObservation.value / quoteObservation.unit),
        unit: baseObservation.unit,
        sourceSeriesIds: [baseObservation.seriesId, quoteObservation.seriesId],
      },
    ];
  });
}

function normalizeInterestRows(
  rows: Array<{ TIME_PERIOD: string; OBS_VALUE: string }>,
  name: string,
  seriesId: string,
): InterestRateObservation[] {
  return rows.map((row) => {
    const value = Number(row.OBS_VALUE);
    if (!Number.isFinite(value)) {
      throw new ResponseValidationError("Norges Bank returned an invalid interest-rate value.", {
        provider: norgesBankProvider.id,
      });
    }
    return { date: row.TIME_PERIOD, value, name, seriesId };
  });
}

const EXCHANGE_RATE_COLUMNS = [
  "FREQ",
  "BASE_CUR",
  "QUOTE_CUR",
  "TENOR",
  "DECIMALS",
  "CALCULATED",
  "UNIT_MULT",
  "COLLECTION",
  "TIME_PERIOD",
  "OBS_VALUE",
] as const;
const POLICY_RATE_COLUMNS = [
  "FREQ",
  "INSTRUMENT_TYPE",
  "TENOR",
  "UNIT_MEASURE",
  "DECIMALS",
  "COLLECTION",
  "TIME_PERIOD",
  "OBS_VALUE",
  "CALC_METHOD",
] as const;
const NOWA_COLUMNS = POLICY_RATE_COLUMNS;

/** Client for Norges Bank's anonymous SDMX REST data warehouse. */
export class NorgesBankClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Returns the latest observation in the requested period.
   *
   * Exact weekend and holiday dates are not shifted: Norges Bank reports no
   * observation, and this method raises `NotFoundError` instead of fabricating one.
   */
  async getExchangeRate(
    parameters: ExchangeRateParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CurrencyRate>> {
    const parsed = this.#parseExchangeInput(parameters);
    const result = await this.#exchangeData(parsed, options);
    const rate = result.rates.at(-1);
    if (rate === undefined) {
      throw new NotFoundError(
        "Norges Bank published no exchange-rate observation for the requested currencies and period.",
        { provider: norgesBankProvider.id, statusCode: 404 },
      );
    }
    return createResponse(
      rate,
      responseSource(norgesBankProvider),
      result.raw,
      result.cached,
      options,
    );
  }

  /**
   * Returns all published daily observations in the requested inclusive range.
   * Dates without observations are omitted and never interpolated.
   */
  async getExchangeRates(
    parameters: ExchangeRateParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CurrencyRate[]>> {
    const parsed = this.#parseExchangeInput(parameters);
    const result = await this.#exchangeData(parsed, options);
    return createResponse(
      result.rates,
      responseSource(norgesBankProvider),
      result.raw,
      result.cached,
      options,
    );
  }

  /** Returns official business-day observations for the Norges Bank policy rate. */
  async getPolicyRate(
    parameters: TimeSeriesParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<InterestRateObservation[]>> {
    return this.#interestRates(
      parameters,
      POLICY_SERIES,
      policyRateRowSchema,
      "Policy rate",
      options,
    );
  }

  /** Returns official business-day Nowa overnight-rate observations. */
  async getNowa(
    parameters: TimeSeriesParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<InterestRateObservation[]>> {
    return this.#interestRates(parameters, NOWA_SERIES, nowaRowSchema, "Nowa", options);
  }

  #parseExchangeInput(parameters: ExchangeRateParameters): ValidExchangeRateInput {
    const parsed = exchangeRateInputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Norges Bank exchange-rate query.", {
        provider: norgesBankProvider.id,
        cause: parsed.error,
      });
    }
    return parsed.data;
  }

  async #exchangeData(
    parameters: ValidExchangeRateInput,
    options?: RequestOptions,
  ): Promise<ExchangeData> {
    const to = parameters.to ?? "NOK";
    const query = queryForDates(parameters);
    if (to === "NOK") {
      const result = await this.#currencySeries(parameters.from, query, options);
      return {
        rates: result.observations.map(directRate),
        raw: result.raw,
        cached: result.cached,
      };
    }
    if (parameters.from === "NOK") {
      const result = await this.#currencySeries(to, query, options);
      return {
        rates: result.observations.map(inverseRate),
        raw: result.raw,
        cached: result.cached,
      };
    }

    const isLatest =
      parameters.date === undefined &&
      parameters.startDate === undefined &&
      parameters.endDate === undefined;
    const crossQuery: QueryParameters = isLatest
      ? { format: "csv-both", locale: "en", lastNObservations: 10 }
      : query;
    const [base, quote] = await Promise.all([
      this.#currencySeries(parameters.from, crossQuery, options),
      this.#currencySeries(to, crossQuery, options),
    ]);
    const rates = crossRates(base.observations, quote.observations).sort((left, right) =>
      left.date.localeCompare(right.date),
    );

    return {
      rates: isLatest ? rates.slice(-1) : rates,
      raw: { base: base.raw, quote: quote.raw },
      cached: base.cached && quote.cached,
    };
  }

  async #currencySeries(
    currency: string,
    query: QueryParameters,
    options?: RequestOptions,
  ): Promise<{ observations: RawCurrencyObservation[]; raw: string; cached: boolean }> {
    const seriesId = `EXR/B.${currency}.NOK.SP`;
    const validate = (csv: string): RawExchangeRateRow[] => {
      const rows = parseRows(csv, exchangeRateRowSchema, "exchange-rate", EXCHANGE_RATE_COLUMNS);
      if (rows.some((row) => row.BASE_CUR !== currency)) {
        throw new ResponseValidationError("Norges Bank returned a different currency series.", {
          provider: norgesBankProvider.id,
        });
      }
      rows.map(normalizeOfficialRate);
      return rows;
    };
    const result = await this.#requestCsv(seriesId, query, "exchange-rate", validate, options);
    const rows = validate(result.data);
    return {
      observations: rows.map(normalizeOfficialRate),
      raw: result.data,
      cached: result.cached,
    };
  }

  async #interestRates<T extends { TIME_PERIOD: string; OBS_VALUE: string }>(
    parameters: TimeSeriesParameters,
    seriesId: string,
    schema: z.ZodType<T>,
    name: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<InterestRateObservation[]>> {
    const parsed = timeSeriesInputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError(`Invalid Norges Bank ${name} query.`, {
        provider: norgesBankProvider.id,
        cause: parsed.error,
      });
    }
    const requiredColumns = seriesId === NOWA_SERIES ? NOWA_COLUMNS : POLICY_RATE_COLUMNS;
    const validate = (csv: string): T[] => {
      const rows = parseRows(csv, schema, name, requiredColumns);
      normalizeInterestRows(rows, name, seriesId);
      return rows;
    };
    const result = await this.#requestCsv(
      seriesId,
      queryForDates(parsed.data),
      name,
      validate,
      options,
    );
    const rows = validate(result.data);
    return createResponse(
      normalizeInterestRows(rows, name, seriesId),
      responseSource(norgesBankProvider),
      result.data,
      result.cached,
      options,
    );
  }

  async #requestCsv(
    seriesId: string,
    query: QueryParameters,
    description: string,
    validate: (csv: string) => unknown,
    options?: RequestOptions,
  ): Promise<TextResult> {
    try {
      return await this.#http.request({
        provider: norgesBankProvider,
        url: `${BASE_URL}/${seriesId}`,
        query,
        headers: { Accept: "text/csv" },
        responseType: "text",
        schema: csvTextSchema,
        transform: (data) => {
          validate(data);
          return data;
        },
        options,
        cacheTtlMs: norgesBankProvider.cacheTtlMs.rates,
      });
    } catch (cause) {
      if (cause instanceof NotFoundError) {
        throw new NotFoundError(
          `Norges Bank published no ${description} observations for the requested series and period.`,
          { provider: norgesBankProvider.id, statusCode: 404, cause },
        );
      }
      throw cause;
    }
  }
}
