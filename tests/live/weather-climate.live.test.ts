/**
 * Opt-in, low-volume probes for the v0.9 weather, tide and climate surface.
 *
 * Enabled only with `RUN_LIVE_TESTS=true`.
 *
 * - MET Norway probes need `NORWAY_OPEN_DATA_APPLICATION_NAME` and
 *   `NORWAY_OPEN_DATA_CONTACT_EMAIL` and skip without them.
 * - Frost probes need `MET_FROST_CLIENT_ID`, a free client ID from
 *   https://frost.met.no/auth/requestCredentials.html, and skip without it.
 * - Kartverket's municipality and tide probes are anonymous and always run.
 */
import { describe, expect, it } from "vitest";

import { NorwayOpenData } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe : describe.skip;

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

const applicationName = optionalEnvironmentValue("NORWAY_OPEN_DATA_APPLICATION_NAME");
const contactEmail = optionalEnvironmentValue("NORWAY_OPEN_DATA_CONTACT_EMAIL");
const frostClientId = optionalEnvironmentValue("MET_FROST_CLIENT_ID");

const noMetIdentity = applicationName === undefined || contactEmail === undefined;
const noFrostClient = frostClientId === undefined;

const sdk = new NorwayOpenData({
  applicationName,
  contactEmail,
  retries: 1,
  timeoutMs: 30_000,
  cache: { enabled: true },
  ...(frostClientId === undefined
    ? {}
    : { credentials: { "met-frost": { clientId: frostClientId } } }),
});

const OSLO = { latitude: 59.9139, longitude: 10.7522 } as const;
const BERGEN_HARBOUR = { latitude: 60.398, longitude: 5.32 } as const;
const OFF_BERGEN = { latitude: 60.1, longitude: 4.8 } as const;
const INLAND = { latitude: 61.5, longitude: 9 } as const;
const TROMSO = { latitude: 69.6492, longitude: 18.9553 } as const;

function hoursFromNow(hours: number): string {
  return new Date(Math.floor(Date.now() / 60_000) * 60_000 + hours * 3_600_000).toISOString();
}

live("MET Norway — warnings, nowcast, sun, ocean and air quality", () => {
  it.skipIf(noMetIdentity)("reads every current warning and validates its fields", async () => {
    const response = await sdk.weather.getWarnings({ language: "en" });
    expect(response.data.language).toBe("en");
    for (const warning of response.data.warnings) {
      expect([1, 2, 3, 4]).toContain(warning.awarenessLevel.level);
      expect(["green", "yellow", "orange", "red"]).toContain(warning.awarenessLevel.color);
      expect(warning.title.length).toBeGreaterThan(0);
    }
  });

  it.skipIf(noMetIdentity)("narrows warnings to a point", async () => {
    const response = await sdk.weather.getWarnings({ ...BERGEN_HARBOUR });
    expect(Array.isArray(response.data.warnings)).toBe(true);
  });

  it.skipIf(noMetIdentity)(
    "returns a nowcast inside the radar area and nothing outside",
    async () => {
      const inside = await sdk.weather.getNowcast(OSLO);
      expect(inside.data?.entries.length).toBeGreaterThan(0);
      const outside = await sdk.weather.getNowcast({ latitude: 45, longitude: 10 });
      expect(outside.data).toBeUndefined();
    },
  );

  it.skipIf(noMetIdentity)("names polar night and midnight sun", async () => {
    const winter = await sdk.weather.getSunTimes({ ...TROMSO, date: "2026-12-21" });
    expect(winter.data.polarCondition).toBe("polar-night");
    const summer = await sdk.weather.getSunTimes({ ...TROMSO, date: "2027-06-21" });
    expect(summer.data.polarCondition).toBe("midnight-sun");
    const ordinary = await sdk.weather.getSunTimes(OSLO);
    expect(ordinary.data.sunrise).toBeDefined();
  });

  it.skipIf(noMetIdentity)("reads moon times and phase", async () => {
    const response = await sdk.weather.getMoonTimes(OSLO);
    expect(response.data.phaseDegrees).toBeGreaterThanOrEqual(0);
  });

  it.skipIf(noMetIdentity)(
    "distinguishes sea, land and out-of-area for the ocean model",
    async () => {
      const coast = await sdk.weather.getOceanForecast(OFF_BERGEN);
      expect(coast.data?.entries.length).toBeGreaterThan(0);
      expect((await sdk.weather.getOceanForecast(INLAND)).data).toBeUndefined();
      expect(
        (await sdk.weather.getOceanForecast({ latitude: 45, longitude: -30 })).data,
      ).toBeUndefined();
    },
  );

  it.skipIf(noMetIdentity)("forecasts air quality in Norway and nothing abroad", async () => {
    const oslo = await sdk.weather.getAirQualityForecast(OSLO);
    expect(oslo.data?.entries.length).toBeGreaterThan(0);
    const copenhagen = await sdk.weather.getAirQualityForecast({
      latitude: 55.68,
      longitude: 12.57,
    });
    expect(copenhagen.data).toBeUndefined();
  });
});

live("Kartverket — municipality lookup", () => {
  it("resolves a point to its municipality and the open sea to nothing", async () => {
    const oslo = await sdk.places.getMunicipalityAt(OSLO);
    expect(oslo.data).toMatchObject({ municipalityCode: "0301", countyCode: "03" });
    const sea = await sdk.places.getMunicipalityAt({ latitude: 60.1, longitude: 4 });
    expect(sea.data).toBeUndefined();
  });
});

live("Kartverket — tides and water levels", () => {
  it("lists the permanent gauges", async () => {
    const response = await sdk.tides.listStations();
    expect(response.data.map((station) => station.code)).toContain("BGO");
  });

  it("returns every water-level series at a gauge and nothing inland", async () => {
    const window = { from: hoursFromNow(-6), to: hoursFromNow(24) };
    const bergen = await sdk.tides.getWaterLevels({ ...BERGEN_HARBOUR, ...window });
    expect(bergen.data?.location.code).toBe("BGO");
    expect(bergen.data?.series.map((series) => series.type)).toEqual(
      expect.arrayContaining(["observation", "prediction"]),
    );
    const inland = await sdk.tides.getWaterLevels({ ...INLAND, ...window });
    expect(inland.data).toBeUndefined();
  });

  it("returns predicted high and low waters", async () => {
    const response = await sdk.tides.getTideTable({
      ...BERGEN_HARBOUR,
      from: hoursFromNow(0),
      to: hoursFromNow(48),
    });
    const kinds = new Set(response.data?.events.map((event) => event.kind));
    expect(kinds).toEqual(new Set(["high", "low"]));
  });

  it("returns reference levels", async () => {
    const response = await sdk.tides.getReferenceLevels(BERGEN_HARBOUR);
    expect(response.data?.levels.map((level) => level.code)).toEqual(
      expect.arrayContaining(["CD", "MSL", "HAT"]),
    );
  });
});

live("MET Norway Frost — observations and climate", () => {
  it.skipIf(noFrostClient)("finds the nearest station without station-holder names", async () => {
    const response = await sdk.climate.searchStations(
      { near: { ...OSLO, maxCount: 3 }, activeOnly: true },
      { includeRaw: true },
    );
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0]?.id).toMatch(/^SN\d+$/);
    expect(JSON.stringify(response)).not.toContain("stationHolders");
  });

  it.skipIf(noFrostClient)(
    "lists time series and reads recent and latest observations",
    async () => {
      const series = await sdk.climate.getAvailableTimeSeries({
        stationIds: ["SN18700"],
        elements: ["air_temperature"],
      });
      expect(series.data.length).toBeGreaterThan(0);
      const recent = await sdk.climate.getObservations({
        stationIds: ["SN18700"],
        elements: ["air_temperature"],
        from: hoursFromNow(-48),
        to: hoursFromNow(0),
      });
      expect(recent.data.length).toBeGreaterThan(0);
      const latest = await sdk.climate.getLatestObservations({
        stationIds: ["SN18700"],
        elements: ["air_temperature"],
      });
      expect(latest.data[0]?.observations[0]?.elementId).toBe("air_temperature");
    },
  );

  it.skipIf(noFrostClient)("reads monthly climate normals", async () => {
    const response = await sdk.climate.getClimateNormals({
      stationIds: ["SN18700"],
      elements: ["mean(air_temperature P1M)"],
      period: "1991/2020",
    });
    expect(response.data.length).toBeGreaterThan(0);
  });
});

live("Cross-provider conditions profile", () => {
  it("composes a coastal point and explains every section", async () => {
    const response = await sdk.profiles.conditionsAtLocation({ ...BERGEN_HARBOUR, hours: 6 });
    expect(response.data.components).toHaveLength(14);
    expect(response.data.municipality?.municipalityCode).toBe("4601");
    expect(response.data.tides?.events.length).toBeGreaterThan(0);
    const failures = response.data.components.filter(
      (component) => component.status === "omitted" && component.reason === "provider-error",
    );
    expect(failures).toEqual([]);
  });
});
