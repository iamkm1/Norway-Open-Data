import forecastFixture from "../fixtures/met-forecast.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import {
  InputValidationError,
  NorwayOpenData,
  ResponseValidationError,
  version,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("MetClient", () => {
  it("identifies the caller, rounds coordinates, and normalizes forecasts", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(forecastFixture));
    const response = await new NorwayOpenData({
      applicationName: "example-weather",
      contactEmail: "weather@example.no",
      fetch,
      retries: 0,
    }).weather.forecast({
      latitude: 59.4138123,
      longitude: 5.2679876,
      altitude: 15,
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("lat")).toBe("59.4138");
    expect(url.searchParams.get("lon")).toBe("5.268");
    const headers = new Headers((mock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get("User-Agent")).toBe(
      `NorwayOpenDataSDK/${version} example-weather weather@example.no`,
    );
    expect(response.data).toMatchObject({
      updatedAt: "2026-07-20T08:00:00Z",
      coordinates: { latitude: 59.4138, longitude: 5.268, altitude: 15 },
      timeseries: [
        {
          temperature: 17.2,
          windSpeed: 4.1,
          humidity: 73,
          precipitationNextHour: 0.2,
          precipitationNextSixHours: 1.1,
          symbolCode: "partlycloudy_day",
        },
      ],
    });
  });

  it("returns the first forecast entry from current()", async () => {
    const { fetch } = sequenceFetch(jsonResponse(forecastFixture));
    const response = await new NorwayOpenData({
      applicationName: "example-current",
      contactEmail: "weather@example.no",
      fetch,
      retries: 0,
    }).weather.current({ latitude: 59.4, longitude: 5.2 });
    expect(response.data?.temperature).toBe(17.2);
  });

  it("validates coordinates before making a request", async () => {
    const sdk = new NorwayOpenData({
      applicationName: "example-validation",
      contactEmail: "weather@example.no",
      fetch: async () => jsonResponse({}),
    });
    await expect(sdk.weather.forecast({ latitude: -91, longitude: 0 })).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it.each([
    { ...forecastFixture, geometry: { coordinates: [999, -999] } },
    {
      ...forecastFixture,
      properties: { ...forecastFixture.properties, timeseries: [] },
    },
  ])("rejects malformed or empty forecast responses", async (payload) => {
    const { fetch } = sequenceFetch(jsonResponse(payload));
    await expect(
      new NorwayOpenData({
        applicationName: "example-validation",
        contactEmail: "weather@example.no",
        fetch,
        retries: 0,
      }).weather.forecast({ latitude: 60, longitude: 10 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
