import addressFixture from "../fixtures/kartverket-address.json" with { type: "json" };
import forecastFixture from "../fixtures/met-forecast.json" with { type: "json" };
import roadNetworkFixture from "../fixtures/nvdb-road-network.json" with { type: "json" };
import warningFixture from "../fixtures/nve-warning.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { boundingBoxAround, warningMatchesArea } from "../../src/profiles/address-profile.js";
import { NorwayOpenData, NotFoundError } from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

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
  const warning = { type: "flood" as const, regions: ["Haugesund", "Nord-Rogaland"] };

  it("matches on municipality or county name, case-insensitively", () => {
    expect(warningMatchesArea(warning, ["haugesund"])).toBe(true);
    expect(warningMatchesArea(warning, [undefined, "ROGALAND"])).toBe(true);
  });

  it("does not match unrelated areas, blanks, or regionless warnings", () => {
    expect(warningMatchesArea(warning, ["Tromsø"])).toBe(false);
    expect(warningMatchesArea(warning, ["  ", undefined])).toBe(false);
    expect(warningMatchesArea({ type: "flood" }, ["Haugesund"])).toBe(false);
  });
});

describe("profiles.address", () => {
  it("composes address, weather, matching hazards, and nearby roads", async () => {
    const { fetch } = routedFetch([
      ["ws.geonorge.no", addressFixture],
      ["api.met.no", forecastFixture],
      ["veglenkesekvenser", roadNetworkFixture],
      ["flood", warningFixture],
      ["avalanche", []],
      ["landslide", []],
    ]);
    const response = await new NorwayOpenData({
      applicationName: "example-profile",
      contactEmail: "profile@example.no",
      fetch,
      retries: 0,
    }).profiles.address("Haraldsgata 100, Haugesund");

    expect(response.data.address.municipalityName).toBeTruthy();
    expect(response.data.weather?.temperature).toBe(17.2);
    expect(response.data.roads).toHaveLength(1);
    expect(Array.isArray(response.data.hazards)).toBe(true);
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
    // Kartverket plus the three anonymous warning endpoints only.
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
