import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import { paginatePages, type PaginateOptions } from "../../core/paginate.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import type { NorwegianAddress } from "../kartverket/types.js";
import {
  companySchema,
  companySearchSchema,
  type RawCompany,
  type RawCompanySearch,
} from "./schemas.js";
import type { Company, CompanySearchParameters, CompanySearchResult } from "./types.js";

const BASE_URL = "https://data.brreg.no/enhetsregisteret/api";
const COMPANY_TTL_MS = 15 * 60 * 1_000;
const MAX_SEARCH_SIZE = 100;

const searchSchema = z.object({
  name: z.string().trim().min(1).optional(),
  organizationNumber: z.string().trim().min(1).optional(),
  municipalityCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  industryCode: z.string().trim().min(1).optional(),
  organizationForm: z.string().trim().min(1).optional(),
  page: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().optional(),
});

/** Removes spaces and validates a Norwegian nine-digit organization number. */
export function normalizeOrganizationNumber(value: string): string {
  if (typeof value !== "string") {
    throw new InputValidationError("Organization number must be a string.", {
      provider: "brreg",
    });
  }
  const normalized = value.replaceAll(/\s/g, "");
  if (!/^\d{9}$/.test(normalized)) {
    throw new InputValidationError("Organization number must contain exactly nine digits.", {
      provider: "brreg",
    });
  }
  return normalized;
}

function addressLines(value: string[] | string | null | undefined): string | undefined {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ") || undefined;
  return value ?? undefined;
}

function normalizeAddress(raw: NonNullable<RawCompany["forretningsadresse"]>): NorwegianAddress {
  const addressText = addressLines(raw.adresse);
  const municipalityCode =
    raw.kommunenummer ?? (typeof raw.kommune === "object" ? raw.kommune?.kommunenummer : undefined);
  const municipalityName = typeof raw.kommune === "string" ? raw.kommune : raw.kommune?.kommunenavn;
  return {
    ...(addressText === undefined ? {} : { addressText }),
    ...(raw.postnummer == null ? {} : { postalCode: raw.postnummer }),
    ...(raw.poststed == null ? {} : { postalPlace: raw.poststed }),
    ...(raw.landkode == null ? {} : { countryCode: raw.landkode }),
    ...(raw.land == null ? {} : { countryName: raw.land }),
    ...(municipalityCode == null ? {} : { municipalityCode }),
    ...(municipalityName == null ? {} : { municipalityName }),
    ...(municipalityCode == null ? {} : { countyCode: municipalityCode.slice(0, 2) }),
  };
}

function normalizeMunicipality(
  raw: NonNullable<RawCompany["forretningsadresse"]>,
): Company["municipality"] {
  const code =
    raw.kommunenummer ?? (typeof raw.kommune === "object" ? raw.kommune?.kommunenummer : undefined);
  const name = typeof raw.kommune === "string" ? raw.kommune : raw.kommune?.kommunenavn;
  if (code == null && name == null) return undefined;
  return {
    ...(code == null ? {} : { code }),
    ...(name == null ? {} : { name }),
  };
}

function normalizeCode(raw: RawCompany["naeringskode1"]): Company["industry"] {
  if (raw == null) return undefined;
  return {
    code: raw.kode,
    ...(raw.beskrivelse == null ? {} : { description: raw.beskrivelse }),
  };
}

/** Converts an Enhetsregisteret entity without discarding provider semantics. */
export function normalizeCompany(raw: RawCompany): Company {
  const businessAddress = raw.forretningsadresse ?? raw.beliggenhetsadresse;
  const secondaryIndustries = [raw.naeringskode2, raw.naeringskode3]
    .map(normalizeCode)
    .filter((industry): industry is NonNullable<Company["industry"]> => industry !== undefined);
  const municipality = businessAddress == null ? undefined : normalizeMunicipality(businessAddress);
  return {
    organizationNumber: raw.organisasjonsnummer,
    name: raw.navn,
    ...(raw.organisasjonsform == null
      ? {}
      : {
          organizationForm: {
            code: raw.organisasjonsform.kode,
            ...(raw.organisasjonsform.beskrivelse == null
              ? {}
              : { description: raw.organisasjonsform.beskrivelse }),
          },
        }),
    ...(normalizeCode(raw.naeringskode1) === undefined
      ? {}
      : { industry: normalizeCode(raw.naeringskode1) }),
    ...(secondaryIndustries.length === 0 ? {} : { secondaryIndustries }),
    ...(businessAddress == null ? {} : { businessAddress: normalizeAddress(businessAddress) }),
    ...(raw.postadresse == null ? {} : { postalAddress: normalizeAddress(raw.postadresse) }),
    ...(municipality == null ? {} : { municipality }),
    ...(raw.registreringsdatoEnhetsregisteret == null
      ? {}
      : { registeredAt: raw.registreringsdatoEnhetsregisteret }),
    ...(raw.stiftelsesdato == null ? {} : { foundedAt: raw.stiftelsesdato }),
    ...(raw.registrertIMvaregisteret == null
      ? {}
      : { vatRegistered: raw.registrertIMvaregisteret }),
    ...(raw.registrertIArbeidsgiverregisteret == null
      ? {}
      : { employerRegistered: raw.registrertIArbeidsgiverregisteret }),
    ...(raw.konkurs == null ? {} : { bankruptcy: raw.konkurs }),
    ...(raw.underAvvikling == null ? {} : { liquidation: raw.underAvvikling }),
    ...(raw.antallAnsatte == null ? {} : { numberOfEmployees: raw.antallAnsatte }),
    ...(raw.hjemmeside == null ? {} : { homepage: raw.hjemmeside }),
  };
}

function normalizeSearch(raw: RawCompanySearch): CompanySearchResult {
  const entities = raw._embedded?.enheter ?? raw._embedded?.underenheter ?? [];
  return {
    items: entities.map(normalizeCompany),
    pagination: {
      page: raw.page.number,
      size: raw.page.size,
      totalItems: raw.page.totalElements,
      totalPages: raw.page.totalPages,
    },
  };
}

/** Client for the open Enhetsregisteret company and sub-entity endpoints. */
export class BrregClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Gets an organization by its nine-digit organization number. */
  async get(
    organizationNumber: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Company>> {
    const normalized = normalizeOrganizationNumber(organizationNumber);
    const result = await this.#http.request({
      provider: "brreg",
      url: `${BASE_URL}/enheter/${normalized}`,
      schema: companySchema,
      transform: (data) => {
        if (data.organisasjonsnummer !== normalized) {
          throw new ResponseValidationError(
            "Brreg returned a different organization than requested.",
            { provider: "brreg" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: COMPANY_TTL_MS,
    });
    return createResponse(
      normalizeCompany(result.data),
      responseSource(providers.brreg),
      result.data,
      result.cached,
      options,
    );
  }

  /** Searches open organizations with Brønnøysundregistrene pagination. */
  async search(
    parameters: CompanySearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CompanySearchResult>> {
    const parsed = searchSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid company search parameters.", {
        provider: "brreg",
        cause: parsed.error,
      });
    }
    const organizationNumber =
      parsed.data.organizationNumber === undefined
        ? undefined
        : normalizeOrganizationNumber(parsed.data.organizationNumber);
    const result = await this.#http.request({
      provider: "brreg",
      url: `${BASE_URL}/enheter`,
      query: {
        navn: parsed.data.name,
        organisasjonsnummer: organizationNumber,
        kommunenummer: parsed.data.municipalityCode,
        naeringskode: parsed.data.industryCode,
        organisasjonsform: parsed.data.organizationForm,
        page: parsed.data.page ?? 0,
        size: Math.min(parsed.data.size ?? 20, MAX_SEARCH_SIZE),
      },
      schema: companySearchSchema,
      options,
      cacheTtlMs: COMPANY_TTL_MS,
    });
    return createResponse(
      normalizeSearch(result.data),
      responseSource(providers.brreg),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Iterates every matching organization, requesting each page on demand.
   *
   * Bounded by `maxItems` and `maxPages` so an upstream change cannot produce
   * an unbounded request loop.
   */
  async *searchAll(
    parameters: CompanySearchParameters = {},
    options?: RequestOptions & PaginateOptions,
  ): AsyncGenerator<Company, void, undefined> {
    yield* paginatePages(
      async (page) => {
        const result = await this.search({ ...parameters, page }, options);
        return { items: result.data.items, totalPages: result.data.pagination.totalPages };
      },
      parameters.page ?? 0,
      options ?? {},
    );
  }

  /** Gets a public sub-entity by organization number. */
  async getSubEntity(
    organizationNumber: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Company>> {
    const normalized = normalizeOrganizationNumber(organizationNumber);
    const result = await this.#http.request({
      provider: "brreg",
      url: `${BASE_URL}/underenheter/${normalized}`,
      schema: companySchema,
      transform: (data) => {
        if (data.organisasjonsnummer !== normalized) {
          throw new ResponseValidationError(
            "Brreg returned a different sub-entity than requested.",
            { provider: "brreg" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: COMPANY_TTL_MS,
    });
    return createResponse(
      normalizeCompany(result.data),
      responseSource(providers.brreg),
      result.data,
      result.cached,
      options,
    );
  }
}
