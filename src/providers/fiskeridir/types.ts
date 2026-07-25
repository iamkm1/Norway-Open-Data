/**
 * An owner recorded against a registered fishing vessel.
 *
 * The register publishes an owner's name, postal code and town for private
 * individuals as well as companies. This SDK surfaces those details only for
 * `company` owners. For a `person` owner the entry is kept -- so the ownership
 * structure and owner count stay visible and nothing is silently collapsed -- but
 * the identifying fields are not carried into SDK output, including
 * `{ includeRaw: true }`. Personal data is outside this SDK's supported scope even
 * where a public register lawfully publishes it, and a redistributed copy of it is
 * not what the vessel register is useful for here.
 *
 * Callers who genuinely need the natural-person fields should read them from
 * Fiskeridirektoratet directly under that agency's own terms.
 */
export type FishingVesselOwner =
  | {
      /** A legal entity, whose details are published in full. */
      entityType: "company";
      /** Norwegian organization number, when the register holds one. */
      organizationNumber?: string;
      name?: string;
      postalCode?: string;
      city?: string;
    }
  | {
      /**
       * A natural person. Name, postal code and town are deliberately absent; see
       * {@link FishingVesselOwner}.
       */
      entityType: "person";
    };

/**
 * A vessel in the Norwegian fishing-vessel register.
 *
 * Sizes are metres, `tonnage` is gross tonnage under the rule named by
 * `tonnageType`, and `enginePower` is horsepower, all as the register publishes
 * them.
 */
export type FishingVessel = {
  /** Register identifier, accepted by {@link FisheriesVesselLookup}. */
  id: string;
  name?: string;
  /**
   * Registration mark as the register stores it, e.g. `R 0062H`.
   *
   * The register's own filter matches this exactly. Search accepts the common
   * hyphenated spelling too; see
   * {@link normalizeRegistrationMark}.
   */
  registrationMark?: string;
  radioCallSign?: string;
  imoNumber?: string;
  /** Four-digit municipality code the vessel is registered in. */
  municipalityCode?: string;
  /** `LC` for London Convention (ITC 1969), `OC` for Oslo Convention (1947). */
  tonnageType?: string;
  /** Gross tonnage under `tonnageType`. */
  tonnage?: number;
  /** Metres. */
  length?: number;
  /** Metres. */
  width?: number;
  /** Horsepower. */
  enginePower?: number;
  engineBuildYear?: number;
  buildYear?: number;
  rebuildYear?: number;
  /** Date on the measurement certificate, ISO-8601 date. */
  measureDate?: string;
  /** Date the vessel entered the register, ISO-8601 date. */
  registrationDate?: string;
  /** Owners, with natural-person details omitted. */
  owners?: FishingVesselOwner[];
};

/** Parameters for a fishing-vessel search. */
export type FisheriesVesselSearchParameters = {
  /** Free-text search across several register fields. */
  query?: string;
  name?: string;
  /** Accepts `R-62-H`, `R-0062-H` or the register's own `R 0062H`. */
  registrationMark?: string;
  radioCallSign?: string;
  /** Four-digit municipality code. */
  municipalityCode?: string;
  /** Minimum length in metres, inclusive. */
  minLength?: number;
  /** Maximum length in metres, inclusive. */
  maxLength?: number;
  /** One-based page number. Defaults to 1. */
  page?: number;
  /** Results per page, 1-200. Defaults to 30. */
  pageSize?: number;
  /** Register field to sort by. */
  sortBy?: FisheriesVesselSortField;
  /** Sorts ascending. Defaults to the register's own descending order. */
  sortAscending?: boolean;
};

/** Register fields the vessel search can sort by. */
export type FisheriesVesselSortField = "id" | "name" | "registrationMark" | "radioCallSign";

/**
 * Page position for a vessel search.
 *
 * The register reports its total count in an `x-totalcount` response header. This
 * SDK does not read response headers, so a total is not available; `hasMore` is
 * derived from whether the page came back full. Requesting the next page and
 * receiving nothing is therefore possible when the last page is exactly full.
 */
export type FisheriesVesselPagination = {
  page: number;
  pageSize: number;
  /** True when this page was full, so another page may exist. */
  hasMore: boolean;
};

/** A page of fishing-vessel search results. */
export type FisheriesVesselSearchResult = {
  items: FishingVessel[];
  pagination: FisheriesVesselPagination;
};

/** Identifies one vessel for {@link FisheriesClient.getVessel}. */
export type FisheriesVesselLookup =
  { id: string } | { registrationMark: string } | { radioCallSign: string };

/** Administrative placement of an aquaculture site. */
export type AquacultureSitePlacement = {
  municipalityCode?: string;
  municipalityName?: string;
  countyCode?: string;
  countyName?: string;
  /** Production-area code, 1-13 along the Norwegian coast. */
  productionAreaCode?: string;
  productionAreaName?: string;
  /**
   * Traffic-light status of the production area, as the register publishes it in
   * Norwegian: `GRØNN`, `GUL` or `RØD`.
   */
  productionAreaStatus?: string;
};

/** A licence connected to an aquaculture site. */
export type AquacultureSiteLicence = {
  /** Licence number, e.g. `H-KM-0018`. */
  licenceNumber?: string;
  /** Start of validity, ISO-8601. */
  validFrom?: string;
  /** End of validity, ISO-8601, when the register states one. */
  validTo?: string;
};

/**
 * A site in the public Norwegian aquaculture register.
 *
 * `capacity` is expressed in the unit named by `capacityUnitType` -- `TN` for
 * tonnes of maximum allowed biomass, and other codes for other licence kinds --
 * so it is not comparable across sites without checking the unit.
 */
export type AquacultureSite = {
  /** Site number (lokalitetsnummer), the register's public identifier. */
  siteNumber: string;
  name?: string;
  /** `Offshore` for sea sites, and other register values for land-based ones. */
  placementType?: string;
  /** `Salt`, `Fresh` or `Brackish` water, as the register classifies it. */
  waterType?: string;
  latitude?: number;
  longitude?: number;
  /** Permitted capacity in `capacityUnitType` units. */
  capacity?: number;
  /** Temporarily permitted capacity, when it differs. */
  temporaryCapacity?: number;
  /** Unit for `capacity`, e.g. `TN` for tonnes. */
  capacityUnitType?: string;
  /** First clearance time, ISO-8601. */
  firstClearanceTime?: string;
  placement?: AquacultureSitePlacement;
  /** Species groups from the licences registered on the site. */
  speciesTypes?: string[];
  /** True when the site is registered as a slaughterhouse. */
  isSlaughterhouse?: boolean;
  /** True when the site has commercial activity. */
  hasCommercialActivity?: boolean;
  /** Currently valid licence connections. */
  licences?: AquacultureSiteLicence[];
};

/** Parameters for an aquaculture-site search. */
export type AquacultureSiteSearchParameters = {
  /** Site number. */
  siteNumber?: string;
  name?: string;
  /** Nine-digit organization number of a registered licence holder. */
  organizationNumber?: string;
  /** Licence number. */
  licenceNumber?: string;
  /** Four-digit municipality code. */
  municipalityCode?: string;
  /** Two-digit county code. */
  countyCode?: string;
  /** Production-area code, at most two digits. */
  productionAreaCode?: string;
  /** Placement type, e.g. `Offshore`. */
  placementType?: string;
  /** Water type, e.g. `Salt`. */
  waterType?: string;
  /** Species type, e.g. `Salmon`. */
  speciesType?: string;
  /** Zero-based offset of the first site to return. Defaults to 0. */
  offset?: number;
  /** Number of sites to return, 1-100. Defaults to 10. */
  limit?: number;
};

/**
 * Page position for an aquaculture-site search.
 *
 * The register pages by an inclusive `from-to` offset range and reports no total,
 * so `hasMore` is derived from whether the page came back full.
 */
export type AquacultureSitePagination = {
  offset: number;
  limit: number;
  /** True when this page was full, so another page may exist. */
  hasMore: boolean;
};

/** A page of aquaculture-site search results. */
export type AquacultureSiteSearchResult = {
  items: AquacultureSite[];
  pagination: AquacultureSitePagination;
};
