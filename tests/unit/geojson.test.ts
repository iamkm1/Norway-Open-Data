import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../src/core/errors.js";
import {
  boundingBoxToGeoJsonBoundingBox,
  coordinatesToGeoJsonPosition,
  geoJsonBoundingBoxSchema,
  geoJsonFeatureCollectionSchema,
  geoJsonFeatureSchema,
  geoJsonGeometrySchema,
  geoJsonLineStringSchema,
  geoJsonMultiPointSchema,
  geoJsonMultiPolygonSchema,
  geoJsonPointSchema,
  geoJsonPolygonSchema,
  nullableGeoJsonGeometrySchema,
  resolveGeoJsonCrs,
} from "../../src/core/geojson.js";

const exterior = [
  [10, 59],
  [11, 59],
  [11, 60],
  [10, 60],
  [10, 59],
];

const hole = [
  [10.2, 59.2],
  [10.8, 59.2],
  [10.8, 59.8],
  [10.2, 59.8],
  [10.2, 59.2],
];

describe("GeoJSON geometry validation", () => {
  it("accepts the supported point, multipoint and line geometries", () => {
    expect(
      geoJsonPointSchema.safeParse({ type: "Point", coordinates: [10.75, 59.91] }).success,
    ).toBe(true);
    expect(
      geoJsonMultiPointSchema.safeParse({
        type: "MultiPoint",
        coordinates: [
          [10.75, 59.91],
          [5.32, 60.39],
        ],
      }).success,
    ).toBe(true);
    expect(
      geoJsonLineStringSchema.safeParse({
        type: "LineString",
        coordinates: [
          [10, 59],
          [11, 60],
        ],
      }).success,
    ).toBe(true);
  });

  it("accepts polygon holes and preserves every ring", () => {
    const parsed = geoJsonPolygonSchema.parse({
      type: "Polygon",
      coordinates: [exterior, hole],
    });

    expect(parsed.coordinates).toHaveLength(2);
    expect(parsed.coordinates[1]).toEqual(hole);
  });

  it("accepts multiple polygons, including a polygon with a hole", () => {
    const secondExterior = [
      [5, 61],
      [6, 61],
      [6, 62],
      [5, 62],
      [5, 61],
    ];
    const parsed = geoJsonMultiPolygonSchema.parse({
      type: "MultiPolygon",
      coordinates: [[exterior, hole], [secondExterior]],
    });

    expect(parsed.coordinates).toHaveLength(2);
    expect(parsed.coordinates[0]).toHaveLength(2);
  });

  it.each([
    { type: "Point", coordinates: [Number.NaN, 59] },
    { type: "Point", coordinates: [10, Number.POSITIVE_INFINITY] },
    { type: "Point", coordinates: [181, 59] },
    { type: "Point", coordinates: [10, 91] },
    { type: "Point", coordinates: [10, 59, 100] },
    { type: "MultiPoint", coordinates: [] },
    { type: "LineString", coordinates: [[10, 59]] },
    {
      type: "Polygon",
      coordinates: [
        [
          [10, 59],
          [11, 59],
          [11, 60],
          [10, 60],
        ],
      ],
    },
    {
      type: "Polygon",
      coordinates: [
        [
          [10, 59],
          [10, 59],
          [10, 59],
          [10, 59],
        ],
      ],
    },
    { type: "MultiPolygon", coordinates: [] },
    { type: "GeometryCollection", geometries: [] },
  ])("rejects malformed or unsupported geometry %#", (geometry) => {
    expect(geoJsonGeometrySchema.safeParse(geometry).success).toBe(false);
  });

  it("rejects an invalid interior ring even when the exterior is valid", () => {
    const openHole = hole.slice(0, -1);
    expect(
      geoJsonPolygonSchema.safeParse({
        type: "Polygon",
        coordinates: [exterior, openHole],
      }).success,
    ).toBe(false);
  });

  it("accepts null only through the explicit nullable geometry contract", () => {
    expect(nullableGeoJsonGeometrySchema.safeParse(null).success).toBe(true);
    expect(geoJsonGeometrySchema.safeParse(null).success).toBe(false);

    const feature = geoJsonFeatureSchema.parse({
      type: "Feature",
      id: "missing-geometry",
      geometry: null,
      properties: null,
    });
    expect(feature.geometry).toBeNull();
    expect(feature.properties).toBeNull();
  });

  it("validates feature identifiers and keeps dynamic properties", () => {
    const feature = geoJsonFeatureSchema.parse({
      type: "Feature",
      id: 42,
      geometry: { type: "Point", coordinates: [10.75, 59.91] },
      properties: { name: "Oslo", selected: true, nullable: null },
    });

    expect(feature.id).toBe(42);
    expect(feature.properties).toEqual({ name: "Oslo", selected: true, nullable: null });
    expect(
      geoJsonFeatureSchema.safeParse({
        type: "Feature",
        id: Number.POSITIVE_INFINITY,
        geometry: null,
        properties: {},
      }).success,
    ).toBe(false);
    expect(
      geoJsonFeatureSchema.safeParse({
        type: "Feature",
        id: "   ",
        geometry: null,
        properties: {},
      }).success,
    ).toBe(false);
  });

  it("keeps the base objects strict so provider extras require an explicit schema", () => {
    expect(
      geoJsonFeatureSchema.safeParse({
        type: "Feature",
        geometry: null,
        properties: {},
        undocumented: true,
      }).success,
    ).toBe(false);
    expect(
      geoJsonPointSchema.safeParse({
        type: "Point",
        coordinates: [10, 59],
        crs: "EPSG:4326",
      }).success,
    ).toBe(false);
  });
});

describe("GeoJSON FeatureCollection and CRS", () => {
  it("accepts an empty FeatureCollection", () => {
    const parsed = geoJsonFeatureCollectionSchema.parse({
      type: "FeatureCollection",
      features: [],
    });

    expect(parsed.features).toEqual([]);
  });

  it("uses implicit CRS84 when no CRS is declared", () => {
    expect(resolveGeoJsonCrs(undefined)).toEqual({
      identifier: "OGC:CRS84",
      uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axisOrder: "longitude-latitude",
      declared: false,
    });
    expect(resolveGeoJsonCrs(null).declared).toBe(false);
  });

  it("accepts and preserves named CRS84 and EPSG:4326 declarations", () => {
    const named = {
      type: "name" as const,
      properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" },
    };
    expect(resolveGeoJsonCrs(named)).toEqual({
      identifier: "OGC:CRS84",
      uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axisOrder: "longitude-latitude",
      declared: true,
      original: named,
    });

    const epsg = resolveGeoJsonCrs("urn:ogc:def:crs:EPSG::4326");
    expect(epsg.identifier).toBe("EPSG:4326");
    expect(epsg.original).toBe("urn:ogc:def:crs:EPSG::4326");
  });

  it("accepts ArcGIS 4326 metadata only when every published WKID agrees", () => {
    const original = { wkid: 4326, latestWkid: 4326 };
    expect(resolveGeoJsonCrs(original)).toMatchObject({
      identifier: "EPSG:4326",
      declared: true,
      original,
    });
    expect(() => resolveGeoJsonCrs({ wkid: 102100, latestWkid: 3857 }, "arcgis")).toThrow(
      ResponseValidationError,
    );
    try {
      resolveGeoJsonCrs({ wkid: 3857 }, "arcgis");
    } catch (error) {
      expect((error as ResponseValidationError).provider).toBe("arcgis");
    }
  });

  it.each([
    "EPSG:3857",
    "EPSG:25833",
    { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::25833" } },
    { wkid: 4326, latestWkid: 3857 },
    { wkid: "4326" },
    {},
  ])("rejects unsupported or malformed CRS metadata %#", (crs) => {
    expect(() => resolveGeoJsonCrs(crs, "test-provider")).toThrow(ResponseValidationError);
  });

  it("rejects unsupported CRS declarations at the FeatureCollection boundary", () => {
    expect(
      geoJsonFeatureCollectionSchema.safeParse({
        type: "FeatureCollection",
        features: [],
        crs: { type: "name", properties: { name: "EPSG:3857" } },
      }).success,
    ).toBe(false);
  });

  it("validates WGS84 bounding-box order and shared input conversions", () => {
    expect(geoJsonBoundingBoxSchema.safeParse([5, 58, 12, 62]).success).toBe(true);
    expect(geoJsonBoundingBoxSchema.safeParse([12, 58, 5, 62]).success).toBe(false);
    expect(geoJsonBoundingBoxSchema.safeParse([5, 62, 12, 58]).success).toBe(false);

    expect(coordinatesToGeoJsonPosition({ latitude: 59.91, longitude: 10.75 })).toEqual([
      10.75, 59.91,
    ]);
    expect(boundingBoxToGeoJsonBoundingBox({ south: 58, west: 5, north: 62, east: 12 })).toEqual([
      5, 58, 12, 62,
    ]);
  });
});
