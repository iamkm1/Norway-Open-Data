/**
 * Opt-in, tightly bounded probes for the v0.8 geospatial providers.
 *
 * Enabled only with `RUN_LIVE_TESTS=true`. These services are anonymous and
 * need no environment variables. Every feature request is capped at one item
 * and one upstream page; the catalogue probes use one-item windows.
 */
import { describe, expect, it } from "vitest";

import { NorwayOpenData } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe : describe.skip;

const sdk = new NorwayOpenData({
  retries: 1,
  timeoutMs: 30_000,
  cache: { enabled: true },
});

const OSLO_POINT = { latitude: 59.888, longitude: 10.829 } as const;
const oneFeature = { ...OSLO_POINT, limit: 1, pageSize: 1, maxPages: 1 } as const;
const OSLO_BOX = {
  south: 59.8875,
  west: 10.8285,
  north: 59.8885,
  east: 10.8295,
} as const;

async function takeOne<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
    break;
  }
  return items;
}

live("Geonorge — geospatial catalogue", () => {
  it("searches and retrieves one dataset without following discovered URLs", async () => {
    const search = await sdk.geodata.searchDatasets({
      query: "verneområder",
      limit: 1,
    });
    expect(search.source.id).toBe("geonorge");
    expect(search.data.items).toHaveLength(1);
    expect(search.data.pagination.returned).toBe(1);

    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();
    const metadata = await sdk.geodata.getDataset(String(id));
    expect(metadata.data.id).toBe(id);
    expect(metadata.data.type).toBe("dataset");
    expect(Array.isArray(metadata.data.distributions)).toBe(true);
    expect(Array.isArray(metadata.data.services)).toBe(true);
  });

  it("searches and retrieves one service", async () => {
    const search = await sdk.geodata.searchServices({ query: "WFS", limit: 1 });
    expect(search.data.items).toHaveLength(1);
    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();

    const metadata = await sdk.geodata.getService(String(id));
    expect(metadata.data.id).toBe(id);
    expect(metadata.data.type).toBe("service");
  });

  it("keeps both catalogue iterators caller-bounded", async () => {
    const datasets = await takeOne(
      sdk.geodata.searchDatasetsAll({ query: "vern", limit: 1 }, { maxItems: 1, maxPages: 1 }),
    );
    const services = await takeOne(
      sdk.geodata.searchServicesAll({ query: "WFS", limit: 1 }, { maxItems: 1, maxPages: 1 }),
    );
    expect(datasets).toHaveLength(1);
    expect(services).toHaveLength(1);
  });
});

live("Miljødirektoratet / Naturbase — selected vector layers", () => {
  it("queries current protected areas", async () => {
    const result = await sdk.environment.getProtectedAreasAt(oneFeature);
    expect(result.source.id).toBe("naturbase");
    expect(result.data.features.length).toBeLessThanOrEqual(1);
    expect(result.data.crs.identifier).toMatch(/^(?:OGC:CRS84|EPSG:4326)$/);
    expect(result.data.sourceCrs.identifier).toBe("EPSG:25833");
  });

  it("queries proposed protected areas", async () => {
    const result = await sdk.environment.getProposedProtectedAreasAt(oneFeature);
    expect(result.source.id).toBe("naturbase");
    expect(result.data.features.length).toBeLessThanOrEqual(1);
    expect(result.data.pagination.pagesFetched).toBeLessThanOrEqual(1);
  });

  it("queries modern important NiN nature types", async () => {
    const result = await sdk.environment.getNatureTypesAt(oneFeature);
    expect(result.source.id).toBe("naturbase");
    expect(result.data.features.length).toBeLessThanOrEqual(1);
    expect(result.data.pagination.pagesFetched).toBeLessThanOrEqual(1);
  });

  it("queries the January 2023 intervention-free nature status", async () => {
    const result = await sdk.environment.getInterventionFreeAreasAt(oneFeature);
    expect(result.source.id).toBe("naturbase");
    expect(result.source.attribution).toContain("inngrepsfri natur 01.2023");
    expect(result.data.features.length).toBeLessThanOrEqual(1);
    expect(result.data.pagination.pagesFetched).toBeLessThanOrEqual(1);
  });

  it("bounds every selected-layer iterator to one page", async () => {
    const query = { boundingBox: OSLO_BOX, limit: 1, pageSize: 1, maxPages: 1 };
    const [protectedAreas, proposedAreas, natureTypes, interventionFreeAreas] = await Promise.all([
      takeOne(sdk.environment.iterateProtectedAreas(query)),
      takeOne(sdk.environment.iterateProposedProtectedAreas(query)),
      takeOne(sdk.environment.iterateNatureTypes(query)),
      takeOne(sdk.environment.iterateInterventionFreeAreas(query)),
    ]);
    for (const features of [protectedAreas, proposedAreas, natureTypes, interventionFreeAreas]) {
      expect(features.length).toBeLessThanOrEqual(1);
    }
  });
});

live("NIBIO — AR50 land resources", () => {
  it("queries a single bounded WFS page", async () => {
    const result = await sdk.land.getLandResourcesAt(oneFeature);
    expect(result.source.id).toBe("nibio");
    expect(result.source.attribution).toBe("Kilde: NIBIO.");
    expect(result.data.features.length).toBeLessThanOrEqual(1);
    expect(result.data.crs.identifier).toBe("EPSG:4326");
    expect(result.data.pagination.pagesFetched).toBeLessThanOrEqual(1);
  });

  it("keeps the AR50 iterator caller-bounded", async () => {
    const features = await takeOne(
      sdk.land.iterateLandResources({
        boundingBox: OSLO_BOX,
        limit: 1,
        pageSize: 1,
        maxPages: 1,
      }),
    );
    expect(features.length).toBeLessThanOrEqual(1);
  });
});

live("Cross-provider nature profile", () => {
  it("composes partial results with real component sources", async () => {
    const result = await sdk.profiles.natureAtLocation({ ...OSLO_POINT, limit: 1 });
    expect(result.data.location).toEqual(OSLO_POINT);
    expect(result.data.components).toHaveLength(6);
    expect(result.data.warnings).toEqual(expect.any(Array));
    expect(result.sources?.length).toBeGreaterThan(0);
    expect(result.sources?.every(({ id }) => id !== "profiles")).toBe(true);
  });
});
