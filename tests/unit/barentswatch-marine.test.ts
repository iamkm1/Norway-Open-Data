import { describe, expect, it, vi } from "vitest";

import { tokenResponseFixture } from "../fixtures/ais.js";
import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  ResponseValidationError,
} from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

const credentials = {
  barentswatch: {
    clientId: "developer@example.test:api-client",
    clientSecret: "test-api-client-secret",
  },
} as const;

const wavePointFixture = {
  totalSignificantWaveHeight: 1.29296875,
  expectedMaximumWaveHeight: 1.994140625,
  totalMeanWaveDirection: 158,
  totalPeakPeriod: 8.203125,
  source: "met",
  fileSource: "internal-debug-name",
  forecastTime: "2026-07-24T14:00:00+02:00",
  longitude: 5.25,
  latitude: 59.4,
};

const seaCurrentFixture = {
  current: 0.42,
  direction: 212,
  forecastTime: "2026-07-24T14:00:00+02:00",
  longitude: 5.25,
  latitude: 59.4,
};

function marineSdk(
  handler: (url: URL) => Response,
  options: { withCredentials?: boolean } = {},
): { sdk: NorwayOpenData; urls: URL[] } {
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
    return handler(url);
  }) as typeof globalThis.fetch;
  const sdk = new NorwayOpenData({
    fetch,
    retries: 0,
    rateLimit: { enabled: false },
    ...(options.withCredentials === false ? {} : { credentials }),
  });
  return { sdk, urls };
}

describe("MarineClient", () => {
  it("requires its own API-client credentials, distinct from the AIS ones", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Network access must not be attempted.");
    }) as unknown as typeof globalThis.fetch;
    // AIS credentials are configured; the marine provider must still refuse,
    // because BarentsWatch issues the two client kinds separately.
    const sdk = new NorwayOpenData({
      fetch,
      credentials: {
        "barentswatch-ais": { clientId: "a@b.test:ais", clientSecret: "ais-secret-value" },
      },
    });
    await expect(
      sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    await expect(sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 })).rejects.toThrow(
      /credentials\.barentswatch\.clientId/,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("requests the api scope, not the ais scope", async () => {
    const bodies: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "id.barentswatch.no") {
        bodies.push(String(init?.body));
        return jsonResponse(tokenResponseFixture);
      }
      return jsonResponse(wavePointFixture);
    }) as typeof globalThis.fetch;
    await new NorwayOpenData({ fetch, retries: 0, credentials }).marine.getWaveForecast({
      latitude: 59.4,
      longitude: 5.25,
    });
    expect(new URLSearchParams(bodies[0]).get("scope")).toBe("api");
  });

  it("sends longitude as x and latitude as y, and normalizes the forecast", async () => {
    const { sdk, urls } = marineSdk(() => jsonResponse(wavePointFixture));
    const response = await sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 });

    const url = urls.find((candidate) => candidate.pathname.includes("waveforecastpoint"));
    // The provider names these x and y; swapping them would silently query the
    // wrong place rather than fail.
    expect(url?.searchParams.get("x")).toBe("5.25");
    expect(url?.searchParams.get("y")).toBe("59.4");

    expect(response.data).toEqual({
      forecastTime: "2026-07-24T14:00:00+02:00",
      significantWaveHeight: 1.29296875,
      maximumWaveHeight: 1.994140625,
      meanWaveDirection: 158,
      peakPeriod: 8.203125,
      latitude: 59.4,
      longitude: 5.25,
    });
    // Fields the provider documents as debugging-only are not surfaced.
    expect(response.data).not.toHaveProperty("source");
    expect(response.data).not.toHaveProperty("fileSource");
  });

  it("treats HTTP 204 as no forecast covering the point, not as a failure", async () => {
    const { sdk } = marineSdk(() => new Response(null, { status: 204 }));
    const response = await sdk.marine.getWaveForecast({ latitude: 71, longitude: 25 });
    expect(response.data).toBeUndefined();
    const current = await marineSdk(
      () => new Response(null, { status: 204 }),
    ).sdk.marine.getSeaCurrent({ latitude: 71, longitude: 25 });
    expect(current.data).toBeUndefined();
  });

  it("treats an explicit null body as no forecast", async () => {
    const { sdk } = marineSdk(() => jsonResponse(null));
    await expect(
      sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 }),
    ).resolves.toMatchObject({ data: undefined });
  });

  it("returns the full forecast series", async () => {
    const { sdk } = marineSdk(() =>
      jsonResponse([wavePointFixture, { ...wavePointFixture, totalPeakPeriod: 9.1 }]),
    );
    const response = await sdk.marine.getWaveForecastSeries({ latitude: 59.4, longitude: 5.25 });
    expect(response.data).toHaveLength(2);
    expect(response.data[1]?.peakPeriod).toBe(9.1);
  });

  it("returns an empty series when no model covers the point", async () => {
    const { sdk } = marineSdk(() => jsonResponse([]));
    const response = await sdk.marine.getWaveForecastSeries({ latitude: 71, longitude: 25 });
    expect(response.data).toEqual([]);
  });

  it("returns an empty series when the provider answers with value-free entries", async () => {
    // What the live service actually does for an uncovered coordinate: HTTP 200
    // with one entry per model time, every wave value null, only the echoed
    // coordinate and timestamp left. Those state nothing, so surfacing them would
    // make an uncovered point look like a covered one with 73 readings.
    const valueFree = {
      totalSignificantWaveHeight: null,
      expectedMaximumWaveHeight: null,
      totalMeanWaveDirection: null,
      totalPeakPeriod: null,
      source: "met",
      fileSource: "wave",
      forecastTime: "2026-07-25T12:00:00+00:00",
      longitude: 9.1,
      latitude: 61.5,
    };
    const { sdk } = marineSdk(() =>
      jsonResponse([valueFree, { ...valueFree, forecastTime: null }]),
    );
    const response = await sdk.marine.getWaveForecastSeries(
      { latitude: 61.5, longitude: 9.1 },
      { includeRaw: true },
    );
    expect(response.data).toEqual([]);
    // The provider's untouched payload stays reachable.
    expect(response.raw).toHaveLength(2);
  });

  it("keeps a partially populated entry in the series", async () => {
    // Only an entry with no measurement at all is dropped; one real value is
    // enough to make the entry a forecast.
    const { sdk } = marineSdk(() =>
      jsonResponse([
        {
          totalSignificantWaveHeight: null,
          expectedMaximumWaveHeight: null,
          totalMeanWaveDirection: null,
          totalPeakPeriod: 8.1,
          forecastTime: "2026-07-25T12:00:00+00:00",
          longitude: 5.05,
          latitude: 59.4,
        },
      ]),
    );
    const response = await sdk.marine.getWaveForecastSeries({ latitude: 59.4, longitude: 5.05 });
    expect(response.data).toHaveLength(1);
    expect(response.data[0]?.peakPeriod).toBe(8.1);
  });

  it("treats HTTP 204 on the series as an empty series, not a validation failure", async () => {
    // The provider documents 204 for this endpoint as well as for the single
    // point, so an uncovered coordinate sends no body at all rather than `[]`.
    const { sdk } = marineSdk(() => new Response(null, { status: 204 }));
    const response = await sdk.marine.getWaveForecastSeries({ latitude: 61.5, longitude: 9.1 });
    expect(response.data).toEqual([]);
  });

  it("normalizes the sea current", async () => {
    const { sdk } = marineSdk(() => jsonResponse(seaCurrentFixture));
    const response = await sdk.marine.getSeaCurrent({ latitude: 59.4, longitude: 5.25 });
    expect(response.data).toEqual({
      forecastTime: "2026-07-24T14:00:00+02:00",
      speed: 0.42,
      direction: 212,
      latitude: 59.4,
      longitude: 5.25,
    });
  });

  it("rejects a sea current missing the speed the provider declares non-nullable", async () => {
    // Unlike every wave field, `current` and `direction` are non-nullable
    // upstream: a current point that exists always carries both. Accepting a null
    // here would publish an optional field the provider never actually omits.
    const { sdk } = marineSdk(() => jsonResponse({ ...seaCurrentFixture, current: null }));
    await expect(
      sdk.marine.getSeaCurrent({ latitude: 59.4, longitude: 5.25 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it.each([
    { latitude: 91, longitude: 5 },
    { latitude: 59, longitude: 181 },
    { latitude: Number.NaN, longitude: 5 },
    { latitude: 59, longitude: Number.POSITIVE_INFINITY },
  ])("rejects the invalid coordinate %o before requesting", async (point) => {
    const { sdk, urls } = marineSdk(() => jsonResponse(wavePointFixture));
    await expect(sdk.marine.getWaveForecast(point)).rejects.toBeInstanceOf(InputValidationError);
    expect(urls.filter((url) => url.hostname === "www.barentswatch.no")).toHaveLength(0);
  });

  it("rejects a forecast missing the grid-cell coordinate", async () => {
    const withoutLatitude = { ...wavePointFixture };
    delete (withoutLatitude as { latitude?: number }).latitude;
    const { sdk } = marineSdk(() => jsonResponse(withoutLatitude));
    await expect(
      sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("keeps the marine client secret out of errors", async () => {
    const { sdk } = marineSdk(() => jsonResponse({ latitude: "wrong" }));
    let caught: unknown;
    try {
      await sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.25 });
    } catch (error) {
      caught = error;
    }
    const serialized = `${String(caught)}|${JSON.stringify(caught)}`;
    expect(serialized).not.toContain(credentials.barentswatch.clientSecret);
    expect(serialized).not.toContain(credentials.barentswatch.clientId);
  });
});
