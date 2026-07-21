import hydropowerFixture from "../fixtures/nve-hydropower.json" with { type: "json" };
import observationsFixture from "../fixtures/nve-observations.json" with { type: "json" };
import reservoirFixture from "../fixtures/nve-reservoir.json" with { type: "json" };
import stationsFixture from "../fixtures/nve-stations.json" with { type: "json" };
import warningFixture from "../fixtures/nve-warning.json" with { type: "json" };
import windFixture from "../fixtures/nve-wind-power.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  ResponseValidationError,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("NVE clients", () => {
  it("normalizes and caches the latest reservoir statistics", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(reservoirFixture));
    const energy = new NorwayOpenData({ fetch, retries: 0, cache: { enabled: true } }).energy;
    const first = await energy.getReservoirStatistics();
    const second = await energy.getReservoirStatistics();
    expect(first.data[0]).toMatchObject({
      date: "2026-07-12",
      areaType: "NO",
      week: 28,
      fillLevel: 0.6283197,
      storedEnergyTwh: 54.93875,
    });
    expect(second.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("normalizes operational hydro and wind power plants", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).includes("WindPowerplant")
        ? jsonResponse(windFixture)
        : jsonResponse(hydropowerFixture),
    ) as typeof globalThis.fetch;
    const energy = new NorwayOpenData({ fetch, retries: 0 }).energy;
    await expect(energy.getHydropowerPlants()).resolves.toMatchObject({
      data: [
        {
          id: "2",
          name: "Adamselv",
          type: "hydropower",
          capacityMw: 50,
          annualProductionGwh: 196.366,
        },
      ],
    });
    await expect(energy.getWindPowerPlants()).resolves.toMatchObject({
      data: [
        {
          id: "20",
          name: "Bessakerfjellet",
          type: "wind",
          capacityMw: 57.5,
        },
      ],
    });
    const wind = await energy.getWindPowerPlants();
    expect(wind.data[0]).not.toHaveProperty("status");
    const combined = await energy.getPowerPlants({ includeRaw: true });
    expect(combined.data.map((plant) => plant.type)).toEqual(["hydropower", "wind"]);
    expect(combined.raw).toMatchObject({ hydropower: hydropowerFixture, wind: windFixture });
  });

  it("retains NVE's published negative pumped-storage figures", async () => {
    const negativePlant = [
      {
        ...hydropowerFixture[0],
        VannKraftverkID: 999,
        Navn: "Pumped storage test plant",
        MaksYtelse: -12.5,
        MidProd_91_20: -4.25,
      },
    ];
    const { fetch } = sequenceFetch(jsonResponse(negativePlant));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).energy.getHydropowerPlants();

    expect(response.data[0]).toMatchObject({
      id: "999",
      capacityMw: -12.5,
      annualProductionGwh: -4.25,
    });
  });

  it.each([
    ["getFloodWarnings", "flood/v1.0.10/api/Warning/2", "flood"],
    ["getAvalancheWarnings", "avalanche/v6.3.2/api/Warning/All/2", "avalanche"],
    ["getLandslideWarnings", "landslide/v1.0.10/api/Warning/2", "landslide"],
  ] as const)("constructs and normalizes %s", async (method, path, type) => {
    const { fetch, mock } = sequenceFetch(jsonResponse(warningFixture));
    const hazards = new NorwayOpenData({ fetch, retries: 0 }).hazards;
    const response = await hazards[method](
      { startDate: "2026-07-20", endDate: "2026-07-21", language: "en" },
      { includeRaw: true },
    );
    expect(String(mock.mock.calls[0]?.[0])).toContain(`${path}/2026-07-20/2026-07-21`);
    expect(response.data[0]).toMatchObject({
      id: "123",
      type,
      level: "2",
      forecastRegion: { id: "3001", name: "Svalbard øst" },
      counties: [{ code: "21", name: "Svalbard" }],
      municipalities: [{ code: "2100", name: "Svalbard" }],
      regions: ["Svalbard øst", "Svalbard"],
    });
    expect(response.raw).toEqual(warningFixture);
  });

  it("pads numeric administrative codes while preserving structured warning areas", async () => {
    const warning = warningFixture[0];
    if (warning === undefined) throw new Error("NVE warning fixture must contain one record.");
    const { fetch } = sequenceFetch(
      jsonResponse([
        {
          ...warning,
          CountyList: [{ Id: 3, Name: "Oslo" }],
          MunicipalityList: [{ Id: 301, Name: "Oslo" }],
        },
      ]),
    );

    const response = await new NorwayOpenData({ fetch, retries: 0 }).hazards.getFloodWarnings();

    expect(response.data[0]).toMatchObject({
      counties: [{ code: "03", name: "Oslo" }],
      municipalities: [{ code: "0301", name: "Oslo" }],
    });
  });

  it("normalizes administrative-name whitespace without changing included raw data", async () => {
    const warning = warningFixture[0];
    if (warning === undefined) throw new Error("NVE warning fixture must contain one record.");
    const payload = [
      {
        ...warning,
        CountyList: [{ Id: "11", Name: " Rogaland " }],
        MunicipalityList: [{ Id: "1106", Name: " Haugesund " }],
      },
    ];
    const { fetch } = sequenceFetch(jsonResponse(payload));

    const response = await new NorwayOpenData({ fetch, retries: 0 }).hazards.getFloodWarnings(
      {},
      { includeRaw: true },
    );

    expect(response.data[0]).toMatchObject({
      counties: [{ code: "11", name: "Rogaland" }],
      municipalities: [{ code: "1106", name: "Haugesund" }],
    });
    expect(response.raw).toEqual(payload);
  });

  it("rejects invalid warning date ranges before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse([]));
    await expect(
      new NorwayOpenData({ fetch }).hazards.getFloodWarnings({
        startDate: "2026-07-21",
        endDate: "2026-07-20",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      new NorwayOpenData({ fetch }).hazards.getFloodWarnings({ startDate: "2026-02-30" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("requires a HydAPI key before station or observation requests", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const hazards = new NorwayOpenData({ fetch }).hazards;
    await expect(hazards.getHydrologyStations()).rejects.toBeInstanceOf(ConfigurationError);
    await expect(
      hazards.getHydrologyObservations({
        stationId: "6.10.0",
        parameter: "1000",
        resolutionTime: "day",
      }),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid HydAPI station and observation selectors before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const hazards = new NorwayOpenData({
      fetch,
      credentials: { nve: { apiKey: "test-hydapi-key" } },
    }).hazards;

    await expect(hazards.getHydrologyStations({ stationId: "6.*.0" })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(
      hazards.getHydrologyObservations({
        stationId: "6.10.0",
        parameter: "1000,1001",
        resolutionTime: "day",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      hazards.getHydrologyObservations({
        stationId: "6.10.0",
        parameter: "1000",
        resolutionTime: "day",
        startDate: "not-a-date",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      hazards.getHydrologyObservations({
        stationId: "6.10.0",
        parameter: "1000",
        resolutionTime: "day",
        startDate: "2026-07-21",
        endDate: "2026-07-20",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("identifies and normalizes HydAPI station requests", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stationsFixture));
    const response = await new NorwayOpenData({
      fetch,
      retries: 0,
      credentials: { nve: { apiKey: "test-hydapi-key" } },
    }).hazards.getHydrologyStations({ municipalityCode: "3414", active: true });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    const headers = new Headers((mock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(url.searchParams.get("CouncilNumber")).toBe("3414");
    expect(url.searchParams.get("Active")).toBe("1");
    expect(headers.get("X-API-Key")).toBe("test-hydapi-key");
    expect(response.data[0]).toMatchObject({
      id: "6.10.0",
      name: "Austvatn",
      municipalityCode: "3414",
      status: "Aktiv",
    });
  });

  it("constructs and normalizes HydAPI observation requests", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(observationsFixture));
    const response = await new NorwayOpenData({
      fetch,
      retries: 0,
      credentials: { nve: { apiKey: "test-hydapi-key" } },
    }).hazards.getHydrologyObservations({
      stationId: "6.10.0",
      parameter: "1000",
      resolutionTime: "day",
      startDate: "2026-07-19",
      endDate: "2026-07-20",
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("ReferenceTime")).toBe("2026-07-19/2026-07-20");
    expect(response.data).toEqual([
      {
        stationId: "6.10.0",
        parameter: "1000",
        time: "2026-07-19T11:00:00Z",
        value: 1.23,
      },
      {
        stationId: "6.10.0",
        parameter: "1000",
        time: "2026-07-20T11:00:00Z",
        value: null,
      },
    ]);
  });

  it("rejects malformed NVE responses without weakening schemas", async () => {
    const { fetch } = sequenceFetch(jsonResponse([{}]));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).energy.getReservoirStatistics(),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const reservoir = reservoirFixture[0];
    const warning = warningFixture[0];
    if (reservoir === undefined || warning === undefined) {
      throw new Error("NVE fixtures must contain one record.");
    }
    const invalidFill = sequenceFetch(jsonResponse([{ ...reservoir, fyllingsgrad: 1.2 }]));
    await expect(
      new NorwayOpenData({ fetch: invalidFill.fetch, retries: 0 }).energy.getReservoirStatistics(),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const invalidCoordinates = sequenceFetch(jsonResponse([{ ...warning, Latitude: 95 }]));
    await expect(
      new NorwayOpenData({ fetch: invalidCoordinates.fetch, retries: 0 }).hazards.getFloodWarnings({
        startDate: "2026-07-20",
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const missingStationData = sequenceFetch(jsonResponse({ itemCount: 1 }));
    await expect(
      new NorwayOpenData({
        fetch: missingStationData.fetch,
        retries: 0,
        credentials: { nve: { apiKey: "test-hydapi-key" } },
      }).hazards.getHydrologyStations(),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const nullStationId = sequenceFetch(
      jsonResponse({ itemCount: 1, data: [{ stationId: null }] }),
    );
    await expect(
      new NorwayOpenData({
        fetch: nullStationId.fetch,
        retries: 0,
        credentials: { nve: { apiKey: "test-hydapi-key" } },
      }).hazards.getHydrologyStations(),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
