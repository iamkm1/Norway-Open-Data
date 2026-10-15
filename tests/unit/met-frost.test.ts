import { describe, expect, it } from "vitest";

import {
  frostErrorFixture,
  frostNearestSourcesFixture,
  frostNormalsFixture,
  frostObservationsFixture,
  frostTimeSeriesFixture,
} from "../fixtures/met-frost.js";
import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  ProviderError,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

const CLIENT_ID = "0b6b6a5e-1f2a-4c3d-9e8f-123456789abc";

type ClimateHarness = {
  climate: NorwayOpenData["climate"];
  mock: ReturnType<typeof sequenceFetch>["mock"];
  url: (call?: number) => URL;
  query: (call?: number) => Record<string, string>;
  headers: (call?: number) => Headers;
};

function climate(...responses: Response[]): ClimateHarness {
  const { fetch, mock } = sequenceFetch(...responses);
  const sdk = new NorwayOpenData({
    fetch,
    retries: 0,
    credentials: { "met-frost": { clientId: CLIENT_ID } },
  });
  return {
    climate: sdk.climate,
    mock,
    url: (call = 0) => new URL(String(mock.mock.calls[call]?.[0])),
    query: (call = 0) =>
      Object.fromEntries(new URL(String(mock.mock.calls[call]?.[0])).searchParams),
    headers: (call = 0) => new Headers((mock.mock.calls[call]?.[1] as RequestInit).headers),
  };
}

const observationWindow = {
  stationIds: ["SN18700"],
  elements: ["air_temperature", "wind_speed"],
  from: "2026-10-14T14:00:00+02:00",
  to: "2026-10-15T00:00:00.750Z",
};

describe("climate credentials", () => {
  it("sends the client ID as the HTTP Basic username with an empty password", async () => {
    const client = climate(jsonResponse(frostNearestSourcesFixture));
    await client.climate.searchStations({ near: { latitude: 59.9139, longitude: 10.7522 } });

    expect(client.url().origin).toBe("https://frost.met.no");
    expect(client.headers().get("Authorization")).toBe(`Basic ${btoa(`${CLIENT_ID}:`)}`);
  });

  it("explains how to get a client ID before sending anything", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(frostNearestSourcesFixture));
    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    await expect(sdk.climate.searchStations({ name: "OSLO*" })).rejects.toThrow(
      new ConfigurationError(
        'Frost requests require credentials["met-frost"].clientId, a free client ID from https://frost.met.no/auth/requestCredentials.html.',
      ).message,
    );
    expect(mock).not.toHaveBeenCalled();
  });

  it.each(["client:id", "klient-ø"])(
    "refuses a client ID HTTP Basic cannot carry: %s",
    async (clientId) => {
      const { fetch, mock } = sequenceFetch(jsonResponse(frostNearestSourcesFixture));
      const sdk = new NorwayOpenData({
        fetch,
        retries: 0,
        credentials: { "met-frost": { clientId } },
      });
      await expect(sdk.climate.searchStations({ name: "OSLO*" })).rejects.toBeInstanceOf(
        ConfigurationError,
      );
      expect(mock).not.toHaveBeenCalled();
    },
  );

  it("reports a rejected client ID without repeating it", async () => {
    const client = climate(
      jsonResponse(frostErrorFixture(401, "Unauthorized", "Invalid client"), 401),
    );
    let caught: unknown;
    try {
      await client.climate.searchStations({ name: "OSLO*" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ProviderError);
    expect(caught).toMatchObject({ provider: "met-frost", statusCode: 401 });
    expect(`${String(caught)}|${JSON.stringify(caught)}`).not.toContain(CLIENT_ID);
  });
});

describe("climate.searchStations", () => {
  it("finds the nearest stations and withholds station-holder names everywhere", async () => {
    const client = climate(jsonResponse(frostNearestSourcesFixture));
    const response = await client.climate.searchStations(
      { near: { latitude: 59.913912, longitude: 10.752245, maxCount: 2 } },
      { includeRaw: true },
    );

    expect(client.url().pathname).toBe("/sources/v0.jsonld");
    expect(client.query()).toEqual({
      types: "SensorSystem",
      geometry: "nearest(POINT(10.7522 59.9139))",
      nearestmaxcount: "2",
    });
    expect(response.data).toEqual([
      {
        id: "SN18700",
        name: "OSLO - BLINDERN",
        shortName: "Oslo (Blindern)",
        countryCode: "NO",
        wmoId: 1492,
        wigosId: "0-20000-0-01492",
        coordinates: { latitude: 59.9423, longitude: 10.72 },
        elevationMetres: 94,
        distanceKm: 3.1,
        validFrom: "1931-01-01T00:00:00.000Z",
        county: "OSLO",
        countyId: 3,
        municipality: "OSLO",
        municipalityId: 301,
        externalIds: ["0-20000-0-01492", "01492"],
        icaoCodes: [],
      },
      {
        id: "SN18950",
        name: "OSLO - TRYVANNSHØGDA",
        countryCode: "NO",
        coordinates: { latitude: 59.9844, longitude: 10.6693 },
        elevationMetres: 514,
        distanceKm: 9.4,
        validFrom: "1927-01-01T00:00:00.000Z",
        validTo: "2026-01-01T00:00:00.000Z",
        externalIds: [],
        icaoCodes: [],
      },
    ]);
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain("stationHolders");
    expect(serialized).not.toContain("A Volunteer Observer");
    expect(response.source).toMatchObject({
      id: "met-frost",
      license: expect.stringContaining("CC BY 3.0"),
    });
  });

  it("forwards every other filter and defaults the nearest count to one", async () => {
    const client = climate(
      jsonResponse(frostNearestSourcesFixture),
      jsonResponse(frostNearestSourcesFixture),
    );
    await client.climate.searchStations({
      ids: ["SN18700", "SN18950"],
      name: "OSLO*",
      municipality: "OSLO",
      county: "OSLO",
      elements: ["air_temperature", "sum(precipitation_amount P1D)"],
      activeOnly: true,
    });
    expect(client.query()).toEqual({
      types: "SensorSystem",
      ids: "SN18700,SN18950",
      name: "OSLO*",
      municipality: "OSLO",
      county: "OSLO",
      elements: "air_temperature,sum(precipitation_amount P1D)",
      validtime: "now",
    });

    await client.climate.searchStations({ near: { latitude: 60, longitude: 10 } });
    expect(client.query(1)["nearestmaxcount"]).toBe("1");
  });

  it.each([
    [{}, "at least one"],
    [{ activeOnly: true }, "at least one"],
    [{ ids: ["18700"] }, "SN18700"],
    [{ ids: ["SN18700:0"] }, "SN18700"],
    [{ elements: ["air_temperature,wind_speed"] }, "commas"],
    [{ near: { latitude: 60, longitude: 10, maxCount: 101 } }, "100"],
  ])("rejects %j before any request", async (parameters, reason) => {
    const client = climate();
    const request = client.climate.searchStations(parameters as never);
    await expect(request).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.climate.searchStations(parameters as never)).rejects.toMatchObject({
      cause: expect.objectContaining({ message: expect.stringContaining(reason) }),
    });
    expect(client.mock).not.toHaveBeenCalled();
  });

  it("resolves a query Frost has no data for to an empty array", async () => {
    const client = climate(jsonResponse(frostErrorFixture(404, "Not found", "No data found"), 404));
    await expect(client.climate.searchStations({ name: "NOWHERE*" })).resolves.toMatchObject({
      data: [],
    });
  });
});

describe("climate.getAvailableTimeSeries", () => {
  it("lists time series with their resolution, offset and level", async () => {
    const client = climate(jsonResponse(frostTimeSeriesFixture));
    const response = await client.climate.getAvailableTimeSeries({
      stationIds: ["SN18700:0"],
      elements: ["air_temperature", "sum(precipitation_amount P1D)"],
      from: "2026-01-01T00:00:00Z",
      to: "2026-02-01T00:00:00Z",
    });

    expect(client.url().pathname).toBe("/observations/availableTimeSeries/v0.jsonld");
    expect(client.query()).toEqual({
      sources: "SN18700:0",
      elements: "air_temperature,sum(precipitation_amount P1D)",
      referencetime: "2026-01-01T00:00:00/2026-02-01T00:00:00",
    });
    expect(response.data[0]).toEqual({
      stationId: "SN18700:0",
      elementId: "air_temperature",
      unit: "degC",
      timeResolution: "PT1H",
      timeOffset: "PT0H",
      level: { type: "height_above_ground", unit: "m", value: 2 },
      validFrom: "1937-01-01T00:00:00.000Z",
      timeSeriesId: 0,
      performanceCategory: "C",
      exposureCategory: "1",
      status: "Authoritative",
      coordinates: { latitude: 59.9423, longitude: 10.72 },
    });
    expect(response.data[1]).not.toHaveProperty("validTo");
  });

  it("omits the window when none is given and requires both bounds together", async () => {
    const client = climate(jsonResponse(frostTimeSeriesFixture));
    await client.climate.getAvailableTimeSeries({ stationIds: ["SN18700"] });
    expect(client.query()).toEqual({ sources: "SN18700" });
    await expect(
      client.climate.getAvailableTimeSeries({
        stationIds: ["SN18700"],
        from: "2026-01-01T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("resolves to an empty array when Frost has no series", async () => {
    const client = climate(jsonResponse(frostErrorFixture(404, "Not found"), 404));
    await expect(
      client.climate.getAvailableTimeSeries({ stationIds: ["SN99999999"] }),
    ).resolves.toMatchObject({ data: [] });
  });
});

describe("climate.getObservations", () => {
  it("requests a UTC window with Frost's default offsets and levels", async () => {
    const client = climate(jsonResponse(frostObservationsFixture));
    const response = await client.climate.getObservations(observationWindow);

    expect(client.url().pathname).toBe("/observations/v0.jsonld");
    expect(client.query()).toEqual({
      sources: "SN18700",
      elements: "air_temperature,wind_speed",
      referencetime: "2026-10-14T12:00:00/2026-10-15T00:00:00",
      timeoffsets: "default",
      levels: "default",
    });
    const [first, second] = response.data;
    expect(first).toMatchObject({
      stationId: "SN18700:0",
      referenceTime: "2026-10-14T12:00:00.000Z",
      coordinates: { latitude: 59.9423, longitude: 10.72 },
    });
    expect(first?.observations[0]).toEqual({
      elementId: "air_temperature",
      value: 11.3,
      unit: "degC",
      level: { type: "height_above_ground", unit: "m", value: 2 },
      timeOffset: "PT0H",
      timeResolution: "PT1H",
      timeSeriesId: 0,
      performanceCategory: "C",
      exposureCategory: "1",
      qualityCode: 0,
    });
    // Time-valued elements keep Frost's timestamp string.
    expect(second?.observations[0]?.value).toBe("2026-10-14 12:41:00.000");
  });

  it("forwards explicit resolutions, offsets, levels and quality codes", async () => {
    const client = climate(jsonResponse(frostObservationsFixture));
    await client.climate.getObservations({
      ...observationWindow,
      stationIds: ["SN18700:all"],
      timeResolutions: ["PT1H"],
      timeOffsets: ["PT0H", "PT6H"],
      levels: [2, 10],
      qualities: [0, 1, 2],
    });
    expect(client.query()).toMatchObject({
      sources: "SN18700:all",
      timeresolutions: "PT1H",
      timeoffsets: "PT0H,PT6H",
      levels: "2,10",
      qualities: "0,1,2",
    });
  });

  it("allows a year of daily data but only a month of anything finer", async () => {
    const client = climate(jsonResponse(frostObservationsFixture));
    const year = { from: "2025-01-01T00:00:00Z", to: "2026-01-01T00:00:00Z" };
    await expect(
      client.climate.getObservations({
        ...observationWindow,
        ...year,
        timeResolutions: ["P1D", "P1M"],
      }),
    ).resolves.toBeDefined();
    await expect(
      client.climate.getObservations({
        ...observationWindow,
        ...year,
        timeResolutions: ["P1D", "PT1H"],
      }),
    ).rejects.toThrow("31 days");
    await expect(client.climate.getObservations({ ...observationWindow, ...year })).rejects.toThrow(
      "31 days",
    );
    await expect(
      client.climate.getObservations({
        ...observationWindow,
        from: "2025-01-01T00:00:00Z",
        to: "2026-01-03T00:00:00Z",
        timeResolutions: ["P1D"],
      }),
    ).rejects.toThrow("366 days");
  });

  it.each([
    [{ stationIds: [] }],
    [{ stationIds: ["SN18700:x"] }],
    [{ elements: [] }],
    [{ elements: [" "] }],
    [{ timeResolutions: ["1 hour"] }],
    [{ timeOffsets: ["P"] }],
    [{ qualities: [12] }],
    [{ from: "2026-10-14T12:00:00" }],
  ])("rejects %j before any request", async (override) => {
    const client = climate();
    await expect(
      client.climate.getObservations({ ...observationWindow, ...override } as never),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(client.mock).not.toHaveBeenCalled();
  });

  it.each([
    [404, "No data was found for the query parameters"],
    [412, "No available time series for the query parameters"],
  ])("resolves Frost's HTTP %i to an empty array", async (status, message) => {
    const client = climate(jsonResponse(frostErrorFixture(status, message), status));
    await expect(client.climate.getObservations(observationWindow)).resolves.toMatchObject({
      data: [],
    });
  });

  it("reports too many observations as a provider error", async () => {
    const client = climate(
      jsonResponse(frostErrorFixture(403, "Too many observations requested"), 403),
    );
    await expect(client.climate.getObservations(observationWindow)).rejects.toMatchObject({
      name: "ProviderError",
      statusCode: 403,
    });
  });
});

describe("climate.getLatestObservations", () => {
  it("asks for the latest values within a maximum age", async () => {
    const client = climate(
      jsonResponse(frostObservationsFixture),
      jsonResponse(frostObservationsFixture),
    );
    await client.climate.getLatestObservations({
      stationIds: ["SN18700"],
      elements: ["air_temperature"],
    });
    expect(client.query()).toEqual({
      sources: "SN18700",
      elements: "air_temperature",
      referencetime: "latest",
      maxage: "PT3H",
      timeoffsets: "default",
      levels: "default",
    });

    const response = await client.climate.getLatestObservations({
      stationIds: ["SN18700"],
      elements: ["air_temperature"],
      maxAge: "P1D",
    });
    expect(client.query(1)["maxage"]).toBe("P1D");
    expect(response.data).toHaveLength(2);
  });

  it("rejects a malformed maximum age", async () => {
    const client = climate();
    await expect(
      client.climate.getLatestObservations({
        stationIds: ["SN18700"],
        elements: ["air_temperature"],
        maxAge: "3 hours",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });
});

describe("climate.getClimateNormals", () => {
  it("returns normals and keeps a missing normal absent rather than zero", async () => {
    const client = climate(jsonResponse(frostNormalsFixture));
    const response = await client.climate.getClimateNormals({
      stationIds: ["SN18700"],
      elements: ["mean(air_temperature P1M)"],
      period: "1991/2020",
    });

    expect(client.url().pathname).toBe("/climatenormals/v0.jsonld");
    expect(client.query()).toEqual({
      sources: "SN18700",
      elements: "mean(air_temperature P1M)",
      period: "1991/2020",
    });
    expect(response.data).toEqual([
      {
        stationId: "SN18700",
        elementId: "mean(air_temperature P1M)",
        period: "1991/2020",
        month: 10,
        normal: 7.4,
      },
      {
        stationId: "SN18700",
        elementId: "mean(air_temperature P1M)",
        period: "1991/2020",
        month: 11,
      },
    ]);
  });

  it.each([[{ stationIds: ["SN18700:0"] }], [{ stationIds: ["SN18700"], period: "1991-2020" }]])(
    "rejects %j before any request",
    async (parameters) => {
      const client = climate();
      await expect(client.climate.getClimateNormals(parameters as never)).rejects.toBeInstanceOf(
        InputValidationError,
      );
      expect(client.mock).not.toHaveBeenCalled();
    },
  );

  it("resolves a combination with no normals to an empty array", async () => {
    const client = climate(jsonResponse(frostErrorFixture(404, "Not found"), 404));
    await expect(
      client.climate.getClimateNormals({ stationIds: ["SN18700"], period: "1931/1960" }),
    ).resolves.toMatchObject({ data: [] });
  });
});
