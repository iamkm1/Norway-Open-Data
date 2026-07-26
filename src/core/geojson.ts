/**
 * Strict GeoJSON primitives shared by the focused geospatial providers.
 *
 * The SDK supports two-dimensional WGS84 GeoJSON only. A provider that exposes
 * another CRS must convert it server-side; silently treating projected
 * coordinates as longitude/latitude would return plausible-looking data in the
 * wrong place. Geometry collections and three-dimensional positions are outside
 * the deliberately small surface required by the supported providers.
 */
import { z } from "zod";

import { ResponseValidationError } from "./errors.js";
import type { BoundingBox, Coordinates } from "./geo.js";

/** A two-dimensional GeoJSON position in `[longitude, latitude]` order. */
export type GeoJsonPosition = [longitude: number, latitude: number];

/** A WGS84 GeoJSON bounding box in `[west, south, east, north]` order. */
export type GeoJsonBoundingBox = [west: number, south: number, east: number, north: number];

/** GeoJSON Point geometry. */
export type GeoJsonPoint = {
  type: "Point";
  coordinates: GeoJsonPosition;
  bbox?: GeoJsonBoundingBox;
};

/** GeoJSON MultiPoint geometry. */
export type GeoJsonMultiPoint = {
  type: "MultiPoint";
  coordinates: GeoJsonPosition[];
  bbox?: GeoJsonBoundingBox;
};

/** GeoJSON LineString geometry. */
export type GeoJsonLineString = {
  type: "LineString";
  coordinates: GeoJsonPosition[];
  bbox?: GeoJsonBoundingBox;
};

/** A closed GeoJSON linear ring. */
export type GeoJsonLinearRing = GeoJsonPosition[];

/** GeoJSON Polygon geometry. The first ring is the exterior; later rings are holes. */
export type GeoJsonPolygonGeometry = {
  type: "Polygon";
  coordinates: GeoJsonLinearRing[];
  bbox?: GeoJsonBoundingBox;
};

/** GeoJSON MultiPolygon geometry. */
export type GeoJsonMultiPolygon = {
  type: "MultiPolygon";
  coordinates: GeoJsonLinearRing[][];
  bbox?: GeoJsonBoundingBox;
};

/** Geometry kinds supported by the SDK's focused geospatial integrations. */
export type GeoJsonGeometry =
  | GeoJsonPoint
  | GeoJsonMultiPoint
  | GeoJsonLineString
  | GeoJsonPolygonGeometry
  | GeoJsonMultiPolygon;

/** GeoJSON feature identifier. */
export type GeoJsonFeatureId = string | number;

/** Dynamic provider attributes carried by a GeoJSON feature. */
export type GeoJsonFeatureProperties = Record<string, unknown>;

/** A GeoJSON feature, including the explicit null-geometry case. */
export type GeoJsonFeature<
  Properties extends GeoJsonFeatureProperties | null = GeoJsonFeatureProperties | null,
  Geometry extends GeoJsonGeometry | null = GeoJsonGeometry | null,
> = {
  type: "Feature";
  id?: GeoJsonFeatureId;
  geometry: Geometry;
  properties: Properties;
  bbox?: GeoJsonBoundingBox;
};

/** CRS declaration shapes emitted by the supported GeoJSON and ArcGIS services. */
export type GeoJsonCrsDeclaration =
  | string
  | number
  | {
      type: "name";
      properties: { name: string };
    }
  | {
      wkid?: number;
      latestWkid?: number;
    };

/** A validated WGS84 CRS while retaining the provider's original declaration. */
export type GeoJsonCrsMetadata = {
  identifier: "OGC:CRS84" | "EPSG:4326";
  uri:
    "http://www.opengis.net/def/crs/OGC/1.3/CRS84" | "http://www.opengis.net/def/crs/EPSG/0/4326";
  /** GeoJSON coordinates remain longitude first for either accepted identifier. */
  axisOrder: "longitude-latitude";
  /** False when RFC 7946's implicit WGS84 default was used. */
  declared: boolean;
  /** Provider-native declaration, present only when the provider supplied one. */
  original?: GeoJsonCrsDeclaration;
};

/** A GeoJSON FeatureCollection. Empty collections are valid results. */
export type GeoJsonFeatureCollection<Feature extends GeoJsonFeature = GeoJsonFeature> = {
  type: "FeatureCollection";
  features: Feature[];
  bbox?: GeoJsonBoundingBox;
  /** Legacy GeoJSON and ArcGIS services may still publish an explicit CRS. */
  crs?: GeoJsonCrsDeclaration | null;
};

const longitudeSchema = z.number().min(-180).max(180);
const latitudeSchema = z.number().min(-90).max(90);

/**
 * Strict two-dimensional WGS84 position.
 *
 * `z.number()` rejects `NaN` and both infinities. A tuple rejects extra
 * dimensions, so altitude cannot be mistaken for part of the supported shape.
 */
export const geoJsonPositionSchema = z.tuple([longitudeSchema, latitudeSchema]);

/** Strict WGS84 GeoJSON bounding box. */
export const geoJsonBoundingBoxSchema = z
  .tuple([longitudeSchema, latitudeSchema, longitudeSchema, latitudeSchema])
  .superRefine(([west, south, east, north], context) => {
    if (north <= south) {
      context.addIssue({
        code: "custom",
        message: "GeoJSON bbox north must be greater than south.",
        path: [3],
      });
    }
    if (east <= west) {
      context.addIssue({
        code: "custom",
        message:
          "GeoJSON bbox east must be greater than west; antimeridian-wrapping boxes are not supported.",
        path: [2],
      });
    }
  });

/** Closed, non-degenerate GeoJSON linear ring. */
export const geoJsonLinearRingSchema = z
  .array(geoJsonPositionSchema)
  .min(4)
  .superRefine((ring, context) => {
    const first = ring[0];
    const last = ring.at(-1);
    if (first === undefined || first[0] !== last?.[0] || first[1] !== last?.[1]) {
      context.addIssue({
        code: "custom",
        message: "A GeoJSON linear ring must repeat its first position at the end.",
      });
      return;
    }
    const distinctVertices = new Set(
      ring.slice(0, -1).map(([longitude, latitude]) => `${longitude},${latitude}`),
    );
    if (distinctVertices.size < 3) {
      context.addIssue({
        code: "custom",
        message: "A GeoJSON linear ring must contain at least three distinct vertices.",
      });
    }
  });

const geometryBboxShape = { bbox: geoJsonBoundingBoxSchema.optional() };

/** Strict GeoJSON Point schema. */
export const geoJsonPointSchema = z
  .object({
    type: z.literal("Point"),
    coordinates: geoJsonPositionSchema,
    ...geometryBboxShape,
  })
  .strict();

/** Strict GeoJSON MultiPoint schema. */
export const geoJsonMultiPointSchema = z
  .object({
    type: z.literal("MultiPoint"),
    coordinates: z.array(geoJsonPositionSchema).min(1),
    ...geometryBboxShape,
  })
  .strict();

/** Strict GeoJSON LineString schema. */
export const geoJsonLineStringSchema = z
  .object({
    type: z.literal("LineString"),
    coordinates: z.array(geoJsonPositionSchema).min(2),
    ...geometryBboxShape,
  })
  .strict();

/** Strict GeoJSON Polygon schema, including interior rings (holes). */
export const geoJsonPolygonSchema = z
  .object({
    type: z.literal("Polygon"),
    coordinates: z.array(geoJsonLinearRingSchema).min(1),
    ...geometryBboxShape,
  })
  .strict();

/** Strict GeoJSON MultiPolygon schema. */
export const geoJsonMultiPolygonSchema = z
  .object({
    type: z.literal("MultiPolygon"),
    coordinates: z.array(z.array(geoJsonLinearRingSchema).min(1)).min(1),
    ...geometryBboxShape,
  })
  .strict();

/** Strict union of the geometry kinds supported by this SDK. */
export const geoJsonGeometrySchema = z.discriminatedUnion("type", [
  geoJsonPointSchema,
  geoJsonMultiPointSchema,
  geoJsonLineStringSchema,
  geoJsonPolygonSchema,
  geoJsonMultiPolygonSchema,
]);

/** Supported geometry or the explicit GeoJSON null-geometry value. */
export const nullableGeoJsonGeometrySchema = geoJsonGeometrySchema.nullable();

/** Strict feature identifier schema. */
export const geoJsonFeatureIdSchema = z.union([
  z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0, "Feature IDs may not be blank."),
  z.number(),
]);

/**
 * Strict GeoJSON Feature schema.
 *
 * Properties are intentionally dynamic because feature attributes are
 * layer-specific. Provider adapters should extend this object with a stricter
 * property schema for fields they consume.
 */
export const geoJsonFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    id: geoJsonFeatureIdSchema.optional(),
    geometry: nullableGeoJsonGeometrySchema,
    properties: z.record(z.string(), z.unknown()).nullable(),
    bbox: geoJsonBoundingBoxSchema.optional(),
  })
  .strict();

const namedCrsSchema = z
  .object({
    type: z.literal("name"),
    properties: z.object({ name: z.string().trim().min(1) }).strict(),
  })
  .strict();

const arcGisSpatialReferenceSchema = z
  .object({
    wkid: z.number().int().positive().optional(),
    latestWkid: z.number().int().positive().optional(),
  })
  .strict()
  .refine(
    (value) => value.wkid !== undefined || value.latestWkid !== undefined,
    "An ArcGIS spatial reference must include wkid or latestWkid.",
  );

const rawCrsMetadataSchema = z.union([
  z.string().trim().min(1),
  z.number().int().positive(),
  namedCrsSchema,
  arcGisSpatialReferenceSchema,
]);

function identifierFromCrs(value: GeoJsonCrsDeclaration): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  if ("type" in value) return value.properties.name;
  const identifiers = [value.wkid, value.latestWkid].filter(
    (identifier): identifier is number => identifier !== undefined,
  );
  if (identifiers.length === 0 || identifiers.some((identifier) => identifier !== 4326)) {
    return undefined;
  }
  return 4326;
}

function supportedIdentifier(
  value: string | number | undefined,
): GeoJsonCrsMetadata["identifier"] | undefined {
  if (value === 4326) return "EPSG:4326";
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "crs84" ||
    normalized === "ogc:crs84" ||
    normalized === "urn:ogc:def:crs:ogc:1.3:crs84" ||
    normalized === "http://www.opengis.net/def/crs/ogc/1.3/crs84" ||
    normalized === "https://www.opengis.net/def/crs/ogc/1.3/crs84"
  ) {
    return "OGC:CRS84";
  }
  if (
    normalized === "4326" ||
    normalized === "epsg:4326" ||
    /^urn:ogc:def:crs:epsg:[^:]*:4326$/u.test(normalized) ||
    normalized === "http://www.opengis.net/def/crs/epsg/0/4326" ||
    normalized === "https://www.opengis.net/def/crs/epsg/0/4326"
  ) {
    return "EPSG:4326";
  }
  return undefined;
}

/** CRS declaration schema restricted to the WGS84 forms the SDK can interpret. */
export const geoJsonCrsDeclarationSchema = rawCrsMetadataSchema.superRefine((value, context) => {
  if (supportedIdentifier(identifierFromCrs(value)) === undefined) {
    context.addIssue({
      code: "custom",
      message: "Unsupported CRS. Only OGC:CRS84 and EPSG:4326 are supported.",
    });
  }
});

/** Strict GeoJSON FeatureCollection schema with optional supported CRS metadata. */
export const geoJsonFeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(geoJsonFeatureSchema),
    bbox: geoJsonBoundingBoxSchema.optional(),
    crs: geoJsonCrsDeclarationSchema.nullable().optional(),
  })
  .strict();

/**
 * Resolves a provider CRS declaration without reprojecting coordinates.
 *
 * An absent or null declaration follows RFC 7946 and is treated as implicit
 * OGC CRS84. Explicit metadata is retained verbatim in `original`.
 */
export function resolveGeoJsonCrs(value: unknown, provider?: string): GeoJsonCrsMetadata {
  if (value === undefined || value === null) {
    return {
      identifier: "OGC:CRS84",
      uri: "http://www.opengis.net/def/crs/OGC/1.3/CRS84",
      axisOrder: "longitude-latitude",
      declared: false,
    };
  }

  const parsed = geoJsonCrsDeclarationSchema.safeParse(value);
  if (!parsed.success) {
    throw new ResponseValidationError(
      "A geospatial provider returned malformed or unsupported CRS metadata. Only WGS84 GeoJSON is supported.",
      {
        ...(provider === undefined ? {} : { provider }),
        cause: parsed.error,
      },
    );
  }
  const identifier = supportedIdentifier(identifierFromCrs(parsed.data));
  // The schema refinement above proves this, but retain a defensive guard so a
  // later schema change cannot silently introduce a CRS this function ignores.
  if (identifier === undefined) {
    throw new ResponseValidationError(
      "A geospatial provider returned an unsupported CRS. Only WGS84 GeoJSON is supported.",
      provider === undefined ? {} : { provider },
    );
  }
  return {
    identifier,
    uri:
      identifier === "OGC:CRS84"
        ? "http://www.opengis.net/def/crs/OGC/1.3/CRS84"
        : "http://www.opengis.net/def/crs/EPSG/0/4326",
    axisOrder: "longitude-latitude",
    declared: true,
    original: parsed.data,
  };
}

/** Converts the shared point input to GeoJSON longitude/latitude order. */
export function coordinatesToGeoJsonPosition(coordinates: Coordinates): GeoJsonPosition {
  return [coordinates.longitude, coordinates.latitude];
}

/** Converts the shared bounding-box input to GeoJSON bbox order. */
export function boundingBoxToGeoJsonBoundingBox(boundingBox: BoundingBox): GeoJsonBoundingBox {
  return [boundingBox.west, boundingBox.south, boundingBox.east, boundingBox.north];
}
