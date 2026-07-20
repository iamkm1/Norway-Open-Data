import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import {
  InputValidationError,
  NotFoundError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import { NorgesBankClient } from "../../src/providers/norges-bank/client.js";
import {
  emptyExchangeRateCsv,
  eurLatestCsv,
  eurRangeCsv,
  jpyLatestCsv,
  nowaCsv,
  policyRateCsv,
  usdRangeCsv,
} from "../fixtures/norges-bank.js";
import { sequenceFetch } from "./helpers.js";

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/csv" } });
}

function createClient(fetch: typeof globalThis.fetch, cacheEnabled = false): NorgesBankClient {
  return new NorgesBankClient(
    new HttpClient({
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: cacheEnabled, maxEntries: 100 },
      credentials: { nve: {} },
    }),
  );
}

describe("Norges Bank SDMX data", () => {
  it("fetches and normalizes the latest EUR/NOK observation", async () => {
    const { fetch, mock } = sequenceFetch(textResponse(eurLatestCsv));
    const result = await createClient(fetch).getExchangeRate({ from: "eur" }, { includeRaw: true });

    expect(result.data).toEqual({
      baseCurrency: "EUR",
      quoteCurrency: "NOK",
      date: "2026-07-20",
      value: 11.042,
      unit: 1,
      seriesId: "EXR/B.EUR.NOK.SP",
    });
    expect(result.raw).toBe(eurLatestCsv);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/api/data/EXR/B.EUR.NOK.SP");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      format: "csv-both",
      lastNObservations: "1",
      locale: "en",
    });
    const headers = new Headers((mock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get("Accept")).toBe("text/csv");
  });

  it("returns historical observations without filling weekend gaps", async () => {
    const { fetch, mock } = sequenceFetch(textResponse(eurRangeCsv));
    const result = await createClient(fetch).getExchangeRates({
      from: "EUR",
      startDate: "2026-07-17",
      endDate: "2026-07-20",
    });

    expect(result.data.map((rate) => rate.date)).toEqual(["2026-07-17", "2026-07-20"]);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("startPeriod")).toBe("2026-07-17");
    expect(url.searchParams.get("endPeriod")).toBe("2026-07-20");
  });

  it("preserves official currency units and inverts NOK quotations", async () => {
    const direct = sequenceFetch(textResponse(jpyLatestCsv));
    const jpy = await createClient(direct.fetch).getExchangeRate({ from: "JPY" });
    expect(jpy.data).toMatchObject({ value: 5.9513, unit: 100, seriesId: "EXR/B.JPY.NOK.SP" });

    const inverse = sequenceFetch(textResponse(eurLatestCsv));
    const nok = await createClient(inverse.fetch).getExchangeRate({ from: "NOK", to: "EUR" });
    expect(nok.data).toMatchObject({
      baseCurrency: "NOK",
      quoteCurrency: "EUR",
      date: "2026-07-20",
      unit: 1,
      sourceSeriesIds: ["EXR/B.EUR.NOK.SP"],
    });
    expect(nok.data.value).toBeCloseTo(1 / 11.042);
  });

  it("derives non-NOK cross rates only from same-date official observations", async () => {
    const { fetch } = sequenceFetch(textResponse(eurRangeCsv), textResponse(usdRangeCsv));
    const result = await createClient(fetch).getExchangeRates({
      from: "EUR",
      to: "USD",
      startDate: "2026-07-17",
      endDate: "2026-07-20",
    });

    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({
      baseCurrency: "EUR",
      quoteCurrency: "USD",
      date: "2026-07-17",
      unit: 1,
      sourceSeriesIds: ["EXR/B.EUR.NOK.SP", "EXR/B.USD.NOK.SP"],
    });
    expect(result.data[0]?.value).toBeCloseTo(11.039 / 9.45);
  });

  it("finds the latest shared date when cross-rate series have different latest days", async () => {
    const staggeredUsd = usdRangeCsv.replace("2026-07-20,9.5", "2026-07-19,9.5");
    const { fetch, mock } = sequenceFetch(textResponse(eurRangeCsv), textResponse(staggeredUsd));
    const result = await createClient(fetch).getExchangeRate({ from: "EUR", to: "USD" });

    expect(result.data.date).toBe("2026-07-17");
    expect(result.data.value).toBeCloseTo(11.039 / 9.45);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(
      mock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("lastNObservations")),
    ).toEqual(["10", "10"]);
  });

  it("uses the current policy-rate and SHORT_RATES Nowa series", async () => {
    const { fetch, mock } = sequenceFetch(textResponse(policyRateCsv), textResponse(nowaCsv));
    const client = createClient(fetch);
    const policy = await client.getPolicyRate({
      startDate: "2026-07-16",
      endDate: "2026-07-17",
    });
    const nowa = await client.getNowa({
      startDate: "2026-07-16",
      endDate: "2026-07-17",
    });

    expect(policy.data[0]).toEqual({
      date: "2026-07-16",
      value: 4.25,
      name: "Policy rate",
      seriesId: "IR/B.KPRA.SD.R",
    });
    expect(nowa.data[0]).toEqual({
      date: "2026-07-16",
      value: 4.24,
      name: "Nowa",
      seriesId: "SHORT_RATES/B.NOWA.ON.R",
    });
    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe("/api/data/IR/B.KPRA.SD.R");
    expect(new URL(String(mock.mock.calls[1]?.[0])).pathname).toBe(
      "/api/data/SHORT_RATES/B.NOWA.ON.R",
    );
  });

  it("returns a validated empty range without creating observations", async () => {
    const { fetch } = sequenceFetch(textResponse(emptyExchangeRateCsv));
    const result = await createClient(fetch).getExchangeRates({
      from: "EUR",
      startDate: "2026-07-18",
      endDate: "2026-07-19",
    });
    expect(result.data).toEqual([]);
  });

  it("raises a clear not-found error when Norges Bank reports no observation", async () => {
    const { fetch } = sequenceFetch(textResponse("no data", 404));
    await expect(
      createClient(fetch).getExchangeRate({ from: "EUR", date: "2026-07-19" }),
    ).rejects.toMatchObject({
      constructor: NotFoundError,
      provider: "norges-bank",
      statusCode: 404,
    });
  });

  it("rejects invalid currencies, dates, and ranges before fetching", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const client = createClient(fetch);
    await expect(client.getExchangeRate({ from: "EU" })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(
      client.getExchangeRates({ from: "EUR", date: "2026-02-30" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      client.getExchangeRates({
        from: "EUR",
        startDate: "2026-07-20",
        endDate: "2026-07-17",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getPolicyRate({ startDate: "20 July" })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed CSV and caches valid observations", async () => {
    const malformed = sequenceFetch(textResponse("FREQ,BASE_CUR\nB,EUR,extra\n"));
    await expect(
      createClient(malformed.fetch).getExchangeRate({ from: "EUR" }),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const cached = sequenceFetch(textResponse(eurLatestCsv));
    const client = createClient(cached.fetch, true);
    const first = await client.getExchangeRate({ from: "EUR" });
    const second = await client.getExchangeRate({ from: "EUR" });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(cached.mock).toHaveBeenCalledTimes(1);
  });
});
