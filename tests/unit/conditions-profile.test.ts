import airQualityFixture from "../fixtures/met-airquality.json" with { type: "json" };
import nowcastFixture from "../fixtures/met-nowcast.json" with { type: "json" };
import oceanFixture from "../fixtures/met-oceanforecast.json" with { type: "json" };
import sunFixture from "../fixtures/met-sun.json" with { type: "json" };
import warningsFixture from "../fixtures/met-warnings.json" with { type: "json" };
import nveWarningFixture from "../fixtures/nve-warning.json" with { type: "json" };
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { bergenTideTableXml, inlandNoDataXml } from "../fixtures/kartverket-tides.js";
import {
  frostErrorFixture,
  frostNearestSourcesFixture,
  frostNormalsFixture,
  frostObservationsFixture,
} from "../fixtures/met-frost.js";
import {
  InputValidationError,
  NorwayOpenData,
  type NorwayOpenDataConfig,
  type ProfileComponent,
  ProviderError,
} from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

const NOW = "2026-10-15T12:30:00Z";
const location = { latitude: 59.9139, longitude: 10.7522 };
const osloMunicipality = {
  fylkesnavn: "Oslo",
  fylkesnummer: "03",
  kommunenavn: "Oslo",
  kommunenummer: "0301",
};
const osloFloodWarning = [
  {
    ...nveWarningFixture[0],
    RegionName: "Oslo",
    CountyList: [{ Id: "03", Name: "Oslo" }],
    MunicipalityList: [{ Id: "0301", Name: "Oslo" }],
  },
];

/** Hourly forecast entries starting an hour before the frozen clock. */
function forecastAroundNow(count = 30): unknown {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [10.7522, 59.9139, 5] },
    properties: {
      meta: { updated_at: "2026-10-15T12:00:00Z" },
      timeseries: Array.from({ length: count }, (_value, index) => ({
        time: new Date(Date.parse("2026-10-15T11:00:00Z") + index * 3_600_000)
          .toISOString()
          .replace(".000", ""),
        data: { instant: { details: { air_temperature: 10 + index / 10, wind_speed: 3 } } },
      })),
    },
  };
}

type Route = (url: URL) => Response | undefined;

const defaultRoutes: Record<string, Route> = {
  municipality: (url) =>
    url.hostname === "api.kartverket.no" ? jsonResponse(osloMunicipality) : undefined,
  forecast: (url) =>
    url.pathname.includes("/locationforecast/") ? jsonResponse(forecastAroundNow()) : undefined,
  nowcast: (url) => (url.pathname.includes("/nowcast/") ? jsonResponse(nowcastFixture) : undefined),
  warnings: (url) =>
    url.pathname.includes("/metalerts/")
      ? jsonResponse({ ...warningsFixture, features: [warningsFixture.features[1]] })
      : undefined,
  sun: (url) => (url.pathname.includes("/sunrise/") ? jsonResponse(sunFixture) : undefined),
  ocean: (url) =>
    url.pathname.includes("/oceanforecast/") ? jsonResponse(oceanFixture) : undefined,
  airQuality: (url) =>
    url.pathname.includes("/airqualityforecast/") ? jsonResponse(airQualityFixture) : undefined,
  tides: (url) =>
    url.hostname === "vannstand.kartverket.no"
      ? new Response(bergenTideTableXml, { headers: { "Content-Type": "text/xml" } })
      : undefined,
  flood: (url) => (url.pathname.includes("/flood/") ? jsonResponse(osloFloodWarning) : undefined),
  avalanche: (url) => (url.pathname.includes("/avalanche/") ? jsonResponse([]) : undefined),
  landslide: (url) => (url.pathname.includes("/landslide/") ? jsonResponse([]) : undefined),
  stations: (url) =>
    url.pathname === "/sources/v0.jsonld"
      ? jsonResponse({ ...frostNearestSourcesFixture, data: [frostNearestSourcesFixture.data[0]] })
      : undefined,
  latest: (url) =>
    url.pathname === "/observations/v0.jsonld" ? jsonResponse(frostObservationsFixture) : undefined,
  normals: (url) =>
    url.pathname === "/climatenormals/v0.jsonld" ? jsonResponse(frostNormalsFixture) : undefined,
};

const fullConfig: NorwayOpenDataConfig = {
  applicationName: "conditions-tests",
  contactEmail: "conditions@example.no",
  credentials: { "met-frost": { clientId: "0b6b6a5e-1f2a-4c3d-9e8f-123456789abc" } },
};

function conditionsSdk(
  overrides: Partial<Record<keyof typeof defaultRoutes, Route>> = {},
  config = fullConfig,
): { sdk: NorwayOpenData; requests: URL[] } {
  const routes = { ...defaultRoutes, ...overrides };
  const requests: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    requests.push(url);
    for (const route of Object.values(routes)) {
      const response = route?.(url);
      if (response !== undefined) return response;
    }
    throw new Error(`Unexpected request: ${url.href}`);
  }) as typeof globalThis.fetch;
  const sdk = new NorwayOpenData({ ...config, fetch, retries: 0, rateLimit: { enabled: false } });
  return { sdk, requests };
}

function byOperation(components: readonly ProfileComponent[]): Map<string, ProfileComponent> {
  return new Map(components.map((component) => [component.operation, component]));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("profiles.conditionsAtLocation", () => {
  it("composes every agency's answer for one point", async () => {
    const { sdk, requests } = conditionsSdk();
    const response = await sdk.profiles.conditionsAtLocation({ ...location, hours: 3 });
    const profile = response.data;

    expect(profile.location).toEqual(location);
    expect(profile.municipality).toEqual({
      municipalityCode: "0301",
      municipalityName: "Oslo",
      countyCode: "03",
      countyName: "Oslo",
    });
    // The forecast starts at the current hour and covers the requested hours.
    expect(profile.forecast?.map((entry) => entry.time)).toEqual([
      "2026-10-15T12:00:00Z",
      "2026-10-15T13:00:00Z",
      "2026-10-15T14:00:00Z",
    ]);
    expect(profile.nowcast?.radarCoverage).toBe("ok");
    expect(profile.weatherWarnings?.map((warning) => warning.event)).toEqual(["forestFire"]);
    expect(profile.hazards).toHaveLength(1);
    expect(profile.hazardMatches?.[0]).toMatchObject({
      matchBasis: "municipality-code",
      addressArea: { code: "0301", name: "Oslo" },
      warningArea: { code: "0301", name: "Oslo" },
    });
    expect(profile.sun?.sunrise?.time).toBe("2026-10-15T07:55+02:00");
    expect(profile.ocean?.entries).toHaveLength(3);
    expect(profile.tides?.events.length).toBeGreaterThan(0);
    // The 12:00 air-quality hour has passed at 12:30; only the 13:00 hour remains.
    expect(profile.airQuality?.entries.map((entry) => entry.to)).toEqual(["2026-10-15T13:00:00Z"]);
    expect(profile.observations?.station.id).toBe("SN18700");
    expect(profile.observations?.latest).toHaveLength(2);
    expect(profile.observations?.monthlyTemperatureNormal).toMatchObject({
      month: 10,
      normal: 7.4,
    });
    expect(profile.warnings).toEqual([]);

    expect(profile.components.every((component) => component.status === "available")).toBe(true);
    expect(profile.components).toHaveLength(14);
    expect(response.source.id).toBe("met+nve+kartverket+kartverket-tides+met-frost");
    expect(response.sources?.map((source) => source.id)).toEqual(
      expect.arrayContaining(["met", "nve", "kartverket", "kartverket-tides", "met-frost"]),
    );
    // The tide window covers at least 24 hours from now, in UTC minutes.
    const tideRequest = requests.find((url) => url.hostname === "vannstand.kartverket.no");
    expect(tideRequest?.searchParams.get("fromtime")).toBe("2026-10-15T12:30");
    expect(tideRequest?.searchParams.get("totime")).toBe("2026-10-16T12:30");
    // The station search asks for the single nearest active station.
    const stationRequest = requests.find((url) => url.pathname === "/sources/v0.jsonld");
    expect(stationRequest?.searchParams.get("nearestmaxcount")).toBe("1");
    expect(stationRequest?.searchParams.get("validtime")).toBe("now");
  });

  it("keeps the anonymous sections when MET Norway and Frost are not configured", async () => {
    const { sdk, requests } = conditionsSdk({}, {});
    const response = await sdk.profiles.conditionsAtLocation(location);
    const components = byOperation(response.data.components);

    for (const operation of [
      "weather.forecast",
      "weather.getNowcast",
      "weather.getWarnings",
      "weather.getSunTimes",
      "weather.getOceanForecast",
      "weather.getAirQualityForecast",
      "climate.searchStations",
      "climate.getLatestObservations",
      "climate.getClimateNormals",
    ]) {
      expect(components.get(operation), operation).toMatchObject({
        status: "omitted",
        reason: "not-configured",
      });
    }
    expect(response.data.municipality?.municipalityCode).toBe("0301");
    expect(response.data.tides).toBeDefined();
    expect(response.data.hazards).toHaveLength(1);
    expect(response.data).not.toHaveProperty("forecast");
    expect(response.data).not.toHaveProperty("observations");
    expect(requests.some((url) => url.hostname === "api.met.no")).toBe(false);
    expect(requests.some((url) => url.hostname === "frost.met.no")).toBe(false);
    expect(response.source.id).toBe("nve+kartverket+kartverket-tides");
  });

  it("explains every section that a point at sea falls outside of", async () => {
    const outside = (): Response =>
      new Response("The location is outside the geographic area supported by the product.", {
        status: 422,
      });
    const { sdk, requests } = conditionsSdk({
      municipality: (url) =>
        url.hostname === "api.kartverket.no"
          ? new Response("<p>Ingen treff, sjekk parameterene.</p>", { status: 404 })
          : undefined,
      nowcast: (url) => (url.pathname.includes("/nowcast/") ? outside() : undefined),
      ocean: (url) => (url.pathname.includes("/oceanforecast/") ? outside() : undefined),
      airQuality: (url) =>
        url.pathname.includes("/airqualityforecast/")
          ? jsonResponse({ detail: "unknown location: (4.0,60.1)" }, 400)
          : undefined,
      tides: (url) =>
        url.hostname === "vannstand.kartverket.no" ? new Response(inlandNoDataXml) : undefined,
    });
    const response = await sdk.profiles.conditionsAtLocation({ latitude: 60.1, longitude: 4 });
    const components = byOperation(response.data.components);

    expect(components.get("places.getMunicipalityAt")).toMatchObject({ reason: "not-covered" });
    for (const operation of [
      "hazards.getFloodWarnings",
      "hazards.getAvalancheWarnings",
      "hazards.getLandslideWarnings",
    ]) {
      expect(components.get(operation), operation).toMatchObject({ reason: "not-applicable" });
    }
    expect(components.get("weather.getNowcast")).toMatchObject({ reason: "not-covered" });
    expect(components.get("weather.getOceanForecast")).toMatchObject({ reason: "not-covered" });
    expect(components.get("weather.getAirQualityForecast")).toMatchObject({
      reason: "not-covered",
    });
    expect(components.get("tides.getTideTable")).toMatchObject({ reason: "not-covered" });
    expect(requests.some((url) => url.hostname === "api01.nve.no")).toBe(false);
    expect(response.data).not.toHaveProperty("hazards");
    expect(response.data).not.toHaveProperty("municipality");
    expect(response.data.forecast).toBeDefined();
  });

  it("degrades a failing provider to its own section and says so", async () => {
    const { sdk } = conditionsSdk({
      warnings: (url) => (url.pathname.includes("/metalerts/") ? jsonResponse({}, 500) : undefined),
      avalanche: (url) =>
        url.pathname.includes("/avalanche/") ? jsonResponse({}, 503) : undefined,
    });
    const response = await sdk.profiles.conditionsAtLocation(location);
    const components = byOperation(response.data.components);

    expect(components.get("weather.getWarnings")).toMatchObject({
      status: "omitted",
      reason: "provider-error",
      error: { name: "ProviderError" },
    });
    expect(components.get("hazards.getAvalancheWarnings")).toMatchObject({
      reason: "provider-error",
    });
    expect(response.data).not.toHaveProperty("weatherWarnings");
    // The flood feed still answered, so its match survives.
    expect(response.data.hazards).toHaveLength(1);
    expect(response.data.warnings).toEqual([
      "Weather-warning lookup failed: met returned HTTP 500.",
      "Avalanche-warning lookup failed: nve returned HTTP 503.",
    ]);
  });

  it("separates no nearby station from a station without data or normals", async () => {
    const noStation = conditionsSdk({
      stations: (url) =>
        url.pathname === "/sources/v0.jsonld"
          ? jsonResponse(frostErrorFixture(404, "Not found"), 404)
          : undefined,
    });
    const nothing = await noStation.sdk.profiles.conditionsAtLocation(location);
    const noneFound = byOperation(nothing.data.components);
    expect(noneFound.get("climate.searchStations")).toMatchObject({ reason: "not-found" });
    expect(noneFound.get("climate.getLatestObservations")).toMatchObject({
      reason: "not-applicable",
    });
    expect(noneFound.get("climate.getClimateNormals")).toMatchObject({ reason: "not-applicable" });
    expect(nothing.data).not.toHaveProperty("observations");

    const sparse = conditionsSdk({
      latest: (url) =>
        url.pathname === "/observations/v0.jsonld"
          ? jsonResponse(frostErrorFixture(412, "No available time series"), 412)
          : undefined,
      normals: (url) =>
        url.pathname === "/climatenormals/v0.jsonld"
          ? jsonResponse({ ...frostNormalsFixture, data: [frostNormalsFixture.data[1]] })
          : undefined,
    });
    const quiet = await sparse.sdk.profiles.conditionsAtLocation(location);
    const quietComponents = byOperation(quiet.data.components);
    expect(quietComponents.get("climate.searchStations")?.status).toBe("available");
    expect(quietComponents.get("climate.getLatestObservations")).toMatchObject({
      reason: "not-found",
    });
    expect(quietComponents.get("climate.getClimateNormals")).toMatchObject({ reason: "not-found" });
    expect(quiet.data.observations).toEqual({
      station: expect.objectContaining({ id: "SN18700" }),
      latest: [],
    });
  });

  it("warns when the nearest station is far away or the radar is degraded", async () => {
    const [blindern] = frostNearestSourcesFixture.data;
    const { sdk } = conditionsSdk({
      stations: (url) =>
        url.pathname === "/sources/v0.jsonld"
          ? jsonResponse({ ...frostNearestSourcesFixture, data: [{ ...blindern, distance: 41.2 }] })
          : undefined,
      nowcast: (url) =>
        url.pathname.includes("/nowcast/")
          ? jsonResponse({
              ...nowcastFixture,
              properties: {
                ...nowcastFixture.properties,
                meta: {
                  ...nowcastFixture.properties.meta,
                  radar_coverage: "temporarily unavailable",
                },
              },
            })
          : undefined,
    });
    const response = await sdk.profiles.conditionsAtLocation(location);
    expect(response.data.warnings).toEqual([
      'MET Norway reports radar coverage "temporarily unavailable" for the nowcast.',
      "The nearest active weather station, OSLO - BLINDERN, is 41.2 km away; its observations may not represent this location.",
    ]);
  });

  it("marks the profile cached only when every contributing response was cached", async () => {
    const { sdk } = conditionsSdk({}, { ...fullConfig, cache: { enabled: true } });
    const first = await sdk.profiles.conditionsAtLocation(location);
    const second = await sdk.profiles.conditionsAtLocation(location, { includeRaw: true });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.raw).toMatchObject({
      municipality: osloMunicipality,
      tides: bergenTideTableXml,
      climateNormals: expect.objectContaining({ "@type": "ClimateNormalsResponse" }),
    });
  });

  it.each([0, 49, 1.5, Number.NaN])("rejects hours=%s before any request", async (hours) => {
    const { sdk, requests } = conditionsSdk();
    await expect(sdk.profiles.conditionsAtLocation({ ...location, hours })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(requests).toHaveLength(0);
  });

  it("rejects an invalid coordinate before any request", async () => {
    const { sdk, requests } = conditionsSdk();
    await expect(
      sdk.profiles.conditionsAtLocation({ latitude: 91, longitude: 10 }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(requests).toHaveLength(0);
  });

  it("rejects the whole call when the caller cancels", async () => {
    const { sdk } = conditionsSdk();
    const controller = new AbortController();
    controller.abort();
    await expect(
      sdk.profiles.conditionsAtLocation(location, { signal: controller.signal }),
    ).rejects.toMatchObject({ message: expect.stringMatching(/cancelled/) });
  });

  it("fails when every provider it needed failed", async () => {
    const failing: Route = () => jsonResponse({}, 500);
    const { sdk } = conditionsSdk(
      Object.fromEntries(Object.keys(defaultRoutes).map((name) => [name, failing])),
    );
    const rejection = sdk.profiles.conditionsAtLocation(location);
    await expect(rejection).rejects.toBeInstanceOf(ProviderError);
    await expect(rejection).rejects.toMatchObject({
      provider: "profiles",
      message: "Every provider needed for this profile failed.",
    });
  });
});
