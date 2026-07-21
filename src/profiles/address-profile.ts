import type { HazardWarning } from "../providers/nve/types.js";

/** Metres used for the road lookup box drawn around a matched address. */
export const ROAD_RADIUS_METRES = 250;

const METRES_PER_DEGREE_LATITUDE = 111_320;

/**
 * Builds an NVDB bounding box around a coordinate.
 *
 * Returns `[minLongitude, minLatitude, maxLongitude, maxLatitude]`.
 *
 * @internal
 */
export function boundingBoxAround(
  latitude: number,
  longitude: number,
  metres = ROAD_RADIUS_METRES,
): [number, number, number, number] {
  const deltaLatitude = metres / METRES_PER_DEGREE_LATITUDE;
  const cosine = Math.cos((latitude * Math.PI) / 180);
  // Guard against the poles, where a metre spans an unbounded longitude range.
  const deltaLongitude = metres / (METRES_PER_DEGREE_LATITUDE * Math.max(cosine, 0.01));
  return [
    Math.max(longitude - deltaLongitude, -180),
    Math.max(latitude - deltaLatitude, -90),
    Math.min(longitude + deltaLongitude, 180),
    Math.min(latitude + deltaLatitude, 90),
  ];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Best-effort match between an NVE warning region and an address area.
 *
 * NVE publishes hydrological and avalanche regions that do not map one-to-one
 * onto municipalities, so this compares names in both directions and treats a
 * warning without regions as non-matching rather than guessing.
 *
 * @internal
 */
export function warningMatchesArea(
  warning: HazardWarning,
  areas: ReadonlyArray<string | undefined>,
): boolean {
  const candidates = areas.flatMap((area) =>
    area === undefined || area.trim().length === 0 ? [] : [normalize(area)],
  );
  if (candidates.length === 0) return false;
  return (warning.regions ?? []).some((region) => {
    const normalizedRegion = normalize(region);
    if (normalizedRegion.length === 0) return false;
    return candidates.some(
      (candidate) =>
        normalizedRegion === candidate ||
        normalizedRegion.includes(candidate) ||
        candidate.includes(normalizedRegion),
    );
  });
}
