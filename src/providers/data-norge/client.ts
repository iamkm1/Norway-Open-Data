import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  catalogResourceResponseSchema,
  catalogSearchResponseSchema,
  publisherTurtleSchema,
  type RawCatalogResource,
  type RawCatalogSearchHit,
  type RawCatalogSearchResponse,
} from "./schemas.js";
import type {
  CatalogDistribution,
  CatalogPublisher,
  CatalogPublisherSummary,
  CatalogResource,
  CatalogResourceType,
  CatalogSearchParameters,
  CatalogSearchResult,
} from "./types.js";

const SEARCH_URL = "https://search.api.fellesdatakatalog.digdir.no/search";
const RESOURCE_URL = "https://resource.api.fellesdatakatalog.digdir.no/v1";
const PUBLISHER_URL = "https://organization-catalogue.fellesdatakatalog.digdir.no/organizations";
const SEARCH_TTL_MS = 10 * 60 * 1_000;
const RESOURCE_TTL_MS = 60 * 60 * 1_000;
const MAX_MULTI_TYPE_WINDOW = 100;

const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500),
    type: z
      .array(z.enum(["dataset", "data-service", "concept", "information-model"]))
      .min(1)
      .max(4)
      .refine((values) => new Set(values).size === values.length, "Types must be unique.")
      .optional(),
    publisher: z.string().trim().min(1).max(200).optional(),
    accessRights: z.string().trim().min(1).max(100).optional(),
    page: z.number().int().nonnegative().max(10_000).optional(),
    size: z.number().int().min(1).max(100).optional(),
  })
  .strict();

const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._~-]+$/, "Resource IDs may not contain path separators.");
const organizationNumberSchema = z.string().regex(/^\d{9}$/, "Publisher IDs contain nine digits.");
const organizationPathSchema = z.string().regex(/^\/[A-Za-z0-9/_-]+$/);

const searchTypePath: Record<Exclude<CatalogResourceType, "unknown">, string> = {
  dataset: "datasets",
  "data-service": "data-services",
  concept: "concepts",
  "information-model": "information-models",
};

const rawTypeToType: Record<RawCatalogSearchHit["searchType"], CatalogResourceType> = {
  DATASET: "dataset",
  DATA_SERVICE: "data-service",
  CONCEPT: "concept",
  INFORMATION_MODEL: "information-model",
  SERVICE: "unknown",
  EVENT: "unknown",
};

function localizedText(
  value:
    | { nb?: string | null; nn?: string | null; no?: string | null; en?: string | null }
    | null
    | undefined,
): string | undefined {
  return value?.nb ?? value?.no ?? value?.nn ?? value?.en ?? undefined;
}

function normalizePublisher(
  publisher: RawCatalogSearchHit["organization"],
): CatalogPublisherSummary | undefined {
  if (publisher == null) return undefined;
  const name =
    publisher.name ?? localizedText(publisher.prefLabel) ?? localizedText(publisher.title);
  const normalized: CatalogPublisherSummary = {
    ...(publisher.id == null ? {} : { id: publisher.id }),
    ...(name === undefined ? {} : { name }),
    ...(publisher.uri == null ? {} : { uri: publisher.uri }),
    ...(publisher.orgPath == null ? {} : { organizationPath: publisher.orgPath }),
  };
  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function firstResourceUri(
  value:
    string | { uri?: string | null } | Array<string | { uri?: string | null }> | null | undefined,
): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const uri = typeof item === "string" ? item : item.uri;
      if (uri != null) return uri;
    }
    return undefined;
  }
  return value?.uri ?? undefined;
}

function normalizeDistribution(
  distribution: NonNullable<RawCatalogResource["distribution"]>[number],
): CatalogDistribution {
  const formats = distribution.fdkFormat ?? distribution.format;
  const firstFormat = formats?.[0];
  const format = firstFormat?.name ?? firstFormat?.code ?? firstFormat?.uri ?? undefined;
  return {
    ...(localizedText(distribution.title) === undefined
      ? {}
      : { title: localizedText(distribution.title) }),
    ...(firstResourceUri(distribution.accessURL) === undefined
      ? {}
      : { accessUrl: firstResourceUri(distribution.accessURL) }),
    ...(firstResourceUri(distribution.downloadURL) === undefined
      ? {}
      : { downloadUrl: firstResourceUri(distribution.downloadURL) }),
    ...(format === undefined ? {} : { format }),
  };
}

function firstLicense(resource: RawCatalogResource): string | undefined {
  if (resource.license?.uri != null) return resource.license.uri;
  for (const distribution of resource.distribution ?? []) {
    const licenses = Array.isArray(distribution.license)
      ? distribution.license
      : distribution.license == null
        ? []
        : [distribution.license];
    const uri = licenses.find((license) => license.uri != null)?.uri;
    if (uri != null) return uri;
  }
  return undefined;
}

function firstPage(resource: RawCatalogResource): string | undefined {
  const landingPage = resource.landingPage;
  if (typeof landingPage === "string") return landingPage;
  if (landingPage?.[0] !== undefined) return landingPage[0];
  if (typeof resource.page === "string") return resource.page;
  return resource.page?.[0];
}

function normalizeSearchHit(hit: RawCatalogSearchHit): CatalogResource {
  const title = localizedText(hit.title) ?? hit.uri ?? hit.id;
  const description = localizedText(hit.description);
  const publisher = normalizePublisher(hit.organization);
  const accessRights = hit.accessRights?.code ?? hit.accessRights?.uri ?? undefined;
  return {
    id: hit.id,
    type: rawTypeToType[hit.searchType],
    title,
    ...(description === undefined ? {} : { description }),
    ...(publisher === undefined ? {} : { publisher }),
    ...(accessRights === undefined ? {} : { accessRights }),
  };
}

function normalizeResource(
  resource: RawCatalogResource,
  type: "dataset" | "data-service",
): CatalogResource {
  const description = localizedText(resource.description);
  const publisher = normalizePublisher(resource.publisher);
  const accessRights = resource.accessRights?.code ?? resource.accessRights?.uri ?? undefined;
  const license = firstLicense(resource);
  const landingPage = firstPage(resource);
  const distributions = resource.distribution?.map(normalizeDistribution);
  return {
    id: resource.id,
    type,
    title: localizedText(resource.title) ?? resource.uri ?? resource.id,
    ...(description === undefined ? {} : { description }),
    ...(publisher === undefined ? {} : { publisher }),
    ...(accessRights === undefined ? {} : { accessRights }),
    ...(license === undefined ? {} : { license }),
    ...(landingPage === undefined ? {} : { landingPage }),
    ...(distributions === undefined ? {} : { distributions }),
  };
}

function turtleLiteral(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string;
  } catch {
    return raw.replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

function turtleValue(turtle: string, predicate: string): string | undefined {
  const escapedPredicate = predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`${escapedPredicate}\\s+"((?:[^"\\\\]|\\\\.)*)"`).exec(turtle);
  return match?.[1] === undefined ? undefined : turtleLiteral(match[1]);
}

function turtleUri(turtle: string, predicate: string): string | undefined {
  const escapedPredicate = predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedPredicate}\\s+<([^>]+)>`).exec(turtle)?.[1];
}

function turtleTerm(turtle: string, predicate: string, prefix: string): string | undefined {
  const escapedPredicate = predicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${escapedPredicate}\\s+${escapedPrefix}:([A-Za-z0-9_-]+)`).exec(turtle)?.[1];
}

function parsePublisher(turtle: string, requestedId: string): CatalogPublisher {
  const identifier = turtleValue(turtle, "dct:identifier");
  const uri =
    /<(https:\/\/organization-catalog(?:ue)?\.fellesdatakatalog\.digdir\.no\/organizations\/\d+)>/.exec(
      turtle,
    )?.[1];
  const legalName = turtleValue(turtle, "rov:legalName");
  const name = turtleValue(turtle, "foaf:name") ?? legalName;
  if (identifier !== requestedId || uri === undefined || name === undefined) {
    throw new ResponseValidationError(
      "Data.norge returned publisher metadata with an unexpected structure.",
      { provider: "data-norge" },
    );
  }
  const parentUri = turtleUri(turtle, "org:subOrganizationOf");
  const parentId = parentUri?.match(/\/organizations\/(\d+)$/)?.[1];
  const organizationPath = turtleValue(turtle, "br:orgPath");
  const homepage = turtleUri(turtle, "foaf:homepage");
  const organizationType = turtleTerm(turtle, "rov:orgType", "orgtype");
  const status = turtleTerm(turtle, "rov:orgStatus", "orgstatus");
  return {
    id: requestedId,
    uri,
    name,
    ...(legalName === undefined ? {} : { legalName }),
    ...(organizationPath === undefined ? {} : { organizationPath }),
    ...(homepage === undefined ? {} : { homepage }),
    ...(parentId === undefined ? {} : { parentId }),
    ...(organizationType === undefined ? {} : { organizationType }),
    ...(status === undefined ? {} : { status }),
  };
}

/** Client for Norway's national Data.norge metadata catalogues. */
export class DataNorgeClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Searches the national catalogue.
   *
   * Data.norge documents its ElasticSearch-backed search API as an internal,
   * changeable interface. This method deliberately isolates that risk in one
   * adapter; stable resource lookups use the separately versioned resource API.
   * When several types are requested, their provider-ranked result sets are
   * combined deterministically in the caller's type order within a bounded
   * 100-position combined window.
   */
  async search(
    parameters: CatalogSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CatalogSearchResult>> {
    const parsed = searchInputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Data.norge catalogue search.", {
        provider: "data-norge",
        cause: parsed.error,
      });
    }
    const page = parsed.data.page ?? 0;
    const size = parsed.data.size ?? 10;
    const types = parsed.data.type;
    const multiTypeWindow = (page + 1) * size;
    if (types !== undefined && types.length > 1 && multiTypeWindow > MAX_MULTI_TYPE_WINDOW) {
      throw new InputValidationError(
        `Data.norge combined multi-type searches are limited to a ${String(MAX_MULTI_TYPE_WINDOW)}-position result window. Narrow the query or request one type for deeper provider paging.`,
        { provider: "data-norge" },
      );
    }
    const organizationPath = await this.#resolveOrganizationPath(parsed.data.publisher, options);
    const bodyBase = {
      query: parsed.data.query,
      ...((organizationPath ?? parsed.data.accessRights) === undefined
        ? {}
        : {
            filters: {
              ...(organizationPath === undefined ? {} : { orgPath: { value: organizationPath } }),
              ...(parsed.data.accessRights === undefined
                ? {}
                : { accessRights: { value: parsed.data.accessRights } }),
            },
          }),
    };

    if (types === undefined || types.length === 1) {
      const result = await this.#searchRequest(
        types?.[0],
        { ...bodyBase, pagination: { page, size } },
        options,
      );
      return createResponse(
        {
          items: result.data.hits.map(normalizeSearchHit),
          pagination: {
            page: result.data.page.currentPage,
            size: result.data.page.size,
            totalItems: result.data.page.totalElements,
            totalPages: result.data.page.totalPages,
          },
        },
        responseSource(providers.dataNorge),
        result.data,
        result.cached,
        options,
      );
    }

    const windowSize = multiTypeWindow;
    const results = await Promise.all(
      types.map((type) =>
        this.#searchRequest(
          type,
          { ...bodyBase, pagination: { page: 0, size: windowSize } },
          options,
        ),
      ),
    );
    const allHits = results.flatMap((result) => result.data.hits);
    const totalItems = results.reduce((sum, result) => sum + result.data.page.totalElements, 0);
    return createResponse(
      {
        items: allHits.slice(page * size, page * size + size).map(normalizeSearchHit),
        pagination: {
          page,
          size,
          totalItems,
          totalPages: Math.ceil(totalItems / size),
        },
      },
      responseSource(providers.dataNorge),
      results.map((result) => result.data),
      results.every((result) => result.cached),
      options,
    );
  }

  /** Retrieves a dataset by the stable FDK identifier returned from search. */
  async getDataset(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CatalogResource>> {
    return this.#getResource("datasets", "dataset", id, options);
  }

  /** Retrieves a data service by the stable FDK identifier returned from search. */
  async getDataService(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CatalogResource>> {
    return this.#getResource("data-services", "data-service", id, options);
  }

  /** Retrieves public organization metadata for a nine-digit publisher ID. */
  async getPublisher(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CatalogPublisher>> {
    const parsed = organizationNumberSchema.safeParse(id);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Data.norge publisher organization number.", {
        provider: "data-norge",
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: "data-norge",
      url: `${PUBLISHER_URL}/${parsed.data}`,
      headers: { Accept: "text/turtle" },
      responseType: "text",
      schema: publisherTurtleSchema,
      options,
      cacheTtlMs: RESOURCE_TTL_MS,
    });
    return createResponse(
      parsePublisher(result.data, parsed.data),
      responseSource(providers.dataNorge),
      result.data,
      result.cached,
      options,
    );
  }

  async #resolveOrganizationPath(
    publisher: string | undefined,
    options?: RequestOptions,
  ): Promise<string | undefined> {
    if (publisher === undefined) return undefined;
    if (organizationPathSchema.safeParse(publisher).success) return publisher;
    const organizationNumber = organizationNumberSchema.safeParse(publisher);
    if (!organizationNumber.success) {
      throw new InputValidationError(
        "Data.norge publisher must be a nine-digit organization number or full organization path.",
        { provider: "data-norge", cause: organizationNumber.error },
      );
    }
    const response = await this.getPublisher(organizationNumber.data, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
    });
    if (response.data.organizationPath === undefined) {
      throw new ResponseValidationError(
        "Data.norge publisher metadata omitted its organization path.",
        {
          provider: "data-norge",
        },
      );
    }
    return response.data.organizationPath;
  }

  async #searchRequest(
    type: Exclude<CatalogResourceType, "unknown"> | undefined,
    body: object,
    options?: RequestOptions,
  ): Promise<{ data: RawCatalogSearchResponse; cached: boolean }> {
    return this.#http.request({
      provider: "data-norge",
      url: type === undefined ? SEARCH_URL : `${SEARCH_URL}/${searchTypePath[type]}`,
      method: "POST",
      body,
      schema: catalogSearchResponseSchema,
      options,
      cacheTtlMs: SEARCH_TTL_MS,
    });
  }

  async #getResource(
    path: "datasets" | "data-services",
    type: "dataset" | "data-service",
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CatalogResource>> {
    const parsed = resourceIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Data.norge resource ID.", {
        provider: "data-norge",
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: "data-norge",
      url: `${RESOURCE_URL}/${path}/${parsed.data}`,
      schema: catalogResourceResponseSchema,
      options,
      cacheTtlMs: RESOURCE_TTL_MS,
    });
    return createResponse(
      normalizeResource(result.data, type),
      responseSource(providers.dataNorge),
      result.data,
      result.cached,
      options,
    );
  }
}
