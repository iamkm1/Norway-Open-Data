import type { OpenDataSource } from "../core/metadata.js";
import type { Company } from "../providers/brreg/types.js";
import type { NorwegianAddress } from "../providers/kartverket/types.js";
import type { WeatherTimeseriesEntry } from "../providers/met/types.js";
import type { HazardWarning } from "../providers/nve/types.js";
import type { RoadNetworkSegment } from "../providers/vegvesen/types.js";

/** Provider operation that contributed to, or was intentionally omitted from, a profile. */
export type ProfileComponentOperation =
  | "companies.get"
  | "addresses.search"
  | "weather.current"
  | "hazards.getFloodWarnings"
  | "hazards.getAvalancheWarnings"
  | "hazards.getLandslideWarnings"
  | "roads.getRoadNetwork";

/** Logical profile section populated by a component operation. */
export type ProfileComponentSection = "company" | "address" | "weather" | "hazards" | "roads";

/**
 * Why an optional profile component is missing. `provider-error` means the
 * operation was attempted but its provider failed at request time; the other
 * reasons mean the operation was deliberately never requested.
 */
export type ProfileOmissionReason =
  "not-configured" | "missing-coordinate" | "not-applicable" | "provider-error";

/** Per-operation provenance and availability for a composed profile. */
export type ProfileComponent =
  | {
      operation: ProfileComponentOperation;
      section: ProfileComponentSection;
      status: "available";
      source: OpenDataSource;
      /**
       * When this SDK operation resolved, including cache hits. This is not
       * the time the provider payload was originally fetched upstream.
       */
      retrievedAt: string;
      cached: boolean;
    }
  | {
      operation: ProfileComponentOperation;
      section: ProfileComponentSection;
      status: "omitted";
      source: OpenDataSource;
      reason: ProfileOmissionReason;
      /** Sanitized failure summary, present only when `reason` is `provider-error`. */
      error?: { name: string; message: string };
    };

/** Administrative evidence used to attach one NVE warning to an address profile. */
export type AddressHazardMatch = {
  warning: HazardWarning;
  matchBasis: "municipality-code" | "municipality-name" | "county-code" | "county-name";
  addressArea: { code?: string; name?: string };
  warningArea: { code?: string; name?: string };
};

/** Exact NVDB search window used by an address profile. */
export type AddressRoadSearch = {
  shape: "bounding-box";
  /** Requested half-size used to derive the box, not a circular distance guarantee. */
  halfSizeMetres: number;
  /** WGS84 `[minLongitude, minLatitude, maxLongitude, maxLatitude]`. */
  boundingBox: [number, number, number, number];
  requestedPageSize: number;
  /** True when NVDB reported another page after the returned candidates. */
  truncated: boolean;
};

/** Combined company information with an optional official coordinate match. */
export type CompanyProfile = {
  company: Company;
  location?: {
    address: NorwegianAddress;
    matchConfidence: "exact" | "high" | "possible";
  };
  /** Provenance and availability for each component operation. */
  components?: ProfileComponent[];
};

/**
 * A location answered from several providers at once.
 *
 * Enrichment degrades gracefully: sections whose provider needs configuration
 * the client does not have are omitted rather than failing the whole call.
 */
export type AddressProfile = {
  /** The best official Kartverket match for the queried address. */
  address: NorwegianAddress;
  /** Conditions at the matched coordinate. Omitted without MET identification. */
  weather?: WeatherTimeseriesEntry;
  /**
   * Current NVE warnings whose explicit municipality or county data exactly
   * matches the address. An empty array is not an all-clear. Use the `hazards`
   * namespace and the complete official Varsom/NVE warning for any
   * safety-related decision.
   */
  hazards: HazardWarning[];
  /** Exact administrative evidence for each warning in `hazards`. */
  hazardMatches?: AddressHazardMatch[];
  /**
   * First-page NVDB candidates intersecting `roadSearch.boundingBox`.
   * Omitted without `applicationName` or address coordinates.
   */
  roads?: RoadNetworkSegment[];
  /** Search bounds and truncation information for `roads`. */
  roadSearch?: AddressRoadSearch;
  /** Provenance and availability for every component operation. */
  components?: ProfileComponent[];
};
