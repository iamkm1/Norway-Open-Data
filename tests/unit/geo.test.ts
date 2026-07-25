import { describe, expect, it } from "vitest";

import { InputValidationError } from "../../src/core/errors.js";
import {
  boundingBoxSchema,
  boundingBoxToPolygon,
  coordinatesSchema,
  parseBoundingBox,
  parseCoordinates,
} from "../../src/core/geo.js";

describe("shared coordinates", () => {
  it("accepts the full valid range including the poles and meridians", () => {
    for (const point of [
      { latitude: 0, longitude: 0 },
      { latitude: 90, longitude: 180 },
      { latitude: -90, longitude: -180 },
      { latitude: 59.9139, longitude: 10.7522 },
    ]) {
      expect(coordinatesSchema.safeParse(point).success, JSON.stringify(point)).toBe(true);
    }
  });

  it.each([
    { latitude: 90.1, longitude: 0 },
    { latitude: -90.1, longitude: 0 },
    { latitude: 0, longitude: 180.1 },
    { latitude: 0, longitude: -180.1 },
  ])("rejects out-of-range %o", (point) => {
    expect(coordinatesSchema.safeParse(point).success).toBe(false);
  });

  it.each([
    { latitude: Number.NaN, longitude: 0 },
    { latitude: 0, longitude: Number.NaN },
    { latitude: Number.POSITIVE_INFINITY, longitude: 0 },
    { latitude: Number.NEGATIVE_INFINITY, longitude: 0 },
    { latitude: 0, longitude: Number.POSITIVE_INFINITY },
  ])("rejects the non-finite value in %o", (point) => {
    expect(coordinatesSchema.safeParse(point).success).toBe(false);
  });

  it("names the provider when raising for invalid input", () => {
    expect(() => parseCoordinates({ latitude: 91, longitude: 0 }, "test")).toThrow(
      InputValidationError,
    );
    try {
      parseCoordinates({ latitude: 91, longitude: 0 }, "test");
    } catch (error) {
      expect((error as InputValidationError).provider).toBe("test");
    }
    expect(parseCoordinates({ latitude: 60, longitude: 5 }, "test")).toEqual({
      latitude: 60,
      longitude: 5,
    });
  });
});

describe("shared bounding box", () => {
  const valid = { south: 58.8, west: 4.5, north: 60, east: 6.5 };

  it("accepts a correctly ordered box", () => {
    expect(boundingBoxSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects a box whose north edge is not above its south edge", () => {
    expect(boundingBoxSchema.safeParse({ ...valid, north: 58.8 }).success).toBe(false);
    expect(boundingBoxSchema.safeParse({ ...valid, north: 50 }).success).toBe(false);
  });

  it("rejects a box that crosses the antimeridian, with a message saying so", () => {
    // west greater than east is the conventional way to express a box wrapping
    // 180 degrees. It is refused rather than silently answered with nothing.
    const result = boundingBoxSchema.safeParse({ south: 58, west: 179, north: 60, east: -179 });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("antimeridian");
  });

  it("rejects a zero-width or zero-height box", () => {
    expect(boundingBoxSchema.safeParse({ ...valid, east: valid.west }).success).toBe(false);
    expect(boundingBoxSchema.safeParse({ ...valid, north: valid.south }).success).toBe(false);
  });

  it.each([
    { ...{ south: 58.8, west: 4.5, north: 60, east: 6.5 }, south: -91 },
    { ...{ south: 58.8, west: 4.5, north: 60, east: 6.5 }, north: 91 },
    { ...{ south: 58.8, west: 4.5, north: 60, east: 6.5 }, west: -181 },
    { ...{ south: 58.8, west: 4.5, north: 60, east: 6.5 }, east: 181 },
  ])("rejects the out-of-range edge in %o", (box) => {
    expect(boundingBoxSchema.safeParse(box).success).toBe(false);
  });

  it.each(["south", "west", "north", "east"] as const)("rejects a non-finite %s", (edge) => {
    expect(boundingBoxSchema.safeParse({ ...valid, [edge]: Number.NaN }).success).toBe(false);
    expect(
      boundingBoxSchema.safeParse({ ...valid, [edge]: Number.POSITIVE_INFINITY }).success,
    ).toBe(false);
  });

  it("names the provider when raising for an invalid box", () => {
    try {
      parseBoundingBox({ ...valid, north: 0 }, "test");
      expect.unreachable("Expected an InputValidationError.");
    } catch (error) {
      expect(error).toBeInstanceOf(InputValidationError);
      expect((error as InputValidationError).provider).toBe("test");
    }
  });

  it("converts a box to a closed GeoJSON ring in longitude-latitude order", () => {
    const polygon = boundingBoxToPolygon(valid);
    expect(polygon.type).toBe("Polygon");
    const ring = polygon.coordinates[0];
    expect(ring).toEqual([
      [4.5, 58.8],
      [6.5, 58.8],
      [6.5, 60],
      [4.5, 60],
      [4.5, 58.8],
    ]);
    // GeoJSON requires the ring to close, and the provider requires at least four
    // positions.
    expect(ring?.at(0)).toEqual(ring?.at(-1));
    expect(ring?.length).toBeGreaterThanOrEqual(4);
    // Longitude first: a swap here would send every filter to the wrong hemisphere.
    expect(ring?.[0]?.[0]).toBe(valid.west);
    expect(ring?.[0]?.[1]).toBe(valid.south);
  });
});
