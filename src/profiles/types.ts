import type { OpenDataSource } from "../core/provider.js";
import type { Coordinates } from "../core/geo.js";
import type { FeaturePagePagination } from "../core/feature-page.js";
import type { AisTrack, AisTrackPoint, Mmsi } from "../providers/barentswatch-ais/types.js";
import type { Company } from "../providers/brreg/types.js";
import type { FishingVessel } from "../providers/fiskeridir/types.js";
import type { NorwegianAddress, PlaceName } from "../providers/kartverket/types.js";
import type { WeatherTimeseriesEntry } from "../providers/met/types.js";
import type {
  InterventionFreeAreaFeature,
  NatureTypeFeature,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
} from "../providers/naturbase/types.js";
import type { LandResourceFeature } from "../providers/nibio/types.js";
import type { HazardWarning } from "../providers/nve/types.js";
import type { RoadNetworkSegment } from "../providers/vegvesen/types.js";

/** Provider operation that contributed to, or was intentionally omitted from, a profile. */
export type ProfileComponentOperation =
  | "companies.get"
  | "companies.search"
  | "addresses.search"
  | "statistics.getTableMetadata"
  | "statistics.query"
  | "health.query"
  | "weather.current"
  | "hazards.getFloodWarnings"
  | "hazards.getAvalancheWarnings"
  | "hazards.getLandslideWarnings"
  | "roads.getRoadNetwork"
  | "ais.getVesselSnapshot"
  | "ais.getTrackLast24Hours"
  | "fisheries.searchVessels"
  | "places.nearby"
  | "environment.getProtectedAreasAt"
  | "environment.getProposedProtectedAreasAt"
  | "environment.getNatureTypesAt"
  | "environment.getInterventionFreeAreasAt"
  | "land.getLandResourcesAt";

/** Logical profile section populated by a component operation. */
export type ProfileComponentSection =
  | "company"
  | "address"
  | "municipality"
  | "population"
  | "health"
  | "companies"
  | "weather"
  | "hazards"
  | "roads"
  | "ais"
  | "registration"
  | "place"
  | "protected-areas"
  | "proposed-protected-areas"
  | "nature-types"
  | "intervention-free-areas"
  | "land-resources";

/**
 * Why an optional profile component is missing.
 *
 * `provider-error` means the operation was attempted but its provider failed at
 * request time. `not-found` and `not-covered` mean the provider answered
 * successfully and had nothing: the first that the identifier matched no record,
 * the second that the subject falls outside what the provider publishes at all.
 * The remaining reasons mean the operation was deliberately never requested --
 * `not-configured` because the provider needs credentials this client does not
 * have, and `not-applicable` because a prerequisite from an earlier component was
 * absent.
 *
 * New reasons may be added in a minor release. Treat an unrecognized value as
 * "absent for a reason this code does not model" rather than switching
 * exhaustively on it.
 */
export type ProfileOmissionReason =
  | "not-configured"
  | "missing-coordinate"
  | "not-applicable"
  | "provider-error"
  | "not-found"
  | "not-covered";

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

/** Population totals aggregated by the SDK from SSB's per-sex, per-age rows. */
export type MunicipalityPopulation = {
  /** Resident count for `year`, summed across sexes and single ages. */
  total: number;
  year: string;
  previousTotal?: number;
  previousYear?: string;
  /** `total` minus `previousTotal`. */
  change?: number;
};

/** FHI life expectancy at birth over a seven-year rolling window. */
export type MunicipalityLifeExpectancy = {
  /** Expected years, or null when FHI suppresses the value. */
  years: number | null;
  /** Provider period code, e.g. `2018_2024`. */
  period: string;
  /** FHI measure code for the observation. */
  measure: string;
  /** FHI suppression flag, preserved when `years` is not published. */
  flag?: string;
  /** The provider's explanation for `flag`. */
  flagMeaning?: string;
};

/**
 * One municipality answered from several agencies at once.
 *
 * Optional sections degrade to `provider-error` components when their provider
 * fails; `hazards` may then be incomplete and is never an all-clear.
 */
export type MunicipalityProfile = {
  /** The resolved municipality; `countyCode` is the code's leading two digits. */
  municipality: { code: string; name: string; countyCode: string };
  /** SSB population totals for the two newest published years. */
  population?: MunicipalityPopulation;
  /** FHI life expectancy at birth, with suppression flags preserved. */
  lifeExpectancy?: MunicipalityLifeExpectancy;
  /** Organizations registered in the municipality according to Brønnøysundregistrene. */
  companies?: { registered: number };
  /**
   * Current NVE warnings whose explicit administrative areas match the
   * municipality. An empty array is not an all-clear; use the `hazards`
   * namespace and official Varsom/NVE services for safety decisions.
   */
  hazards: HazardWarning[];
  /** Exact administrative evidence for each warning in `hazards`. */
  hazardMatches?: AddressHazardMatch[];
  /** Provenance and availability for every component operation. */
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

/** Identifies the vessel a {@link VesselProfile} is about. */
export type VesselProfileParameters = {
  /** Maritime Mobile Service Identity, 1-9 digits. */
  mmsi: Mmsi;
};

/**
 * What AIS could say about a vessel.
 *
 * `status` is the important field. `available` means BarentsWatch returned at
 * least one position in the last 24 hours. `no-recent-data` means it returned
 * none, which is the normal answer for a vessel below the published size
 * thresholds, outside the covered sea area, with its transponder off, or simply
 * moored somewhere the receivers do not reach. It is never evidence that the MMSI
 * is unassigned or the vessel does not exist.
 */
export type VesselAisSummary = {
  status: "available" | "no-recent-data";
  /**
   * Most recent recorded point, by message time.
   *
   * Kept in the provider's own track shape rather than converted to an AIS
   * position report, because the historic endpoint merges position and identity
   * fields and transmits no AIS message type.
   */
  latestPosition?: AisTrackPoint;
  /** Every position the provider held for the window, in its own order. */
  track?: AisTrack;
  /** Identity from the vessel's latest AIS static broadcast, when one was received. */
  identity?: {
    name?: string;
    callSign?: string;
    imoNumber?: string;
    /** Raw AIS ship-type code; not normalized to text. */
    shipType?: number;
  };
};

/**
 * One vessel answered from several providers at once.
 *
 * Every section other than `mmsi` and `ais` is optional and degrades on its own:
 * a provider that fails, is not configured, or has no matching record leaves a
 * component entry explaining which of those happened and does not affect the
 * sections that succeeded.
 */
export type VesselProfile = {
  /** The MMSI that was asked for. */
  mmsi: Mmsi;
  /** What AIS could say, including when it could say nothing. */
  ais: VesselAisSummary;
  /**
   * The matching entry in the Norwegian fishing-vessel register, when the vessel
   * is a registered fishing vessel and AIS supplied a call sign to match on.
   *
   * Most vessels are not fishing vessels, so absence here is ordinary. Owner
   * details for natural persons are not included; see
   * {@link FishingVesselOwner}.
   */
  registration?: FishingVessel;
  /** Conditions at the latest AIS position. Omitted without MET identification. */
  weather?: WeatherTimeseriesEntry;
  /** Nearest official place name to the latest AIS position. */
  nearestPlace?: PlaceName;
  /** Provenance and availability for every component operation. */
  components?: ProfileComponent[];
};

/** Parameters for a bounded, cross-provider nature lookup at one WGS84 point. */
export type NatureAtLocationParameters = Coordinates & {
  /**
   * Maximum features requested from each environmental or land dataset.
   * Defaults to 100 and is capped by each provider client.
   */
  limit?: number;
};

/** Municipality inferred from the nearest official Kartverket place name. */
export type NatureProfileMunicipality = {
  code?: string;
  name?: string;
  countyCode?: string;
  countyName?: string;
};

/** Pagination metadata retained for each bounded geospatial component. */
export type NatureProfilePagination = {
  protectedAreas?: FeaturePagePagination;
  proposedProtectedAreas?: FeaturePagePagination;
  natureTypes?: FeaturePagePagination;
  interventionFreeAreas?: FeaturePagePagination;
  landResources?: FeaturePagePagination;
};

/**
 * Nature and land-resource information composed at one location.
 *
 * Every dataset is queried independently. A missing section means its provider
 * failed; `components` and `warnings` explain which operation was affected.
 */
export type NatureAtLocationProfile = {
  /** Exact WGS84 coordinate supplied by the caller. */
  location: Coordinates;
  /** Administrative context inferred from `nearestPlace`, when published. */
  municipality?: NatureProfileMunicipality;
  /** Nearest official Kartverket place name, when one was returned. */
  nearestPlace?: PlaceName;
  protectedAreas?: ProtectedAreaFeature[];
  proposedProtectedAreas?: ProposedProtectedAreaFeature[];
  natureTypes?: NatureTypeFeature[];
  interventionFreeAreas?: InterventionFreeAreaFeature[];
  landResources?: LandResourceFeature[];
  /** Dataset-specific safety and truncation metadata. */
  pagination: NatureProfilePagination;
  /** Sanitized provider failures and bounded-result truncation notices. */
  warnings: string[];
  /** Provenance and availability for every component operation. */
  components: ProfileComponent[];
};
