import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import { ResponseValidationError } from "../../src/core/errors.js";
import { NaturbaseClient } from "../../src/providers/naturbase/client.js";
import {
  interventionFreeAreaResponseSchema,
  protectedAreaResponseSchema,
} from "../../src/providers/naturbase/schemas.js";
import { jsonResponse, resolvedConfig, sequenceFetch } from "./helpers.js";

const polygon = {
  type: "Polygon",
  coordinates: [
    [
      [10, 59],
      [11, 59],
      [11, 60],
      [10, 59],
    ],
  ],
} as const;

function protectedFeature(id: number, domainId = `VV${id}`): unknown {
  return {
    type: "Feature",
    id,
    geometry: id === 2 ? null : polygon,
    properties: {
      OBJECTID: id,
      naturvernId: domainId,
      navn: id === 1 ? "  Test reserve  " : null,
      vernedato: id === 1 ? 1_735_689_600_000 : null,
    },
  };
}

function protectedPage(features: unknown[], exceededTransferLimit = false): Response {
  return jsonResponse({
    type: "FeatureCollection",
    features,
    exceededTransferLimit,
  });
}

function clientFor(fetch: typeof globalThis.fetch): NaturbaseClient {
  return new NaturbaseClient(new HttpClient(resolvedConfig(fetch)));
}

describe("NaturbaseClient", () => {
  it("uses the fixed protected-area layer and normalizes a point response", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => {
      void _input;
      return protectedPage([protectedFeature(1)]);
    });
    const result = await clientFor(fetch as typeof globalThis.fetch).getProtectedAreasAt({
      latitude: 59.91,
      longitude: 10.75,
      limit: 1,
    });

    const request = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(request.origin).toBe("https://kart.miljodirektoratet.no");
    expect(request.pathname).toBe("/arcgis/rest/services/vern/MapServer/0/query");
    expect(request.searchParams.get("geometry")).toBe("10.75,59.91");
    expect(request.searchParams.get("geometryType")).toBe("esriGeometryPoint");
    expect(request.searchParams.get("inSR")).toBe("4326");
    expect(request.searchParams.get("outSR")).toBe("4326");
    expect(request.searchParams.get("resultRecordCount")).toBe("1");
    expect(result.data.features[0]).toMatchObject({
      id: "VV1",
      properties: {
        id: "VV1",
        name: "Test reserve",
        protectedAt: "2025-01-01T00:00:00.000Z",
      },
    });
    expect(result.data.crs).toMatchObject({
      identifier: "OGC:CRS84",
      axisOrder: "longitude-latitude",
      declared: false,
    });
    expect(result.data.sourceCrs.identifier).toBe("EPSG:25833");
    expect(result.source.id).toBe("naturbase");
    expect(result.source.license).toContain("NLOD");
  });

  it("paginates a bbox by stable OBJECTID order and preserves null geometry", async () => {
    const { fetch, mock } = sequenceFetch(
      protectedPage([protectedFeature(1), protectedFeature(2)], true),
      protectedPage([protectedFeature(3)]),
    );
    const result = await clientFor(fetch).searchProtectedAreas({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 3,
      pageSize: 2,
    });

    const first = new URL(String(mock.mock.calls[0]?.[0]));
    const second = new URL(String(mock.mock.calls[1]?.[0]));
    expect(first.searchParams.get("geometryType")).toBe("esriGeometryEnvelope");
    expect(JSON.parse(first.searchParams.get("geometry") ?? "{}")).toEqual({
      xmin: 10,
      ymin: 59,
      xmax: 11,
      ymax: 60,
      spatialReference: { wkid: 4326 },
    });
    expect(first.searchParams.get("orderByFields")).toBe("OBJECTID");
    expect(first.searchParams.get("resultOffset")).toBe("0");
    expect(second.searchParams.get("resultOffset")).toBe("2");
    expect(second.searchParams.get("resultRecordCount")).toBe("1");
    expect(result.data.features[1]?.geometry).toBeNull();
    expect(result.data.pagination).toMatchObject({
      pagesFetched: 2,
      returned: 3,
      truncated: false,
    });
  });

  it("reports truncation without requesting beyond the caller limit", async () => {
    const fetch = vi.fn(async () =>
      protectedPage([protectedFeature(1), protectedFeature(2)], true),
    );
    const result = await clientFor(fetch as typeof globalThis.fetch).searchProtectedAreas({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 2,
      pageSize: 2,
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.data.pagination).toMatchObject({
      returned: 2,
      truncated: true,
      nextOffset: 2,
    });
  });

  it("inherits repeated-page protection from the bounded feature walker", async () => {
    const repeated = protectedPage([protectedFeature(1), protectedFeature(2)], true);
    const { fetch } = sequenceFetch(repeated, repeated);
    await expect(
      clientFor(fetch).searchProtectedAreas({
        boundingBox: { west: 10, south: 59, east: 11, north: 60 },
        limit: 4,
        pageSize: 2,
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("builds an exact INON FES predicate and preserves dataset attribution", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => {
      void _input;
      return jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: "status.26199",
            geometry: polygon,
            geometry_name: "geom",
            properties: { inonid: 26199, vsone: "2", arealkm2: 10.059612 },
          },
        ],
        numberMatched: 1,
        numberReturned: 1,
        crs: {
          type: "name",
          properties: { name: "urn:ogc:def:crs:EPSG::4326" },
        },
      });
    });
    const result = await clientFor(fetch as typeof globalThis.fetch).getInterventionFreeAreasAt({
      latitude: 61,
      longitude: 8,
      limit: 1,
    });

    const request = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(request.pathname).toBe("/geoserver/inngrepsfrinatur/ows");
    expect(request.searchParams.get("TYPENAMES")).toBe("inngrepsfrinatur:status");
    const filter = request.searchParams.get("FILTER") ?? "";
    expect(filter).toContain("<fes:Intersects>");
    expect(filter).toContain("<fes:ValueReference>geom</fes:ValueReference>");
    expect(filter).toContain("<gml:pos>8 61</gml:pos>");
    expect(filter).toContain("<fes:PropertyIsNotEqualTo>");
    expect(filter).toContain("<fes:Literal>n</fes:Literal>");
    expect(result.data.features[0]).toMatchObject({
      id: "26199",
      properties: {
        id: "26199",
        zone: "2",
        zoneDescription: "3-5 km from major infrastructure",
        statusDate: "2023-01",
      },
    });
    expect(result.data.crs).toMatchObject({
      identifier: "EPSG:4326",
      original: {
        type: "name",
        properties: { name: "urn:ogc:def:crs:EPSG::4326" },
      },
    });
    expect(result.source.attribution).toBe("Miljødirektoratet - inngrepsfri natur 01.2023");
    expect(result.source.license).toContain("NLOD");
  });

  it("returns an empty, complete feature collection", async () => {
    const result = await clientFor(
      vi.fn(async () => protectedPage([])) as typeof globalThis.fetch,
    ).searchProtectedAreas({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 10,
    });

    expect(result.data.features).toEqual([]);
    expect(result.data.pagination).toMatchObject({
      pagesFetched: 1,
      returned: 0,
      truncated: false,
    });
  });

  it("rejects undocumented boolean codes instead of coercing them", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            id: 1,
            geometry: polygon,
            properties: { OBJECTID: 1, NiNID: "NIN-1", Mosaikk: 2 },
          },
        ],
        exceededTransferLimit: false,
      }),
    );
    await expect(
      clientFor(fetch as typeof globalThis.fetch).getNatureTypesAt({
        latitude: 59.91,
        longitude: 10.75,
        limit: 1,
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("rejects unknown ArcGIS fields at collection, feature, and properties boundaries", () => {
    const feature = protectedFeature(1) as Record<string, unknown>;
    const properties = feature["properties"] as Record<string, unknown>;
    const collection = {
      type: "FeatureCollection",
      features: [feature],
      exceededTransferLimit: false,
    };

    expect(
      protectedAreaResponseSchema.safeParse({
        ...collection,
        UnexpectedCollectionField: true,
      }).success,
    ).toBe(false);
    expect(
      protectedAreaResponseSchema.safeParse({
        ...collection,
        features: [{ ...feature, UnexpectedFeatureField: true }],
      }).success,
    ).toBe(false);
    expect(
      protectedAreaResponseSchema.safeParse({
        ...collection,
        features: [
          {
            ...feature,
            properties: { ...properties, UnexpectedPropertyField: true },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects unknown WFS fields at collection, feature, and properties boundaries", () => {
    const feature = {
      type: "Feature",
      id: "status.1",
      geometry: polygon,
      geometry_name: "geom",
      properties: { inonid: 1, vsone: "1", arealkm2: 1 },
    };
    const collection = {
      type: "FeatureCollection",
      features: [feature],
      numberMatched: 1,
      numberReturned: 1,
    };

    expect(
      interventionFreeAreaResponseSchema.safeParse({
        ...collection,
        UnexpectedCollectionField: true,
      }).success,
    ).toBe(false);
    expect(
      interventionFreeAreaResponseSchema.safeParse({
        ...collection,
        features: [{ ...feature, UnexpectedFeatureField: true }],
      }).success,
    ).toBe(false);
    expect(
      interventionFreeAreaResponseSchema.safeParse({
        ...collection,
        features: [
          {
            ...feature,
            properties: {
              ...feature.properties,
              UnexpectedPropertyField: true,
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
});
