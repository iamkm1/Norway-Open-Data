import airQualityFixture from "../fixtures/met-airquality.json" with { type: "json" };
import moonFixture from "../fixtures/met-moon.json" with { type: "json" };
import nowcastFixture from "../fixtures/met-nowcast.json" with { type: "json" };
import oceanInlandFixture from "../fixtures/met-oceanforecast-inland.json" with { type: "json" };
import oceanFixture from "../fixtures/met-oceanforecast.json" with { type: "json" };
import sunMidnightSunFixture from "../fixtures/met-sun-midnight-sun.json" with { type: "json" };
import sunPolarNightFixture from "../fixtures/met-sun-polar-night.json" with { type: "json" };
import sunFixture from "../fixtures/met-sun.json" with { type: "json" };
import warningsFixture from "../fixtures/met-warnings.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  ProviderError,
  ResponseValidationError,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

type WeatherHarness = {
  weather: NorwayOpenData["weather"];
  mock: ReturnType<typeof sequenceFetch>["mock"];
  url: (call?: number) => URL;
};

function weather(...responses: Response[]): WeatherHarness {
  const { fetch, mock } = sequenceFetch(...responses);
  const sdk = new NorwayOpenData({
    applicationName: "met-products-tests",
    contactEmail: "weather@example.no",
    fetch,
    retries: 0,
  });
  return {
    weather: sdk.weather,
    mock,
    url: (call = 0) => new URL(String(mock.mock.calls[call]?.[0])),
  };
}

function outsideArea(product: string): Response {
  return new Response(
    `422 Unprocessable Entity\nThe location is outside the geographic area supported by the product.\n  ${product} is only available for the Nordic area\n`,
    { status: 422, headers: { "Content-Type": "text/plain;charset=UTF-8" } },
  );
}

describe("weather.getWarnings", () => {
  it("normalizes MetAlerts warnings without losing their administrative evidence", async () => {
    const { weather: client } = weather(jsonResponse(warningsFixture));
    const response = await client.getWarnings({ language: "en" });
    const [marine, land, named, cancelled, unpadded] = response.data.warnings;

    expect(response.data.language).toBe("en");
    expect(response.data.lastChange).toBe(warningsFixture.lastChange);
    expect(response.data.warnings).toHaveLength(5);
    expect(marine).toMatchObject({
      event: "gale",
      geographicDomain: "marine",
      awarenessLevel: { level: 2, color: "yellow", severity: "Moderate" },
      awarenessType: { code: 1, name: "wind" },
      riskMatrixColor: "yellow",
      messageType: "Alert",
      countyCodes: [],
      municipalityCodes: [],
    });
    expect(marine?.geometry?.type).toBe("Polygon");
    expect(marine?.onset).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(marine?.expires).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(land).toMatchObject({
      event: "forestFire",
      geographicDomain: "land",
      countyCodes: ["50", "15"],
      awarenessType: { code: 8, name: "forest-fire" },
    });
    expect(land?.municipalityCodes.length).toBeGreaterThan(0);
    expect(land?.resources.map((resource) => resource.mimeType)).toContain("application/xml");
    expect(named?.incidentName).toBe("Amy");
    expect(cancelled?.messageType).toBe("Cancel");
    // MetAlerts writes Oslo's county number without its leading zero.
    expect(unpadded?.countyCodes).toContain("03");
    expect(response.source.id).toBe("met");
  });

  it("forwards every filter and defaults to Norwegian text", async () => {
    const { weather: client, url } = weather(
      jsonResponse({ ...warningsFixture, features: [], lang: "no" }),
      jsonResponse({ ...warningsFixture, features: [] }),
    );
    const norwegian = await client.getWarnings({
      latitude: 60.391263,
      longitude: 5.322054,
      countyCode: "03",
      event: "rain",
      geographicDomain: "land",
      riskMatrixColor: "orange",
    });
    expect(norwegian.data).toMatchObject({ language: "no", warnings: [] });
    const first = url(0);
    expect(first.pathname).toBe("/weatherapi/metalerts/2.0/current.json");
    expect(Object.fromEntries(first.searchParams)).toEqual({
      lat: "60.3913",
      lon: "5.3221",
      county: "3",
      event: "rain",
      geographicDomain: "land",
      riskMatrixColor: "orange",
      lang: "no",
    });

    await client.getWarnings({ language: "en" });
    expect(Object.fromEntries(url(1).searchParams)).toEqual({ lang: "en" });
  });

  it.each([
    { parameters: { latitude: 60 }, reason: "latitude without longitude" },
    { parameters: { longitude: 5 }, reason: "longitude without latitude" },
    { parameters: { countyCode: "3" }, reason: "a one-digit county" },
    { parameters: { event: "tornado" }, reason: "an unknown event" },
    { parameters: { geographicDomain: "air" }, reason: "an unknown domain" },
    { parameters: { language: "de" }, reason: "an unsupported language" },
  ])("rejects $reason before any request", async ({ parameters }) => {
    const { weather: client, mock } = weather();
    await expect(client.getWarnings(parameters as never)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it("rejects a warning whose awareness level cannot be read", async () => {
    const [first] = warningsFixture.features;
    const broken = {
      ...warningsFixture,
      features: [{ ...first, properties: { ...first?.properties, awareness_level: "yellow" } }],
    };
    const { weather: client } = weather(jsonResponse(broken));
    await expect(client.getWarnings()).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("requires MET Norway identification before any request", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(warningsFixture));
    const sdk = new NorwayOpenData({ applicationName: "no-contact", fetch, retries: 0 });
    await expect(sdk.weather.getWarnings()).rejects.toBeInstanceOf(ConfigurationError);
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("weather.getNowcast", () => {
  it("normalizes current conditions and five-minute precipitation steps", async () => {
    const { weather: client, url } = weather(jsonResponse(nowcastFixture));
    const response = await client.getNowcast({ latitude: 59.913912, longitude: 10.752245 });

    expect(Object.fromEntries(url().searchParams)).toEqual({ lat: "59.9139", lon: "10.7522" });
    expect(response.data).toMatchObject({
      coordinates: { latitude: 59.9139, longitude: 10.7522, altitude: 5 },
      radarCoverage: "ok",
    });
    const [now, later] = response.data?.entries ?? [];
    expect(now).toMatchObject({
      temperature: 14.3,
      apparentTemperature: 12.4,
      windSpeed: 7.2,
      windGust: 12.7,
      windDirection: 185,
      humidity: 87.9,
      precipitationRate: 0,
      uvIndexClearSky: 0,
      symbolCode: "cloudy",
      precipitationNextHour: 0,
    });
    expect(later).toEqual({
      time: nowcastFixture.properties.timeseries[1]?.time,
      precipitationRate: 0,
    });
  });

  it("resolves to undefined outside the radar area", async () => {
    const { weather: client } = weather(outsideArea("Nowcast"));
    const response = await client.getNowcast({ latitude: 45, longitude: 10 });
    expect(response.data).toBeUndefined();
    expect(response.source.id).toBe("met");
  });

  it("reports any other HTTP 422 as a provider error", async () => {
    const { weather: client } = weather(new Response("invalid request", { status: 422 }));
    await expect(client.getNowcast({ latitude: 59.9, longitude: 10.7 })).rejects.toBeInstanceOf(
      ProviderError,
    );
  });

  it("validates coordinates before any request", async () => {
    const { weather: client, mock } = weather();
    await expect(client.getNowcast({ latitude: 91, longitude: 10 })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("weather.getSunTimes and getMoonTimes", () => {
  it("normalizes an ordinary day and asks for the Europe/Oslo offset of that date", async () => {
    const { weather: client, url } = weather(jsonResponse(sunFixture));
    const response = await client.getSunTimes({
      latitude: 59.9139,
      longitude: 10.7522,
      date: "2026-10-15",
    });

    expect(Object.fromEntries(url().searchParams)).toEqual({
      lat: "59.9139",
      lon: "10.7522",
      date: "2026-10-15",
      offset: "+02:00",
    });
    expect(response.data).toEqual({
      date: "2026-10-15",
      coordinates: { latitude: 59.9139, longitude: 10.7522 },
      sunrise: { time: "2026-10-15T07:55+02:00", azimuth: 105.72 },
      sunset: { time: "2026-10-15T18:08+02:00", azimuth: 253.96 },
      solarNoon: { time: "2026-10-15T13:02+02:00", elevation: 21.47, visible: true },
      solarMidnight: { time: "2026-10-15T01:02+02:00", elevation: -38.51, visible: false },
    });
  });

  it("names midnight sun and polar night instead of leaving the absence unexplained", async () => {
    const { weather: client, url } = weather(
      jsonResponse(sunMidnightSunFixture),
      jsonResponse(sunPolarNightFixture),
    );
    const midsummer = await client.getSunTimes({
      latitude: 69.6492,
      longitude: 18.9553,
      date: "2026-06-21",
    });
    const midwinter = await client.getSunTimes({
      latitude: 69.6492,
      longitude: 18.9553,
      date: "2026-12-21",
    });

    expect(midsummer.data.polarCondition).toBe("midnight-sun");
    expect(midsummer.data.sunrise).toBeUndefined();
    expect(midsummer.data.sunset).toBeUndefined();
    expect(midwinter.data.polarCondition).toBe("polar-night");
    expect(url(1).searchParams.get("offset")).toBe("+01:00");
  });

  it("leaves polarCondition unset when the visibility flags say nothing", async () => {
    const ambiguous = {
      ...sunMidnightSunFixture,
      properties: {
        ...sunMidnightSunFixture.properties,
        solarnoon: { time: "2026-06-21T12:46+02:00" },
        solarmidnight: null,
      },
    };
    const { weather: client } = weather(jsonResponse(ambiguous));
    const response = await client.getSunTimes({
      latitude: 69.6,
      longitude: 18.9,
      date: "2026-06-21",
    });
    expect(response.data.polarCondition).toBeUndefined();
    expect(response.data.solarMidnight).toBeUndefined();
    expect(response.data.solarNoon).toEqual({ time: "2026-06-21T12:46+02:00" });
  });

  it("defaults to today's date in Europe/Oslo", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 23:30 UTC on 14 January is already 15 January in Oslo.
    vi.setSystemTime(new Date("2026-01-14T23:30:00Z"));
    const { weather: client, url } = weather(jsonResponse(sunFixture));
    const response = await client.getSunTimes({ latitude: 59.9, longitude: 10.7 });
    expect(url().searchParams.get("date")).toBe("2026-01-15");
    expect(url().searchParams.get("offset")).toBe("+01:00");
    expect(response.data.date).toBe("2026-01-15");
  });

  it("normalizes moon times and phase", async () => {
    const { weather: client, url } = weather(jsonResponse(moonFixture));
    const response = await client.getMoonTimes({
      latitude: 59.9139,
      longitude: 10.7522,
      date: "2026-10-15",
    });
    expect(url().pathname).toBe("/weatherapi/sunrise/3.0/moon");
    expect(response.data).toEqual({
      date: "2026-10-15",
      coordinates: { latitude: 59.9139, longitude: 10.7522 },
      moonrise: { time: "2026-10-15T15:08+02:00", azimuth: 158.29 },
      moonset: { time: "2026-10-15T18:31+02:00", azimuth: 201.3 },
      highMoon: { time: "2026-10-15T16:50+02:00", elevation: 1.45, visible: true },
      lowMoon: { time: "2026-10-15T04:25+02:00", elevation: -57.8, visible: false },
      phaseDegrees: 49.64,
    });
  });

  it.each(["2026-02-30", "15.10.2026", "2026-10-15T00:00"])(
    "rejects the date %s before any request",
    async (date) => {
      const { weather: client, mock } = weather();
      await expect(
        client.getMoonTimes({ latitude: 59.9, longitude: 10.7, date }),
      ).rejects.toBeInstanceOf(InputValidationError);
      expect(mock).not.toHaveBeenCalled();
    },
  );
});

describe("weather.getOceanForecast", () => {
  it("normalizes sea temperature, waves and current for the nearest model cell", async () => {
    const { weather: client, url } = weather(jsonResponse(oceanFixture));
    const response = await client.getOceanForecast({ latitude: 60.1, longitude: 4.8 });

    expect(url().pathname).toBe("/weatherapi/oceanforecast/2.0/complete");
    expect(response.data?.coordinates).toEqual({ latitude: 60.0864, longitude: 4.7866 });
    expect(response.data?.entries).toHaveLength(3);
    expect(response.data?.entries[0]).toEqual({
      time: oceanFixture.properties.timeseries[0]?.time,
      seaTemperature: 13.5,
      waveHeight: 3.6,
      waveFromDirection: 255.5,
      currentSpeed: 0.7,
      currentToDirection: 2.4,
    });
  });

  it("resolves to undefined inland, where the service answers with an empty series", async () => {
    const { weather: client } = weather(jsonResponse(oceanInlandFixture));
    const response = await client.getOceanForecast(
      { latitude: 61.5, longitude: 9 },
      { includeRaw: true },
    );
    expect(response.data).toBeUndefined();
    expect(response.raw).toMatchObject({
      properties: { meta: { error: "no data at the given location" } },
    });
  });

  it("resolves to undefined outside every model area", async () => {
    const { weather: client } = weather(outsideArea("Oceanforecast"));
    await expect(client.getOceanForecast({ latitude: 45, longitude: -30 })).resolves.toMatchObject({
      data: undefined,
    });
  });
});

describe("weather.getAirQualityForecast", () => {
  it("normalizes the overall index and the four pollutants", async () => {
    const { weather: client, url } = weather(jsonResponse(airQualityFixture));
    const response = await client.getAirQualityForecast({ latitude: 59.9139, longitude: 10.7522 });

    expect(url().pathname).toBe("/weatherapi/airqualityforecast/0.1/");
    expect(response.data?.referenceTime).toBe(airQualityFixture.meta.reftime);
    expect(response.data?.area).toMatchObject({
      areaClass: "grunnkrets",
      areaCode: airQualityFixture.meta.location.areacode,
      latitude: 59.9139,
      longitude: 10.7522,
    });
    expect(response.data?.parentArea?.areaClass).toBe("delomrade");
    const [first] = response.data?.entries ?? [];
    expect(first?.index).toBeCloseTo(1.6767, 3);
    expect(first?.no2?.concentration).toBeCloseTo(7.687, 2);
    expect(first?.pm10?.index).toBeCloseTo(1.357, 2);
    expect(first?.pm25?.concentration).toBeCloseTo(7.665, 2);
    expect(first?.o3).toMatchObject({
      concentration: expect.any(Number),
      index: expect.any(Number),
    });
  });

  it("omits a pollutant the forecast does not publish", async () => {
    const [entry] = airQualityFixture.data.time;
    const variables = Object.fromEntries(
      Object.entries(entry?.variables ?? {}).filter(([name]) => !name.includes("o3")),
    );
    const trimmed = {
      ...airQualityFixture,
      meta: { ...airQualityFixture.meta, superlocation: undefined },
      data: { time: [{ ...entry, variables }] },
    };
    const { weather: client } = weather(jsonResponse(trimmed));
    const response = await client.getAirQualityForecast({ latitude: 59.9, longitude: 10.7 });
    expect(response.data?.entries[0]).not.toHaveProperty("o3");
    expect(response.data).not.toHaveProperty("parentArea");
  });

  it("resolves to undefined for a location the model does not cover", async () => {
    const { weather: client } = weather(
      jsonResponse({ detail: "unknown location: (12.57,55.68)" }, 400),
    );
    await expect(
      client.getAirQualityForecast({ latitude: 55.68, longitude: 12.57 }),
    ).resolves.toMatchObject({ data: undefined });
  });

  it("reports an unrelated HTTP 400 as a provider error", async () => {
    const { weather: client } = weather(jsonResponse({ detail: "invalid areaclass" }, 400));
    await expect(
      client.getAirQualityForecast({ latitude: 59.9, longitude: 10.7 }),
    ).rejects.toMatchObject({ name: "ProviderError", statusCode: 400 });
  });

  it("refuses concentrations in an unexpected unit rather than mislabelling them", async () => {
    const [entry] = airQualityFixture.data.time;
    const relabelled = {
      ...airQualityFixture,
      data: {
        time: [
          {
            ...entry,
            variables: { ...entry?.variables, no2_concentration: { value: 0.004, units: "ppm" } },
          },
        ],
      },
    };
    const { weather: client } = weather(jsonResponse(relabelled));
    await expect(
      client.getAirQualityForecast({ latitude: 59.9, longitude: 10.7 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
