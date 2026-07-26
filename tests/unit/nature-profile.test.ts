import { describe, expect, it, vi } from "vitest";

import type { FeaturePagePagination } from "../../src/core/feature-page.js";
import type { OpenDataResponse } from "../../src/core/types.js";
import { responseSource } from "../../src/core/provider.js";
import { ProfileClient, type ProfileDependencies } from "../../src/profiles/client.js";
import type {
  NaturbaseFeatureResult,
  ProtectedAreaFeature,
} from "../../src/providers/naturbase/types.js";
import type { LandResourceResult } from "../../src/providers/nibio/types.js";
import { providerDescriptors } from "../../src/providers/registry.js";

const RETRIEVED_AT = "2026-07-26T12:00:00.000Z";
const location = { latitude: 59.888, longitude: 10.829 };

function response<T>(data: T, provider: "naturbase" | "nibio" | "kartverket"): OpenDataResponse<T> {
  return {
    data,
    source: responseSource(providerDescriptors[provider]),
    retrievedAt: RETRIEVED_AT,
    cached: false,
  };
}

function interventionFreeResponse<T>(data: T): OpenDataResponse<T> {
  return {
    ...response(data, "naturbase"),
    source: {
      ...responseSource(providerDescriptors.naturbase),
      license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
      attribution: "Miljødirektoratet - inngrepsfri natur 01.2023",
    },
  };
}

function pagination(returned: number, truncated = false): FeaturePagePagination {
  return {
    limit: 100,
    pageSize: 100,
    pagesFetched: 1,
    returned,
    truncated,
    ...(truncated ? { nextOffset: returned } : {}),
  };
}

function naturbaseResult(
  id: string,
  truncated = false,
): NaturbaseFeatureResult<ProtectedAreaFeature> {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        id,
        geometry: null,
        properties: { id },
      },
    ],
    crs: {
      identifier: "OGC:CRS84" as const,
      uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84" as const,
      axisOrder: "longitude-latitude" as const,
      declared: false,
    },
    sourceCrs: {
      identifier: "EPSG:25833" as const,
      uri: "http://www.opengis.net/def/crs/EPSG/0/25833" as const,
      axisOrder: "easting-northing" as const,
    },
    pagination: pagination(1, truncated),
  };
}

function landResult(): LandResourceResult {
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        id: "AR50.1",
        geometry: null,
        properties: { id: "1", landTypeCode: "30" },
      },
    ],
    crs: {
      identifier: "EPSG:4326" as const,
      uri: "http://www.opengis.net/def/crs/EPSG/0/4326" as const,
      axisOrder: "longitude-latitude" as const,
      declared: true,
      original: "urn:ogc:def:crs:EPSG::4326",
    },
    sourceCrs: {
      identifier: "EPSG:4258" as const,
      uri: "http://www.opengis.net/def/crs/EPSG/0/4258" as const,
      axisOrder: "latitude-longitude" as const,
    },
    pagination: pagination(1),
  };
}

type StubOptions = {
  failNaturbase?: boolean;
  failLand?: boolean;
  failPlaces?: boolean;
  truncateProtected?: boolean;
};

function profileWithStubs(options: StubOptions = {}): {
  profile: ProfileClient;
  environment: { getProtectedAreasAt: ReturnType<typeof vi.fn> };
} {
  const naturbaseFailure = new Error("Naturbase temporarily unavailable");
  const environment = {
    getProtectedAreasAt: vi.fn(async () => {
      if (options.failNaturbase === true) throw naturbaseFailure;
      return response(
        naturbaseResult("protected-1", options.truncateProtected === true),
        "naturbase",
      );
    }),
    getProposedProtectedAreasAt: vi.fn(async () => {
      if (options.failNaturbase === true) throw naturbaseFailure;
      return response(naturbaseResult("proposed-1"), "naturbase");
    }),
    getNatureTypesAt: vi.fn(async () => {
      if (options.failNaturbase === true) throw naturbaseFailure;
      return response(naturbaseResult("nature-type-1"), "naturbase");
    }),
    getInterventionFreeAreasAt: vi.fn(async () => {
      if (options.failNaturbase === true) throw naturbaseFailure;
      return interventionFreeResponse(naturbaseResult("inon-1"));
    }),
  };
  const land = {
    getLandResourcesAt: vi.fn(async () => {
      if (options.failLand === true) throw new Error("NIBIO temporarily unavailable");
      return response(landResult(), "nibio");
    }),
  };
  const places = {
    nearby: vi.fn(async () => {
      if (options.failPlaces === true) throw new Error("Kartverket temporarily unavailable");
      return response(
        {
          items: [
            {
              name: "Østensjøvannet",
              municipalityCode: "0301",
              municipalityName: "Oslo",
              countyCode: "03",
              countyName: "Oslo",
              ...location,
            },
          ],
          total: 1,
        },
        "kartverket",
      );
    }),
  };
  const dependencies: ProfileDependencies = {
    weather: {} as ProfileDependencies["weather"],
    hazards: {} as ProfileDependencies["hazards"],
    roads: {} as ProfileDependencies["roads"],
    statistics: {} as ProfileDependencies["statistics"],
    health: {} as ProfileDependencies["health"],
    ais: {} as ProfileDependencies["ais"],
    fisheries: {} as ProfileDependencies["fisheries"],
    places: places as unknown as ProfileDependencies["places"],
    environment: environment as unknown as ProfileDependencies["environment"],
    land: land as unknown as ProfileDependencies["land"],
    canAuthenticate: () => true,
  };
  const profile = new ProfileClient(
    {} as ConstructorParameters<typeof ProfileClient>[0],
    {} as ConstructorParameters<typeof ProfileClient>[1],
    dependencies,
  );
  return { profile, environment };
}

describe("nature-at-location profile", () => {
  it("composes bounded nature, land and place information with real provider sources", async () => {
    const { profile, environment } = profileWithStubs({ truncateProtected: true });
    const result = await profile.natureAtLocation(location);

    expect(result.data.location).toEqual(location);
    expect(result.data.municipality).toEqual({
      code: "0301",
      name: "Oslo",
      countyCode: "03",
      countyName: "Oslo",
    });
    expect(result.data.nearestPlace?.name).toBe("Østensjøvannet");
    expect(result.data.protectedAreas?.[0]?.id).toBe("protected-1");
    expect(result.data.natureTypes?.[0]?.id).toBe("nature-type-1");
    expect(result.data.landResources?.[0]?.id).toBe("AR50.1");
    expect(result.data.warnings).toContain(
      "The protected areas result was truncated at 1 feature.",
    );
    expect(result.source).toEqual({
      id: "naturbase+nibio+kartverket",
      name: "Miljødirektoratet / Naturbase, NIBIO and Kartverket",
      homepage: "https://github.com/iamkm1/Norway-Open-Data",
      documentation: "https://github.com/iamkm1/Norway-Open-Data#cross-provider-nature-profile",
    });
    expect(result.sources?.map(({ id }) => id)).toEqual([
      "naturbase",
      "naturbase",
      "nibio",
      "kartverket",
    ]);
    expect(result.sources?.[1]).toMatchObject({
      id: "naturbase",
      license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
      attribution: "Miljødirektoratet - inngrepsfri natur 01.2023",
    });
    expect(result.sources?.find(({ id }) => id === "nibio")?.attribution).toBe("Kilde: NIBIO.");
    expect(result.sources?.some(({ id }) => id === result.source.id)).toBe(false);
    expect(environment.getProtectedAreasAt).toHaveBeenCalledWith(
      { ...location, limit: 100 },
      expect.objectContaining({ includeRaw: false }),
    );
  });

  it("keeps successful components when one provider fails", async () => {
    const { profile } = profileWithStubs({ failLand: true });
    const result = await profile.natureAtLocation({ ...location, limit: 5 });

    expect(result.data.protectedAreas).toHaveLength(1);
    expect(result.data.landResources).toBeUndefined();
    expect(result.data.warnings).toContain(
      "Land-resource lookup failed: NIBIO temporarily unavailable",
    );
    expect(
      result.data.components.find(({ operation }) => operation === "land.getLandResourcesAt"),
    ).toMatchObject({
      status: "omitted",
      reason: "provider-error",
      source: { id: "nibio", attribution: "Kilde: NIBIO." },
    });
    expect(result.source).toMatchObject({
      id: "naturbase+kartverket",
      name: "Miljødirektoratet / Naturbase and Kartverket",
      homepage: "https://github.com/iamkm1/Norway-Open-Data",
      documentation: "https://github.com/iamkm1/Norway-Open-Data#cross-provider-nature-profile",
    });
    expect(result.sources?.map(({ id }) => id)).toEqual(["naturbase", "naturbase", "kartverket"]);
  });

  it("fails only when every provider component fails", async () => {
    const { profile } = profileWithStubs({
      failNaturbase: true,
      failLand: true,
      failPlaces: true,
    });

    await expect(profile.natureAtLocation(location)).rejects.toMatchObject({
      name: "ProviderError",
      provider: "profiles",
    });
  });

  it("validates the shared coordinates and profile bound before starting requests", async () => {
    const { profile, environment } = profileWithStubs();

    await expect(
      profile.natureAtLocation({ latitude: Number.NaN, longitude: 10 }),
    ).rejects.toMatchObject({ name: "InputValidationError", provider: "profiles" });
    await expect(profile.natureAtLocation({ ...location, limit: 101 })).rejects.toMatchObject({
      name: "InputValidationError",
      provider: "profiles",
    });
    expect(environment.getProtectedAreasAt).not.toHaveBeenCalled();
  });

  it("propagates caller cancellation instead of degrading it to warnings", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const { profile } = profileWithStubs({
      failNaturbase: true,
      failLand: true,
      failPlaces: true,
    });

    await expect(profile.natureAtLocation(location, { signal: controller.signal })).rejects.toThrow(
      "Naturbase temporarily unavailable",
    );
  });
});
