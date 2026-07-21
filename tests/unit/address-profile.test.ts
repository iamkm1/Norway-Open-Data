import addressFixture from "../fixtures/kartverket-address.json" with { type: "json" };
import forecastFixture from "../fixtures/met-forecast.json" with { type: "json" };
import roadNetworkFixture from "../fixtures/nvdb-road-network.json" with { type: "json" };
import warningFixture from "../fixtures/nve-warning.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { boundingBoxAround, warningMatchesArea } from "../../src/profiles/address-profile.js";
import {
  NorwayOpenData,
  NotFoundError,
  providers,
  type OpenDataSource,
  type ProviderMetadata,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

const RETRIEVED_AT = "2026-07-21T10:15:30.000Z";

const matchingWarningFixture = [
  {
    ...warningFixture[0],
    RegionId: 3011,
    RegionName: "Nord-Rogaland",
    CountyList: [{ Id: "11", Name: "Rogaland" }],
    MunicipalityList: [{ Id: "1106", Name: "Haugesund" }],
  },
];

const finalRoadPageFixture = {
  ...roadNetworkFixture,
  metadata: {
    returnert: roadNetworkFixture.metadata.returnert,
    sidestørrelse: roadNetworkFixture.metadata.sidestørrelse,
  },
};

const emptyRoadPageWithNextFixture = {
  objekter: [],
  metadata: {
    returnert: 0,
    sidestørrelse: 10,
    neste: {
      start: "empty-page-next",
      href: "https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/veglenkesekvenser/segmentert?start=empty-page-next",
    },
  },
};

const warningAttributions = {
  "hazards.getFloodWarnings": "Varsler fra Flomvarslingen i Norge og www.varsom.no",
  "hazards.getAvalancheWarnings": "Varsler fra Snøskredvarslingen i Norge og www.varsom.no",
  "hazards.getLandslideWarnings": "Varsler fra Jordskredvarslingen i Norge og www.varsom.no",
} as const;

function expectedSource(provider: ProviderMetadata): OpenDataSource {
  return {
    id: provider.id,
    name: provider.name,
    homepage: provider.homepage,
    documentation: provider.documentation,
    ...(provider.license === undefined ? {} : { license: provider.license }),
    ...(provider.attribution === undefined ? {} : { attribution: provider.attribution }),
  };
}

/** Routes by URL so the profile's concurrent requests stay order-independent. */
function routedFetch(routes: Array<[string, unknown]>): {
  fetch: typeof globalThis.fetch;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const match = routes.find(([fragment]) => url.includes(fragment));
    if (match === undefined) throw new Error(`Unexpected request: ${url}`);
    return jsonResponse(match[1]);
  });
  return { fetch: mock as unknown as typeof globalThis.fetch, mock };
}

describe("boundingBoxAround", () => {
  it("builds a box that contains the point and widens with latitude", () => {
    const [minLon, minLat, maxLon, maxLat] = boundingBoxAround(59.91, 10.75);
    expect(minLon).toBeLessThan(10.75);
    expect(maxLon).toBeGreaterThan(10.75);
    expect(minLat).toBeLessThan(59.91);
    expect(maxLat).toBeGreaterThan(59.91);

    const south = boundingBoxAround(0, 10);
    const north = boundingBoxAround(70, 10);
    expect(north[2] - north[0]).toBeGreaterThan(south[2] - south[0]);
  });

  it("stays inside valid coordinate ranges near the poles", () => {
    const [minLon, minLat, maxLon, maxLat] = boundingBoxAround(89.999, 179.999, 100_000);
    expect(minLon).toBeGreaterThanOrEqual(-180);
    expect(maxLon).toBeLessThanOrEqual(180);
    expect(minLat).toBeGreaterThanOrEqual(-90);
    expect(maxLat).toBeLessThanOrEqual(90);
  });
});

describe("warningMatchesArea", () => {
  const warning = {
    type: "flood" as const,
    forecastRegion: { id: "42", name: "Nord-Rogaland" },
    counties: [{ code: "11", name: "Rogaland" }],
    municipalities: [{ code: "1106", name: "Haugesund" }],
    regions: ["Haugesund", "Nord-Rogaland", "Rogaland"],
  };

  it("matches official codes before names and reports the exact basis", () => {
    expect(
      warningMatchesArea(warning, {
        municipalityCode: "1106",
        municipalityName: "Not Haugesund",
        countyCode: "11",
      }),
    ).toEqual({ basis: "municipality-code", addressValue: "1106", warningValue: "1106" });
    expect(
      warningMatchesArea({ type: "flood", counties: warning.counties }, { countyCode: "11" }),
    ).toEqual({ basis: "county-code", addressValue: "11", warningValue: "11" });
  });

  it("pads codes and falls back to exact normalized names including Norwegian diacritics", () => {
    expect(
      warningMatchesArea(
        {
          type: "flood",
          municipalities: [{ code: "301", name: "Oslo" }],
        },
        { municipalityCode: "0301" },
      ),
    ).toMatchObject({ basis: "municipality-code" });
    expect(
      warningMatchesArea(
        {
          type: "flood",
          municipalities: [{ name: "A\u030Alesund" }],
        },
        { municipalityName: "åLESUND" },
      ),
    ).toEqual({
      basis: "municipality-name",
      addressValue: "åLESUND",
      warningValue: "A\u030Alesund",
    });
    expect(
      warningMatchesArea({ type: "flood", counties: warning.counties }, { countyName: "ROGALAND" }),
    ).toEqual({ basis: "county-name", addressValue: "ROGALAND", warningValue: "Rogaland" });
  });

  it("does not confuse Os with Voss or use forecast regions as automatic matches", () => {
    expect(
      warningMatchesArea(
        { type: "flood", municipalities: [{ name: "Voss" }] },
        { municipalityName: "Os" },
      ),
    ).toBeUndefined();
    expect(
      warningMatchesArea(
        { type: "flood", forecastRegion: { name: "Haugesund" }, regions: ["Haugesund"] },
        { municipalityName: "Haugesund" },
      ),
    ).toBeUndefined();
  });

  it("does not let an exact name override contradictory official codes", () => {
    expect(
      warningMatchesArea(
        { type: "flood", municipalities: [{ code: "4624", name: "Bjørnafjorden" }] },
        { municipalityCode: "4630", municipalityName: "Bjørnafjorden" },
      ),
    ).toBeUndefined();
  });

  it("does not broaden a municipality warning through its parent county", () => {
    expect(
      warningMatchesArea(warning, {
        municipalityCode: "4624",
        municipalityName: "Bjørnafjorden",
        countyCode: "11",
        countyName: "Rogaland",
      }),
    ).toBeUndefined();
  });

  it("does not match unrelated areas, blanks, or warnings without administrative areas", () => {
    expect(warningMatchesArea(warning, { municipalityName: "Tromsø" })).toBeUndefined();
    expect(warningMatchesArea(warning, { municipalityName: "  " })).toBeUndefined();
    expect(
      warningMatchesArea({ type: "flood" }, { municipalityName: "Haugesund" }),
    ).toBeUndefined();
  });
});

describe("profiles.address", () => {
  it("composes exact hazard evidence, honest road metadata, and component provenance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RETRIEVED_AT));
    try {
      const { fetch, mock } = routedFetch([
        ["ws.geonorge.no", addressFixture],
        ["api.met.no", forecastFixture],
        ["veglenkesekvenser", roadNetworkFixture],
        ["flood", matchingWarningFixture],
        ["avalanche", []],
        ["landslide", []],
      ]);
      const response = await new NorwayOpenData({
        applicationName: "example-profile",
        contactEmail: "profile@example.no",
        fetch,
        retries: 0,
      }).profiles.address("Haraldsgata 100, Haugesund");

      expect(response.data.address.municipalityName).toBe("HAUGESUND");
      expect(response.data.weather?.temperature).toBe(17.2);
      expect(response.data.roads).toHaveLength(1);
      expect(response.data.hazards).toHaveLength(1);
      expect(response.data.hazards[0]).toMatchObject({
        type: "flood",
        municipalities: [{ code: "1106", name: "Haugesund" }],
      });
      expect(response.data.hazardMatches).toHaveLength(1);
      expect(response.data.hazardMatches?.[0]).toMatchObject({
        matchBasis: "municipality-code",
        addressArea: { code: "1106", name: "HAUGESUND" },
        warningArea: { code: "1106", name: "Haugesund" },
      });
      expect(response.data.hazardMatches?.[0]?.warning).toBe(response.data.hazards[0]);

      const expectedBoundingBox = boundingBoxAround(59.4111516, 5.2711408);
      expect(response.data.roadSearch).toEqual({
        shape: "bounding-box",
        halfSizeMetres: 250,
        boundingBox: expectedBoundingBox,
        requestedPageSize: 10,
        truncated: true,
      });
      const roadRequest = mock.mock.calls
        .map((call) => String(call[0]))
        .find((url) => url.includes("veglenkesekvenser"));
      if (roadRequest === undefined) throw new Error("Expected an NVDB road-network request.");
      const roadUrl = new URL(roadRequest);
      expect(roadUrl.searchParams.get("kartutsnitt")).toBe(expectedBoundingBox.join(","));
      expect(roadUrl.searchParams.get("antall")).toBe("10");

      const componentExpectations = [
        ["addresses.search", "address", providers.kartverket],
        ["hazards.getFloodWarnings", "hazards", providers.nve],
        ["hazards.getAvalancheWarnings", "hazards", providers.nve],
        ["hazards.getLandslideWarnings", "hazards", providers.nve],
        ["weather.current", "weather", providers.met],
        ["roads.getRoadNetwork", "roads", providers.vegvesen],
      ] as const;
      expect(response.data.components).toHaveLength(componentExpectations.length);
      for (const [operation, section, provider] of componentExpectations) {
        const source = expectedSource(provider);
        const attribution = warningAttributions[operation as keyof typeof warningAttributions];
        expect(
          response.data.components?.find((component) => component.operation === operation),
        ).toEqual({
          operation,
          section,
          status: "available",
          source: attribution === undefined ? source : { ...source, attribution },
          retrievedAt: RETRIEVED_AT,
          cached: false,
        });
      }
      expect(response.source.documentation).toBe(
        "https://github.com/iamkm1/Norway-Open-Data#cross-provider-address-profile",
      );
      expect(response.source.id).toBe("kartverket+met+nve+vegvesen");
    } finally {
      vi.useRealTimers();
    }
  });

  it("reports an untruncated road result when NVDB has no next page", async () => {
    const { fetch } = routedFetch([
      ["ws.geonorge.no", addressFixture],
      ["api.met.no", forecastFixture],
      ["veglenkesekvenser", finalRoadPageFixture],
      ["flood", []],
      ["avalanche", []],
      ["landslide", []],
    ]);
    const response = await new NorwayOpenData({
      applicationName: "example-profile",
      contactEmail: "profile@example.no",
      fetch,
      retries: 0,
    }).profiles.address("Haraldsgata 100, Haugesund");

    expect(response.data.roadSearch).toEqual({
      shape: "bounding-box",
      halfSizeMetres: 250,
      boundingBox: boundingBoxAround(59.4111516, 5.2711408),
      requestedPageSize: 10,
      truncated: false,
    });
  });

  it("reports truncation when an empty NVDB page still advertises a next page", async () => {
    const { fetch } = routedFetch([
      ["ws.geonorge.no", addressFixture],
      ["api.met.no", forecastFixture],
      ["veglenkesekvenser", emptyRoadPageWithNextFixture],
      ["flood", []],
      ["avalanche", []],
      ["landslide", []],
    ]);
    const response = await new NorwayOpenData({
      applicationName: "example-profile",
      contactEmail: "profile@example.no",
      fetch,
      retries: 0,
    }).profiles.address("Haraldsgata 100, Haugesund");

    expect(response.data.roads).toEqual([]);
    expect(response.data.roadSearch).toMatchObject({ truncated: true });
  });

  it.each(["weather", "roads"] as const)(
    "reports the composite response as fresh when optional %s data is fresh",
    async (freshProvider) => {
      const query = "Haraldsgata 100, Haugesund";
      const { fetch } = routedFetch([
        ["ws.geonorge.no", addressFixture],
        ["api.met.no", forecastFixture],
        ["veglenkesekvenser", roadNetworkFixture],
        ["flood", warningFixture],
        ["avalanche", []],
        ["landslide", []],
      ]);
      const sdk = new NorwayOpenData({
        applicationName: "example-profile",
        contactEmail: "profile@example.no",
        fetch,
        retries: 0,
        cache: { enabled: true },
      });
      const addressResponse = await sdk.addresses.search({ query, limit: 1 });
      const latitude = addressResponse.data.items[0]?.latitude;
      const longitude = addressResponse.data.items[0]?.longitude;
      if (latitude === undefined || longitude === undefined) {
        throw new Error("Address fixture must include coordinates.");
      }

      const optionalPrime =
        freshProvider === "weather"
          ? sdk.roads.getRoadNetwork({
              boundingBox: boundingBoxAround(latitude, longitude),
              pageSize: 10,
            })
          : sdk.weather.current({ latitude, longitude });
      await Promise.all([
        sdk.hazards.getFloodWarnings(),
        sdk.hazards.getAvalancheWarnings(),
        sdk.hazards.getLandslideWarnings(),
        optionalPrime,
      ]);

      const response = await sdk.profiles.address(query);

      expect(response.data.weather).toBeDefined();
      expect(response.data.roads).toBeDefined();
      expect(response.cached).toBe(false);
      const freshOperation =
        freshProvider === "weather" ? "weather.current" : "roads.getRoadNetwork";
      const cachedOperation =
        freshProvider === "weather" ? "roads.getRoadNetwork" : "weather.current";
      expect(
        response.data.components?.find((component) => component.operation === freshOperation),
      ).toMatchObject({ status: "available", cached: false });
      expect(
        response.data.components?.find((component) => component.operation === cachedOperation),
      ).toMatchObject({ status: "available", cached: true });
      for (const operation of [
        "addresses.search",
        "hazards.getFloodWarnings",
        "hazards.getAvalancheWarnings",
        "hazards.getLandslideWarnings",
      ]) {
        expect(
          response.data.components?.find((component) => component.operation === operation),
        ).toMatchObject({ status: "available", cached: true });
      }
    },
  );

  it("reports the composite response as cached when every included operation is cached", async () => {
    const query = "Haraldsgata 100, Haugesund";
    const { fetch, mock } = routedFetch([
      ["ws.geonorge.no", addressFixture],
      ["api.met.no", forecastFixture],
      ["veglenkesekvenser", roadNetworkFixture],
      ["flood", warningFixture],
      ["avalanche", []],
      ["landslide", []],
    ]);
    const sdk = new NorwayOpenData({
      applicationName: "example-profile",
      contactEmail: "profile@example.no",
      fetch,
      retries: 0,
      cache: { enabled: true },
    });

    expect((await sdk.profiles.address(query)).cached).toBe(false);
    const cached = await sdk.profiles.address(query);

    expect(cached.cached).toBe(true);
    expect(
      cached.data.components?.filter((component) => component.status === "available"),
    ).toHaveLength(6);
    for (const component of cached.data.components ?? []) {
      if (component.status === "available") expect(component.cached).toBe(true);
    }
    expect(mock).toHaveBeenCalledTimes(6);
  });

  it("omits weather and roads when identification is not configured", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(addressFixture),
      jsonResponse([]),
      jsonResponse([]),
      jsonResponse([]),
    );
    const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.address(
      "Haraldsgata 100",
    );

    expect(response.data.address).toBeDefined();
    expect(response.data.weather).toBeUndefined();
    expect(response.data.roads).toBeUndefined();
    expect(response.data.hazards).toEqual([]);
    expect(response.data.components?.slice(-2)).toEqual([
      {
        operation: "weather.current",
        section: "weather",
        status: "omitted",
        source: expectedSource(providers.met),
        reason: "not-configured",
      },
      {
        operation: "roads.getRoadNetwork",
        section: "roads",
        status: "omitted",
        source: expectedSource(providers.vegvesen),
        reason: "not-configured",
      },
    ]);
    expect(response.source.id).toBe("kartverket+nve");
    // Kartverket plus the three anonymous warning endpoints only.
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("reports missing coordinates separately from missing provider identification", async () => {
    const addressWithoutCoordinates = structuredClone(addressFixture);
    const address = addressWithoutCoordinates.adresser[0];
    if (address === undefined) throw new Error("Address fixture must contain one result.");
    delete (address as Partial<typeof address>).representasjonspunkt;
    const { fetch, mock } = routedFetch([
      ["ws.geonorge.no", addressWithoutCoordinates],
      ["flood", []],
      ["avalanche", []],
      ["landslide", []],
    ]);
    const response = await new NorwayOpenData({
      applicationName: "example-profile",
      contactEmail: "profile@example.no",
      fetch,
      retries: 0,
    }).profiles.address("Haraldsgata 100");

    expect(response.data.address).not.toHaveProperty("latitude");
    expect(response.data.weather).toBeUndefined();
    expect(response.data.roads).toBeUndefined();
    expect(response.data.components?.slice(-2)).toEqual([
      {
        operation: "weather.current",
        section: "weather",
        status: "omitted",
        source: expectedSource(providers.met),
        reason: "missing-coordinate",
      },
      {
        operation: "roads.getRoadNetwork",
        section: "roads",
        status: "omitted",
        source: expectedSource(providers.vegvesen),
        reason: "missing-coordinate",
      },
    ]);
    expect(mock).toHaveBeenCalledTimes(4);
  });

  it("throws when no official address matches", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({ metadata: { totaltAntallTreff: 0 }, adresser: [] }),
    );
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).profiles.address("nowhere at all"),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
