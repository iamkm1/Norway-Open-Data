import { z } from "zod";

import { createResponse, type HttpClient } from "../../core/client.js";
import { InputValidationError, NotFoundError } from "../../core/errors.js";
import { paginatePages, type PaginateOptions } from "../../core/paginate.js";
import { responseSource } from "../../core/provider.js";
import type { OpenDataResponse, QueryParameters, RequestOptions } from "../../core/types.js";
import { fiskeridirAquaProvider } from "./aqua-provider.js";
import {
  aquacultureSiteListSchema,
  aquacultureSiteSchema,
  fishingVesselListSchema,
  fishingVesselSchema,
  type RawAquacultureSite,
  type RawFishingVessel,
} from "./schemas.js";
import type {
  AquacultureSite,
  AquacultureSiteSearchParameters,
  AquacultureSiteSearchResult,
  FisheriesVesselLookup,
  FisheriesVesselSearchParameters,
  FisheriesVesselSearchResult,
  FisheriesVesselSortField,
  FishingVessel,
} from "./types.js";
import { fiskeridirVesselsProvider } from "./vessels-provider.js";

const VESSELS_URL = "https://api.fiskeridir.no/vessel-api/api/v1/vessels";
const AQUA_URL = "https://api.fiskeridir.no/pub-aqua/api/v1/sites";

const DEFAULT_VESSEL_PAGE_SIZE = 30;
const MAX_VESSEL_PAGE_SIZE = 200;
const DEFAULT_SITE_LIMIT = 10;
const MAX_SITE_LIMIT = 100;

/** Register field names, in the spelling the vessel register's `sort_by` expects. */
const VESSEL_SORT_FIELDS: Record<FisheriesVesselSortField, string> = {
  id: "ID",
  name: "NAME",
  registrationMark: "REGISTRATIONMARK",
  radioCallSign: "RADIOCALLSIGN",
};

const municipalityCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{4}$/, "A municipality code is four digits.");
const countyCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{2}$/, "A county code is two digits.");
const organizationNumberSchema = z
  .string()
  .trim()
  .regex(/^\d{9}$/, "A Norwegian organization number is nine digits.");

const vesselSearchSchema = z.object({
  query: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  registrationMark: z.string().trim().min(1).max(50).optional(),
  radioCallSign: z.string().trim().min(1).max(50).optional(),
  municipalityCode: municipalityCodeSchema.optional(),
  minLength: z.number().nonnegative().optional(),
  maxLength: z.number().positive().optional(),
  page: z.number().int().min(1).optional(),
  pageSize: z.number().int().min(1).max(MAX_VESSEL_PAGE_SIZE).optional(),
  sortBy: z.enum(["id", "name", "registrationMark", "radioCallSign"]).optional(),
  sortAscending: z.boolean().optional(),
});

const siteSearchSchema = z.object({
  siteNumber: z.string().trim().min(1).max(20).optional(),
  name: z.string().trim().min(1).max(200).optional(),
  organizationNumber: organizationNumberSchema.optional(),
  licenceNumber: z.string().trim().min(1).max(50).optional(),
  municipalityCode: municipalityCodeSchema.optional(),
  countyCode: countyCodeSchema.optional(),
  productionAreaCode: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, "A production-area code is one or two digits.")
    .optional(),
  placementType: z.string().trim().min(1).max(50).optional(),
  waterType: z.string().trim().min(1).max(50).optional(),
  speciesType: z.string().trim().min(1).max(50).optional(),
  offset: z.number().int().min(0).optional(),
  limit: z.number().int().min(1).max(MAX_SITE_LIMIT).optional(),
});

function optional<K extends string, T>(key: K, value: T | null | undefined): Record<K, T> | object {
  return value === null || value === undefined ? {} : { [key]: value };
}

/**
 * Rewrites a registration mark into the spelling the register's exact-match filter
 * accepts.
 *
 * A mark is stored as a county letter, a four-digit zero-padded number and a
 * municipality letter, separated by one space: `R 0062H`. The register also accepts
 * the hyphenated form people write on paper, `R-62-H`, but not `R0062H` or
 * `R 62 H`. Rather than guess which of those a caller has, anything already
 * containing a space or hyphen is passed through untouched, and a compact
 * `R0062H` is rewritten into the hyphenated form the register does accept.
 */
export function normalizeRegistrationMark(mark: string): string {
  const trimmed = mark.trim().toUpperCase();
  if (/[\s-]/.test(trimmed)) return trimmed;
  const compact = /^([A-ZÆØÅ]{1,2})(\d{1,5})([A-ZÆØÅ]{1,2})$/.exec(trimmed);
  if (compact === null) return trimmed;
  return `${compact[1]}-${compact[2]}-${compact[3]}`;
}

function normalizeVessel(vessel: RawFishingVessel): FishingVessel {
  return {
    id: vessel.id,
    ...optional("name", vessel.name),
    ...optional("registrationMark", vessel.registrationMark),
    ...optional("radioCallSign", vessel.radioCallSign),
    ...optional("imoNumber", vessel.imoNumber),
    ...optional("municipalityCode", vessel.municipalityCode),
    ...optional("tonnageType", vessel.tonnageType),
    ...optional("tonnage", vessel.tonnage),
    ...optional("length", vessel.length),
    ...optional("width", vessel.width),
    ...optional("enginePower", vessel.enginePower),
    ...optional("engineBuildYear", vessel.engineBuildYear),
    ...optional("buildYear", vessel.buildYear),
    ...optional("rebuildYear", vessel.rebuildYear),
    ...optional("measureDate", vessel.measureDate),
    ...optional("registrationDate", vessel.registrationDate),
    ...optional("owners", vessel.owners),
  };
}

function normalizeSite(site: RawAquacultureSite): AquacultureSite {
  const placement = site.placement;
  const licences = (site.connections ?? []).flatMap((connection) =>
    connection.licenseNr === null || connection.licenseNr === undefined
      ? []
      : [
          {
            licenceNumber: connection.licenseNr,
            ...optional("validFrom", connection.validFrom),
            ...optional("validTo", connection.validTo),
          },
        ],
  );
  return {
    siteNumber: String(site.siteNr),
    ...optional("name", site.name),
    ...optional("placementType", site.placementType),
    ...optional("waterType", site.waterType),
    ...optional("latitude", site.latitude),
    ...optional("longitude", site.longitude),
    ...optional("capacity", site.capacity),
    ...optional("temporaryCapacity", site.tempCapacity),
    ...optional("capacityUnitType", site.capacityUnitType),
    ...optional("firstClearanceTime", site.firstClearanceTime),
    ...(placement === null || placement === undefined
      ? {}
      : {
          placement: {
            ...optional("municipalityCode", placement.municipalityCode),
            ...optional("municipalityName", placement.municipalityName),
            ...optional("countyCode", placement.countyCode),
            ...optional("countyName", placement.countyName),
            ...optional("productionAreaCode", placement.prodAreaCode),
            ...optional("productionAreaName", placement.prodAreaName),
            ...optional("productionAreaStatus", placement.prodAreaStatus),
          },
        }),
    ...optional("speciesTypes", site.speciesTypes),
    ...optional("isSlaughterhouse", site.isSlaughtery),
    ...optional("hasCommercialActivity", site.hasCommercialActivity),
    ...(licences.length === 0 ? {} : { licences }),
  };
}

/**
 * Client for the Norwegian Directorate of Fisheries' two public registers.
 *
 * Both are served anonymously and need no credentials. They are separate services
 * with separate contracts, so their records are kept as separate types rather than
 * merged: a fishing vessel and an aquaculture site have nothing in common beyond
 * the agency that publishes them.
 *
 * Owner details for natural persons are not surfaced. See
 * {@link FishingVesselOwner}.
 */
export class FisheriesClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Searches the register of active fishing vessels.
   *
   * Every filter is optional; an unfiltered search returns the first page of the
   * whole register. `registrationMark` and `radioCallSign` are exact-match filters
   * upstream, while `query` and `name` are text searches.
   */
  async searchVessels(
    parameters: FisheriesVesselSearchParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<FisheriesVesselSearchResult>> {
    const parsed = vesselSearchSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid fishing-vessel search parameters.", {
        provider: fiskeridirVesselsProvider.id,
        cause: parsed.error,
      });
    }
    const criteria = parsed.data;
    if (
      criteria.minLength !== undefined &&
      criteria.maxLength !== undefined &&
      criteria.minLength > criteria.maxLength
    ) {
      throw new InputValidationError("minLength must not exceed maxLength.", {
        provider: fiskeridirVesselsProvider.id,
      });
    }
    const page = criteria.page ?? 1;
    const pageSize = criteria.pageSize ?? DEFAULT_VESSEL_PAGE_SIZE;
    const result = await this.#http.request({
      provider: fiskeridirVesselsProvider,
      url: VESSELS_URL,
      query: {
        ...optional("query", criteria.query),
        ...optional("name", criteria.name),
        ...(criteria.registrationMark === undefined
          ? {}
          : { registration_mark: normalizeRegistrationMark(criteria.registrationMark) }),
        ...(criteria.radioCallSign === undefined
          ? {}
          : { radio_call_sign: criteria.radioCallSign.toUpperCase() }),
        ...optional("municipality_code", criteria.municipalityCode),
        ...optional("length_gte", criteria.minLength),
        ...optional("length_lte", criteria.maxLength),
        ...(criteria.sortBy === undefined ? {} : { sort_by: VESSEL_SORT_FIELDS[criteria.sortBy] }),
        ...optional("sort_asc", criteria.sortAscending),
        page,
        per_page: pageSize,
      },
      schema: fishingVesselListSchema,
      options,
      cacheTtlMs: fiskeridirVesselsProvider.cacheTtlMs.search,
      resourceDescription: "fishing-vessel search",
    });
    return createResponse(
      {
        items: result.data.map(normalizeVessel),
        pagination: { page, pageSize, hasMore: result.data.length === pageSize },
      },
      responseSource(fiskeridirVesselsProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Walks fishing-vessel search results across pages.
   *
   * Bounded by `maxItems` and `maxPages`; see
   * {@link PaginateOptions}. Because the register
   * publishes its total only in a response header the SDK does not read, iteration
   * stops on the first page that is not full or is empty.
   */
  searchVesselsAll(
    parameters: FisheriesVesselSearchParameters = {},
    pagination: PaginateOptions = {},
    options?: RequestOptions,
  ): AsyncGenerator<FishingVessel, void, undefined> {
    const startPage = parameters.page ?? 1;
    return paginatePages(
      async (page) => {
        const response = await this.searchVessels({ ...parameters, page }, options);
        return {
          items: response.data.items,
          // `paginatePages` stops when the next page index reaches the reported
          // total. There is no total here, so it is reported as "one more page
          // exists" while pages keep coming back full, and as "this was the last"
          // as soon as one is not.
          totalPages: response.data.pagination.hasMore ? page + 2 : page + 1,
        };
      },
      startPage,
      pagination,
    );
  }

  /**
   * Resolves one registered fishing vessel.
   *
   * Accepts the register's own `id`, a `registrationMark`, or a `radioCallSign`.
   * The last two are searches upstream, so they raise {@link NotFoundError} when
   * nothing matches and when more than one vessel does -- an ambiguous mark must
   * not silently resolve to whichever record happened to come first.
   */
  async getVessel(
    lookup: FisheriesVesselLookup,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<FishingVessel>> {
    if ("id" in lookup) {
      const id = lookup.id.trim();
      if (id.length === 0) {
        throw new InputValidationError("A vessel id must not be empty.", {
          provider: fiskeridirVesselsProvider.id,
        });
      }
      const result = await this.#http.request({
        provider: fiskeridirVesselsProvider,
        url: `${VESSELS_URL}/${encodeURIComponent(id)}`,
        schema: fishingVesselSchema,
        options,
        cacheTtlMs: fiskeridirVesselsProvider.cacheTtlMs.detail,
        resourceDescription: `fishing vessel ${id}`,
      });
      return createResponse(
        normalizeVessel(result.data),
        responseSource(fiskeridirVesselsProvider),
        result.data,
        result.cached,
        options,
      );
    }

    const [label, value] =
      "registrationMark" in lookup
        ? (["registration mark", lookup.registrationMark] as const)
        : (["radio call sign", lookup.radioCallSign] as const);
    const search = await this.searchVessels(
      "registrationMark" in lookup
        ? { registrationMark: lookup.registrationMark, pageSize: 2 }
        : { radioCallSign: lookup.radioCallSign, pageSize: 2 },
      options,
    );
    const [first, second] = search.data.items;
    if (first === undefined) {
      throw new NotFoundError(`No active fishing vessel is registered with ${label} "${value}".`, {
        provider: fiskeridirVesselsProvider.id,
      });
    }
    if (second !== undefined) {
      throw new NotFoundError(
        `More than one active fishing vessel matches ${label} "${value}"; resolve it with searchVessels and pick by id.`,
        { provider: fiskeridirVesselsProvider.id },
      );
    }
    return createResponse(
      first,
      responseSource(fiskeridirVesselsProvider),
      search.raw,
      search.cached,
      options,
    );
  }

  /**
   * Searches the public aquaculture register for sites.
   *
   * Filters are applied by the register itself. `municipalityCode`, `countyCode`
   * and `productionAreaCode` cover the administrative filtering the register
   * supports.
   */
  async searchAquacultureSites(
    parameters: AquacultureSiteSearchParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AquacultureSiteSearchResult>> {
    const parsed = siteSearchSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid aquaculture-site search parameters.", {
        provider: fiskeridirAquaProvider.id,
        cause: parsed.error,
      });
    }
    const criteria = parsed.data;
    const offset = criteria.offset ?? 0;
    const limit = criteria.limit ?? DEFAULT_SITE_LIMIT;
    const query: QueryParameters = {
      ...optional("nr", criteria.siteNumber),
      ...optional("name", criteria.name),
      ...(criteria.organizationNumber === undefined
        ? {}
        : { "legal-entity-nr": criteria.organizationNumber }),
      ...(criteria.licenceNumber === undefined ? {} : { "license-nr": criteria.licenceNumber }),
      ...(criteria.municipalityCode === undefined
        ? {}
        : { "municipality-code": criteria.municipalityCode }),
      ...(criteria.countyCode === undefined ? {} : { "county-code": criteria.countyCode }),
      ...(criteria.productionAreaCode === undefined
        ? {}
        : { "production-area-code": criteria.productionAreaCode }),
      ...optional("placement", criteria.placementType),
      ...optional("water", criteria.waterType),
      ...(criteria.speciesType === undefined ? {} : { "species-type": criteria.speciesType }),
      // The register pages by an inclusive offset range, e.g. `0-9` for ten sites.
      range: `${offset}-${offset + limit - 1}`,
    };
    const result = await this.#http.request({
      provider: fiskeridirAquaProvider,
      url: AQUA_URL,
      query,
      schema: aquacultureSiteListSchema,
      options,
      cacheTtlMs: fiskeridirAquaProvider.cacheTtlMs.search,
      resourceDescription: "aquaculture-site search",
    });
    return createResponse(
      {
        items: result.data.map(normalizeSite),
        pagination: { offset, limit, hasMore: result.data.length === limit },
      },
      responseSource(fiskeridirAquaProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Walks aquaculture-site search results across pages.
   *
   * Bounded by `maxItems` and `maxPages`. The register reports no total, so
   * iteration stops on the first page that is not full or is empty.
   */
  async *searchAquacultureSitesAll(
    parameters: AquacultureSiteSearchParameters = {},
    pagination: PaginateOptions = {},
    options?: RequestOptions,
  ): AsyncGenerator<AquacultureSite, void, undefined> {
    const limit = parameters.limit ?? DEFAULT_SITE_LIMIT;
    const start = parameters.offset ?? 0;
    yield* paginatePages(
      async (page) => {
        const response = await this.searchAquacultureSites(
          { ...parameters, offset: start + page * limit, limit },
          options,
        );
        return {
          items: response.data.items,
          totalPages: response.data.pagination.hasMore ? page + 2 : page + 1,
        };
      },
      0,
      pagination,
    );
  }

  /** Resolves one aquaculture site by its public site number. */
  async getAquacultureSite(
    siteNumber: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AquacultureSite>> {
    const trimmed = siteNumber.trim();
    if (!/^\d{1,12}$/.test(trimmed)) {
      throw new InputValidationError(
        `Invalid aquaculture site number "${siteNumber}". A site number is digits only.`,
        { provider: fiskeridirAquaProvider.id },
      );
    }
    const result = await this.#http.request({
      provider: fiskeridirAquaProvider,
      url: `${AQUA_URL}/${trimmed}`,
      schema: aquacultureSiteSchema,
      options,
      cacheTtlMs: fiskeridirAquaProvider.cacheTtlMs.detail,
      resourceDescription: `aquaculture site ${trimmed}`,
    });
    return createResponse(
      normalizeSite(result.data),
      responseSource(fiskeridirAquaProvider),
      result.data,
      result.cached,
      options,
    );
  }
}
