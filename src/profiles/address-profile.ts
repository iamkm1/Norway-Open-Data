import type { HazardWarning } from "../providers/nve/types.js";

/** Requested half-size used to derive the road lookup box around a matched address. */
export const ROAD_BOX_HALF_SIZE_METRES = 250;

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
  metres = ROAD_BOX_HALF_SIZE_METRES,
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

/** Normalizes an administrative-area name for exact comparison. @internal */
export function normalizeName(value: string): string {
  return value.trim().replace(/\s+/gu, " ").normalize("NFC").toLocaleLowerCase("nb-NO");
}

function normalizeCode(value: string, width: 2 | 4): string {
  const code = value.trim();
  return /^\d+$/.test(code) ? code.padStart(width, "0") : code;
}

/** Official administrative identifiers and names for an address. */
export type WarningMatchArea = {
  municipalityCode?: string;
  municipalityName?: string;
  countyCode?: string;
  countyName?: string;
};

/** The exact administrative field through which a warning matched an address. */
export type WarningAreaMatchBasis =
  "municipality-code" | "county-code" | "municipality-name" | "county-name";

/** Auditable detail for an automatic address-to-warning match. */
export type WarningAreaMatch = {
  basis: WarningAreaMatchBasis;
  addressValue: string;
  warningValue: string;
};

type AdministrativeArea = NonNullable<HazardWarning["municipalities"]>[number];

function matchCode(
  areas: readonly AdministrativeArea[],
  addressCode: string | undefined,
  width: 2 | 4,
  basis: Extract<WarningAreaMatchBasis, `${string}-code`>,
): WarningAreaMatch | undefined {
  if (addressCode === undefined || addressCode.trim().length === 0) return undefined;
  const normalizedAddressCode = normalizeCode(addressCode, width);
  const match = areas.find(
    (area) => area.code !== undefined && normalizeCode(area.code, width) === normalizedAddressCode,
  );
  return match?.code === undefined
    ? undefined
    : { basis, addressValue: addressCode, warningValue: match.code };
}

function matchName(
  areas: readonly AdministrativeArea[],
  addressCode: string | undefined,
  addressName: string | undefined,
  width: 2 | 4,
  basis: Extract<WarningAreaMatchBasis, `${string}-name`>,
): WarningAreaMatch | undefined {
  if (addressName === undefined || addressName.trim().length === 0) return undefined;
  const normalizedAddressName = normalizeName(addressName);
  const normalizedAddressCode =
    addressCode === undefined || addressCode.trim().length === 0
      ? undefined
      : normalizeCode(addressCode, width);
  const match = areas.find((area) => {
    if (normalizeName(area.name) !== normalizedAddressName) return false;
    // A contradictory pair of official codes must not be overridden by names.
    return (
      normalizedAddressCode === undefined ||
      area.code === undefined ||
      normalizeCode(area.code, width) === normalizedAddressCode
    );
  });
  return match === undefined
    ? undefined
    : { basis, addressValue: addressName, warningValue: match.name };
}

function asStructuredArea(
  area: WarningMatchArea | ReadonlyArray<string | undefined>,
): WarningMatchArea {
  // Positional names keep this internal helper source-compatible while callers
  // migrate to the structured form needed for code-first matching.
  return isLegacyArea(area) ? { municipalityName: area[0], countyName: area[1] } : area;
}

function isLegacyArea(
  area: WarningMatchArea | ReadonlyArray<string | undefined>,
): area is ReadonlyArray<string | undefined> {
  return Array.isArray(area);
}

/**
 * Matches an NVE warning to an address through structured administrative data.
 *
 * Official codes take priority. Exact, case-insensitive NFC-normalized names
 * are used only as a fallback. A county is considered only when the warning
 * publishes no municipalities, because NVE can include a parent county as
 * context for a municipality-scoped warning. Forecast-region names and the
 * compatibility `regions` field are deliberately excluded.
 *
 * @internal
 */
export function warningMatchesArea(
  warning: HazardWarning,
  area: WarningMatchArea | ReadonlyArray<string | undefined>,
): WarningAreaMatch | undefined {
  const address = asStructuredArea(area);
  const municipalities = warning.municipalities ?? [];
  const counties = warning.counties ?? [];

  const municipalityMatch =
    matchCode(municipalities, address.municipalityCode, 4, "municipality-code") ??
    matchName(
      municipalities,
      address.municipalityCode,
      address.municipalityName,
      4,
      "municipality-name",
    );

  // NVE may include a parent county alongside a municipality-scoped warning.
  // In that case a failed municipality match must not broaden the warning to
  // every address in the county.
  if (municipalities.length > 0) return municipalityMatch;

  return (
    matchCode(counties, address.countyCode, 2, "county-code") ??
    matchName(counties, address.countyCode, address.countyName, 2, "county-name")
  );
}
