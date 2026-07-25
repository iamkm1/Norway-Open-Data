/**
 * Shared geographic primitives.
 *
 * Several providers accept a point or a rectangular window, each spelling it
 * differently: MET Norway takes `lat`/`lon` query values, NVDB takes a
 * comma-joined `[minLon, minLat, maxLon, maxLat]` string, and BarentsWatch takes
 * a closed GeoJSON polygon ring. The caller-facing shapes and their validation
 * live here once so a coordinate rejected by one provider is rejected by all of
 * them, with the same message.
 */
import { z } from "zod";

import { InputValidationError } from "./errors.js";

/** A WGS84 geographic point in decimal degrees. */
export type Coordinates = {
  /** Degrees north of the equator, -90 to 90. */
  latitude: number;
  /** Degrees east of the prime meridian, -180 to 180. */
  longitude: number;
};

/**
 * A WGS84 axis-aligned rectangle in decimal degrees.
 *
 * `north` must be greater than `south` and `east` greater than `west`. A box
 * that wraps the antimeridian (`west` greater than `east`) is rejected; see
 * {@link boundingBoxSchema} for why.
 */
export type BoundingBox = {
  /** Southern latitude edge. */
  south: number;
  /** Western longitude edge. */
  west: number;
  /** Northern latitude edge. */
  north: number;
  /** Eastern longitude edge. */
  east: number;
};

/**
 * Zod schema for a geographic point.
 *
 * `z.number()` already rejects `NaN`, `Infinity` and `-Infinity`, so a
 * non-finite coordinate never reaches a provider.
 */
export const coordinatesSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/**
 * Zod schema for a rectangular window.
 *
 * Two orderings are enforced rather than silently repaired:
 *
 * - `north` above `south`, because swapping them describes a different, empty
 *   window that most providers answer with an empty result instead of an error.
 * - `east` above `west`. A box with `west` greater than `east` is the usual way
 *   to express one that crosses the antimeridian at 180 degrees. Supporting it
 *   would mean splitting every request into two windows and merging the
 *   results, which changes result ordering and pagination semantics per
 *   provider. Every source in this SDK publishes Norwegian data, which is
 *   entirely east of the prime meridian and nowhere near the antimeridian, so
 *   such a box is far more likely to be swapped arguments than a real
 *   intention. It is refused with an explicit message rather than quietly
 *   returning nothing.
 *
 * A zero-width or zero-height box is refused for the same reason: it cannot
 * contain anything, so accepting it would turn a caller mistake into an empty
 * result that looks like a real answer.
 */
export const boundingBoxSchema = z
  .object({
    south: z.number().min(-90).max(90),
    west: z.number().min(-180).max(180),
    north: z.number().min(-90).max(90),
    east: z.number().min(-180).max(180),
  })
  .refine((box) => box.north > box.south, {
    message: "north must be greater than south.",
    path: ["north"],
  })
  .refine((box) => box.east > box.west, {
    message:
      "east must be greater than west. Boxes that cross the antimeridian are not supported; no provider in this SDK publishes data there.",
    path: ["east"],
  });

/**
 * Validates a point, raising {@link InputValidationError} with the provider
 * named when it is out of range.
 */
export function parseCoordinates(value: Coordinates, provider: string): Coordinates {
  const parsed = coordinatesSchema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError("Invalid WGS84 coordinates.", {
      provider,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/**
 * Validates a rectangular window, raising {@link InputValidationError} with the
 * provider named when it is out of range or wrongly ordered.
 */
export function parseBoundingBox(value: BoundingBox, provider: string): BoundingBox {
  const parsed = boundingBoxSchema.safeParse(value);
  if (!parsed.success) {
    throw new InputValidationError("Invalid WGS84 bounding box.", {
      provider,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

/** A closed GeoJSON linear ring in `[longitude, latitude]` order. */
export type GeoJsonRing = [number, number][];

/** A GeoJSON `Polygon` geometry with a single exterior ring. */
export type GeoJsonPolygon = {
  type: "Polygon";
  /** Exterior ring first, in `[longitude, latitude]` order. */
  coordinates: GeoJsonRing[];
};

/**
 * Converts a validated box into the closed, counter-clockwise GeoJSON polygon
 * that BarentsWatch expects.
 *
 * GeoJSON positions are `[longitude, latitude]`, the reverse of the field order
 * used in {@link BoundingBox}, and the ring has to repeat its first position to
 * close. Both are easy to get wrong per call site, so the conversion lives here.
 */
export function boundingBoxToPolygon(box: BoundingBox): GeoJsonPolygon {
  return {
    type: "Polygon",
    coordinates: [
      [
        [box.west, box.south],
        [box.east, box.south],
        [box.east, box.north],
        [box.west, box.north],
        [box.west, box.south],
      ],
    ],
  };
}
