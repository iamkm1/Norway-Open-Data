import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, ResponseValidationError } from "../../core/errors.js";
import { boundingBoxSchema, type BoundingBox } from "../../core/geo.js";
import { resolvePaginateOptions, type PaginateOptions } from "../../core/paginate.js";
import { responseSource } from "../../core/provider.js";
import type { OpenDataResponse, QueryParameters, RequestOptions } from "../../core/types.js";
import { geonorgeProvider } from "./provider.js";
import {
  geonorgeMetadataSchema,
  geonorgeSearchResponseSchema,
  type RawGeonorgeMetadata,
  type RawGeonorgeSearchHit,
  type RawGeonorgeSearchResponse,
} from "./schemas.js";
import type {
  GeonorgeAccess,
  GeonorgeContact,
  GeonorgeDatasetMetadata,
  GeonorgeDatasetSummary,
  GeonorgeDistribution,
  GeonorgeDistributionFormat,
  GeonorgeDistributionKind,
  GeonorgeLicense,
  GeonorgeMetadata,
  GeonorgeMetadataSummary,
  GeonorgeMetadataType,
  GeonorgeReferenceSystem,
  GeonorgeSearchParameters,
  GeonorgeSearchResult,
  GeonorgeServiceMetadata,
  GeonorgeServiceReference,
  GeonorgeServiceSummary,
  GeonorgeUpdateMetadata,
} from "./types.js";

const BASE_URL = "https://kartkatalog.geonorge.no/api";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100_000;

const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(500).optional(),
    publisher: z.string().trim().min(1).max(300).optional(),
    theme: z.string().trim().min(1).max(200).optional(),
    offset: z.number().int().nonnegative().max(MAX_OFFSET).optional(),
    limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  })
  .strict();

const metadataIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((id) => id !== "." && id !== "..", "Metadata IDs may not be path dot segments.")
  .refine(
    (id) =>
      Array.from(id).every((character) => {
        const codePoint = character.codePointAt(0);
        return codePoint !== undefined && codePoint > 31 && codePoint !== 127;
      }),
    "Metadata IDs may not contain controls.",
  );

type SearchType = "dataset" | "service";
type SearchSummary = GeonorgeDatasetSummary | GeonorgeServiceSummary;

type DistributionSource = {
  FormatName?: string | null;
  FormatVersion?: string | null;
  URL?: string | null;
  Protocol?: string | null;
  Name?: string | null;
  Organization?: string | null;
  UnitsOfDistribution?: string | null;
  ProtocolName?: string | null;
};

function text(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === undefined || normalized.length === 0 ? undefined : normalized;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = text(value);
    if (normalized === undefined || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function metadataType(value: string): GeonorgeMetadataType {
  switch (value.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "")) {
    case "dataset":
      return "dataset";
    case "service":
      return "service";
    case "series":
      return "series";
    case "servicelayer":
      return "service-layer";
    case "software":
    case "application":
      return "software";
    default:
      return "unknown";
  }
}

function isArcGisRestService(url: string | undefined): boolean {
  if (url === undefined) return false;
  try {
    return /\/rest\/services\/.+\/(?:MapServer|FeatureServer)(?:\/\d+)?\/?$/i.test(
      new URL(url).pathname,
    );
  } catch {
    return false;
  }
}

function distributionKind(
  protocolValue: string | undefined,
  url: string | undefined,
  protocolNameValue?: string,
): GeonorgeDistributionKind {
  const protocol = (protocolValue ?? protocolNameValue ?? "").trim().toUpperCase();
  switch (protocol) {
    case "OGC:WFS":
    case "WFS-TJENESTE":
      return "wfs";
    case "OGC:WMS":
    case "WMS-TJENESTE":
      return "wms";
    case "OGC:API-FEATURES":
    case "OGC:OAPIF":
    case "OGC API FEATURES":
      return "ogc-api-features";
    case "W3C:REST":
      return isArcGisRestService(url) ? "arcgis-rest" : "rest";
    case "GEONORGE:FILEDOWNLOAD":
      return "download-file";
    case "GEONORGE:DOWNLOAD":
      return "download-api";
    case "WWW:DOWNLOAD-1.0-HTTP--DOWNLOAD":
      return "download";
    case "W3C:ATOMFEED":
      return "atom-feed";
    case "GEONORGE:OFFLINE":
      return "offline";
    case "WWW:LINK":
    case "WWW:LINK-1.0-HTTP--LINK":
      return "web-page";
    default:
      return "unknown";
  }
}

function distributionFormat(source: DistributionSource): GeonorgeDistributionFormat | undefined {
  const name = text(source.FormatName);
  if (name === undefined) return undefined;
  const version = text(source.FormatVersion);
  return {
    name,
    ...(version === undefined ? {} : { version }),
  };
}

function normalizeDistribution(source: DistributionSource): GeonorgeDistribution {
  const protocol = text(source.Protocol);
  const protocolName = text(source.ProtocolName);
  const url = text(source.URL);
  const name = text(source.Name);
  const organization = text(source.Organization);
  const unitsOfDistribution = text(source.UnitsOfDistribution);
  const format = distributionFormat(source);
  return {
    kind: distributionKind(protocol, url, protocolName),
    ...(protocol === undefined ? {} : { protocol }),
    ...(protocolName === undefined ? {} : { protocolName }),
    ...(url === undefined ? {} : { url }),
    ...(name === undefined ? {} : { name }),
    ...(organization === undefined ? {} : { organization }),
    ...(unitsOfDistribution === undefined ? {} : { unitsOfDistribution }),
    formats: format === undefined ? [] : [format],
  };
}

function distributionGroupKey(source: DistributionSource): string {
  return [
    text(source.Protocol) ?? "",
    text(source.URL) ?? "",
    text(source.Organization) ?? "",
    text(source.Name) ?? "",
  ].join("\u0000");
}

function addFormat(
  distribution: GeonorgeDistribution,
  format: GeonorgeDistributionFormat | undefined,
): void {
  if (
    format === undefined ||
    distribution.formats.some(
      (existing) => existing.name === format.name && existing.version === format.version,
    )
  ) {
    return;
  }
  distribution.formats.push(format);
}

function normalizeDistributions(metadata: RawGeonorgeMetadata): GeonorgeDistribution[] {
  const result: GeonorgeDistribution[] = [];
  const groups = new Map<string, GeonorgeDistribution>();
  for (const source of metadata.DistributionsFormats ?? []) {
    const key = distributionGroupKey(source);
    const existing = groups.get(key);
    if (existing === undefined) {
      const distribution = normalizeDistribution(source);
      groups.set(key, distribution);
      result.push(distribution);
    } else {
      addFormat(existing, distributionFormat(source));
    }
  }

  if (metadata.DistributionDetails !== null && metadata.DistributionDetails !== undefined) {
    const primary = normalizeDistribution(metadata.DistributionDetails);
    const matchingIndex = result.findIndex(
      (distribution) =>
        distribution.protocol === primary.protocol &&
        distribution.url === primary.url &&
        (distribution.protocol !== undefined || distribution.url !== undefined),
    );
    if (matchingIndex >= 0) {
      const matching = result[matchingIndex];
      if (matching !== undefined && matchingIndex > 0) {
        result.splice(matchingIndex, 1);
        result.unshift(matching);
      }
    } else {
      result.unshift(primary);
    }
  }
  return result;
}

function serviceReference(source: {
  Uuid?: string | null;
  Title?: string | null;
  DistributionProtocol?: string | null;
  GetCapabilitiesUrl?: string | null;
}): GeonorgeServiceReference {
  const id = text(source.Uuid);
  const title = text(source.Title);
  const protocol = text(source.DistributionProtocol);
  const url = text(source.GetCapabilitiesUrl);
  return {
    ...(id === undefined ? {} : { id }),
    ...(title === undefined ? {} : { title }),
    kind: distributionKind(protocol, url),
    ...(protocol === undefined ? {} : { protocol }),
    ...(url === undefined ? {} : { url }),
  };
}

function mergeServiceReference(
  services: GeonorgeServiceReference[],
  candidate: GeonorgeServiceReference,
): void {
  const existing = services.find(
    (service) =>
      (candidate.id !== undefined && service.id === candidate.id) ||
      (candidate.url !== undefined && service.url === candidate.url),
  );
  if (existing === undefined) {
    services.push(candidate);
    return;
  }
  existing.id ??= candidate.id;
  existing.title ??= candidate.title;
  existing.protocol ??= candidate.protocol;
  existing.url ??= candidate.url;
  if (existing.kind === "unknown" && candidate.kind !== "unknown") existing.kind = candidate.kind;
}

function normalizeServices(metadata: RawGeonorgeMetadata): GeonorgeServiceReference[] {
  const services: GeonorgeServiceReference[] = [];
  const wmsUrl = text(metadata.ServiceDistributionUrlForDataset);
  const wmsProtocol = text(metadata.ServiceDistributionProtocolForDataset);
  const serviceId = text(metadata.ServiceUuid);
  if (wmsUrl !== undefined || wmsProtocol !== undefined || serviceId !== undefined) {
    mergeServiceReference(
      services,
      serviceReference({
        Uuid: serviceId,
        DistributionProtocol: wmsProtocol,
        GetCapabilitiesUrl: wmsUrl,
      }),
    );
  }

  const wfsUrl = text(metadata.ServiceWfsDistributionUrlForDataset);
  if (wfsUrl !== undefined) {
    mergeServiceReference(
      services,
      serviceReference({
        DistributionProtocol: "OGC:WFS",
        GetCapabilitiesUrl: wfsUrl,
      }),
    );
  }

  for (const service of metadata.DatasetServicesWithShowMapLink ?? []) {
    mergeServiceReference(services, serviceReference(service));
  }
  return services;
}

function providerNumber(value: string, coordinate: string): number {
  const normalized = value.trim().replaceAll("\u2212", "-").replaceAll(",", ".");
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)) {
    throw new ResponseValidationError(
      `Geonorge returned a non-numeric ${coordinate} bounding-box coordinate.`,
      { provider: geonorgeProvider.id },
    );
  }
  const result = Number(normalized);
  if (!Number.isFinite(result)) {
    throw new ResponseValidationError(
      `Geonorge returned a non-finite ${coordinate} bounding-box coordinate.`,
      { provider: geonorgeProvider.id },
    );
  }
  return result;
}

function normalizeBoundingBox(
  boundingBox: RawGeonorgeMetadata["BoundingBox"],
): BoundingBox | undefined {
  if (boundingBox === null || boundingBox === undefined) return undefined;
  const candidate = {
    south: providerNumber(boundingBox.SouthBoundLatitude, "south"),
    west: providerNumber(boundingBox.WestBoundLongitude, "west"),
    north: providerNumber(boundingBox.NorthBoundLatitude, "north"),
    east: providerNumber(boundingBox.EastBoundLongitude, "east"),
  };
  const parsed = boundingBoxSchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ResponseValidationError("Geonorge returned an invalid WGS84 bounding box.", {
      provider: geonorgeProvider.id,
      cause: parsed.error,
    });
  }
  return parsed.data;
}

function normalizeContact(
  contact: RawGeonorgeMetadata["ContactMetadata"],
): GeonorgeContact | undefined {
  if (contact === null || contact === undefined) return undefined;
  const name = text(contact.Name);
  const organization = text(contact.Organization);
  const email = text(contact.Email);
  const role = text(contact.Role);
  if ([name, organization, email, role].every((value) => value === undefined)) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(organization === undefined ? {} : { organization }),
    ...(email === undefined ? {} : { email }),
    ...(role === undefined ? {} : { role }),
  };
}

function normalizeContacts(metadata: RawGeonorgeMetadata): GeonorgeContact[] {
  const contacts: GeonorgeContact[] = [];
  const seen = new Set<string>();
  for (const raw of [
    metadata.ContactPublisher,
    metadata.ContactOwner,
    ...(metadata.ContactOwners ?? []),
    metadata.ContactMetadata,
  ]) {
    const contact = normalizeContact(raw);
    if (contact === undefined) continue;
    const key = [
      contact.email ?? "",
      contact.name ?? "",
      contact.organization ?? "",
      contact.role ?? "",
    ]
      .join("\u0000")
      .toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push(contact);
  }
  return contacts;
}

function normalizeReferenceSystems(metadata: RawGeonorgeMetadata): GeonorgeReferenceSystem[] {
  const systems: GeonorgeReferenceSystem[] = [];
  const seen = new Set<string>();
  for (const raw of [
    ...(metadata.ReferenceSystems ?? []),
    ...(metadata.ReferenceSystem == null ? [] : [metadata.ReferenceSystem]),
  ]) {
    const name = text(raw.CoordinateSystem);
    const url = text(raw.CoordinateSystemUrl);
    const namespace = text(raw.Namespace);
    if ([name, url, namespace].every((value) => value === undefined)) continue;
    const key = [name ?? "", url ?? "", namespace ?? ""].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    systems.push({
      ...(name === undefined ? {} : { name }),
      ...(url === undefined ? {} : { url }),
      ...(namespace === undefined ? {} : { namespace }),
    });
  }
  return systems;
}

function normalizeLicense(metadata: RawGeonorgeMetadata): GeonorgeLicense | undefined {
  const name = text(metadata.Constraints?.OtherConstraintsLinkText);
  const url = text(metadata.Constraints?.OtherConstraintsLink);
  if (name === undefined && url === undefined) return undefined;
  return {
    ...(name === undefined ? {} : { name }),
    ...(url === undefined ? {} : { url }),
  };
}

function normalizeAccess(metadata: RawGeonorgeMetadata): GeonorgeAccess {
  const constraints = metadata.Constraints;
  const label = text(metadata.DataAccess);
  const accessConstraints = text(constraints?.AccessConstraints);
  const accessConstraintUrl = text(constraints?.OtherConstraintsAccess);
  const securityConstraints = text(constraints?.SecurityConstraints);
  const securityNote = text(constraints?.SecurityConstraintsNote);
  return {
    isOpenData: metadata.AccessIsOpendata,
    isRestricted: metadata.AccessIsRestricted,
    isProtected: metadata.AccessIsProtected,
    ...(label === undefined ? {} : { label }),
    ...(accessConstraints === undefined ? {} : { accessConstraints }),
    ...(accessConstraintUrl === undefined ? {} : { accessConstraintUrl }),
    ...(securityConstraints === undefined ? {} : { securityConstraints }),
    ...(securityNote === undefined ? {} : { securityNote }),
  };
}

function normalizeUpdates(metadata: RawGeonorgeMetadata): GeonorgeUpdateMetadata {
  const createdAt = metadata.DateCreated ?? undefined;
  const publishedAt = metadata.DatePublished ?? undefined;
  const updatedAt = metadata.DateUpdated ?? undefined;
  const metadataUpdatedAt = metadata.DateMetadataUpdated ?? undefined;
  const metadataValidFrom = metadata.DateMetadataValidFrom ?? undefined;
  const metadataValidTo = metadata.DateMetadataValidTo ?? undefined;
  const maintenanceFrequency = text(metadata.MaintenanceFrequency);
  const status = text(metadata.Status);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(publishedAt === undefined ? {} : { publishedAt }),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(metadataUpdatedAt === undefined ? {} : { metadataUpdatedAt }),
    ...(metadataValidFrom === undefined ? {} : { metadataValidFrom }),
    ...(metadataValidTo === undefined ? {} : { metadataValidTo }),
    ...(maintenanceFrequency === undefined ? {} : { maintenanceFrequency }),
    ...(status === undefined ? {} : { status }),
  };
}

function normalizeMetadata(metadata: RawGeonorgeMetadata): GeonorgeMetadata {
  const description = text(metadata.Abstract);
  const publisher = text(metadata.Organization);
  const themes = uniqueStrings([
    ...(metadata.TopicCategories ?? []),
    ...(metadata.KeywordsNationalTheme ?? []).map((keyword) => keyword.KeywordValue),
  ]);
  const keywords = uniqueStrings(
    (metadata.KeywordsTheme ?? []).map((keyword) => keyword.KeywordValue),
  );
  const spatialScope = text(metadata.SpatialScope);
  const geographicExtent = normalizeBoundingBox(metadata.BoundingBox);
  const license = normalizeLicense(metadata);
  const attribution = text(metadata.Constraints?.OtherConstraints);
  const useLimitations = text(metadata.Constraints?.UseLimitations);
  const serviceType = text(metadata.ServiceType);
  return {
    id: metadata.Uuid,
    title: metadata.Title,
    type: metadataType(metadata.Type),
    ...(description === undefined ? {} : { description }),
    ...(publisher === undefined ? {} : { publisher }),
    themes,
    keywords,
    ...(spatialScope === undefined ? {} : { spatialScope }),
    ...(geographicExtent === undefined ? {} : { geographicExtent }),
    referenceSystems: normalizeReferenceSystems(metadata),
    contacts: normalizeContacts(metadata),
    ...(license === undefined ? {} : { license }),
    ...(attribution === undefined ? {} : { attribution }),
    ...(useLimitations === undefined ? {} : { useLimitations }),
    access: normalizeAccess(metadata),
    updates: normalizeUpdates(metadata),
    distributions: normalizeDistributions(metadata),
    services: normalizeServices(metadata),
    operatesOn: uniqueStrings(metadata.OperatesOn ?? []),
    ...(serviceType === undefined ? {} : { serviceType }),
  };
}

function searchAccess(hit: RawGeonorgeSearchHit): GeonorgeAccess {
  const isOpenData = hit.AccessIsOpendata ?? hit.IsOpenData ?? undefined;
  return {
    ...(isOpenData === undefined ? {} : { isOpenData }),
    isRestricted: hit.AccessIsRestricted,
    isProtected: hit.AccessIsProtected,
  };
}

function normalizeSearchBase(hit: RawGeonorgeSearchHit): GeonorgeMetadataSummary {
  const description = text(hit.Abstract);
  const publisher = text(hit.Organization);
  const theme = text(hit.Theme);
  const updatedAt = hit.Date ?? undefined;
  const spatialScope = text(hit.SpatialScope);
  return {
    id: hit.Uuid,
    title: hit.Title,
    ...(description === undefined ? {} : { description }),
    ...(publisher === undefined ? {} : { publisher }),
    themes: theme === undefined ? [] : [theme],
    access: searchAccess(hit),
    ...(updatedAt === undefined ? {} : { updatedAt }),
    ...(spatialScope === undefined ? {} : { spatialScope }),
  };
}

function normalizeSearchHit(hit: RawGeonorgeSearchHit, type: "dataset"): GeonorgeDatasetSummary;
function normalizeSearchHit(hit: RawGeonorgeSearchHit, type: "service"): GeonorgeServiceSummary;
function normalizeSearchHit(hit: RawGeonorgeSearchHit, type: SearchType): SearchSummary {
  const base = normalizeSearchBase(hit);
  if (type === "dataset") return { ...base, type };
  const source: DistributionSource = {
    Protocol: hit.DistributionProtocol,
    URL: hit.DistributionUrl ?? hit.GetCapabilitiesUrl,
    Name: hit.DistributionName,
  };
  const hasEndpoint = [source.Protocol, source.URL, source.Name].some(
    (value) => text(value) !== undefined,
  );
  return {
    ...base,
    type,
    ...(hasEndpoint ? { endpoint: normalizeDistribution(source) } : {}),
  };
}

function searchQuery(
  type: SearchType,
  parameters: z.infer<typeof searchInputSchema>,
  offset: number,
  limit: number,
): QueryParameters {
  const query: QueryParameters = {
    text: parameters.query,
    offset: offset + 1,
    limit,
    orderby: "title",
  };
  let facet = 0;
  query[`facets[${String(facet)}]name`] = "type";
  query[`facets[${String(facet)}]value`] = type;
  facet += 1;
  if (parameters.publisher !== undefined) {
    query[`facets[${String(facet)}]name`] = "organization";
    query[`facets[${String(facet)}]value`] = parameters.publisher;
    facet += 1;
  }
  if (parameters.theme !== undefined) {
    query[`facets[${String(facet)}]name`] = "theme";
    query[`facets[${String(facet)}]value`] = parameters.theme;
  }
  return query;
}

function assertSearchContract(
  response: RawGeonorgeSearchResponse,
  type: SearchType,
  upstreamOffset: number,
  limit: number,
): void {
  if (response.Offset !== upstreamOffset || response.Limit !== limit) {
    throw new ResponseValidationError(
      "Geonorge returned pagination metadata that does not match the requested window.",
      { provider: geonorgeProvider.id },
    );
  }
  if ((response.Results ?? []).some((hit) => hit.Type.trim().toLowerCase() !== type)) {
    throw new ResponseValidationError(
      `Geonorge returned a non-${type} record in a ${type} search.`,
      { provider: geonorgeProvider.id },
    );
  }
}

/** Client for Geonorge's national geospatial metadata catalogue. */
export class GeonorgeClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Searches dataset metadata using a zero-based item offset. */
  async searchDatasets(
    parameters: GeonorgeSearchParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeSearchResult<GeonorgeDatasetSummary>>> {
    return this.#search("dataset", parameters, options);
  }

  /** Searches service metadata using a zero-based item offset. */
  async searchServices(
    parameters: GeonorgeSearchParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeSearchResult<GeonorgeServiceSummary>>> {
    return this.#search("service", parameters, options);
  }

  /**
   * Iterates matching datasets in deterministic title order.
   *
   * `maxItems` and `maxPages` bound the walk. Repeated or overlapping pages
   * are rejected so an upstream paging regression cannot silently duplicate
   * records or create an unbounded loop.
   */
  async *searchDatasetsAll(
    parameters: GeonorgeSearchParameters = {},
    options: RequestOptions & PaginateOptions = {},
  ): AsyncGenerator<GeonorgeDatasetSummary, void, undefined> {
    for await (const item of this.#searchAll("dataset", parameters, options)) {
      if (item.type === "dataset") yield item;
    }
  }

  /** Iterates matching services with the same bounds and repeat protection. */
  async *searchServicesAll(
    parameters: GeonorgeSearchParameters = {},
    options: RequestOptions & PaginateOptions = {},
  ): AsyncGenerator<GeonorgeServiceSummary, void, undefined> {
    for await (const item of this.#searchAll("service", parameters, options)) {
      if (item.type === "service") yield item;
    }
  }

  /** Retrieves and normalizes any Geonorge metadata record by its opaque identifier. */
  async getMetadata(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeMetadata>> {
    const parsed = metadataIdSchema.safeParse(id);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Geonorge metadata identifier.", {
        provider: geonorgeProvider.id,
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: geonorgeProvider,
      url: `${BASE_URL}/getdata/${encodeURIComponent(parsed.data)}`,
      headers: { "Accept-Language": "nb-NO" },
      resourceDescription: `metadata ${parsed.data}`,
      schema: geonorgeMetadataSchema,
      transform: (metadata) => {
        if (metadata.Uuid !== parsed.data) {
          throw new ResponseValidationError(
            "Geonorge returned metadata for a different identifier.",
            { provider: geonorgeProvider.id },
          );
        }
        normalizeMetadata(metadata);
        return metadata;
      },
      options,
      cacheTtlMs: geonorgeProvider.cacheTtlMs.metadata,
    });
    if (result.data.Uuid !== parsed.data) {
      throw new ResponseValidationError("Geonorge returned metadata for a different identifier.", {
        provider: geonorgeProvider.id,
      });
    }
    return createResponse(
      normalizeMetadata(result.data),
      responseSource(geonorgeProvider),
      result.data,
      result.cached,
      options,
    );
  }

  /** Retrieves a record and verifies that Geonorge identifies it as a dataset. */
  async getDataset(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeDatasetMetadata>> {
    const response = await this.getMetadata(id, options);
    if (response.data.type !== "dataset") {
      throw new ResponseValidationError(
        `Geonorge metadata ${id} is ${response.data.type}, not a dataset.`,
        { provider: geonorgeProvider.id },
      );
    }
    return { ...response, data: { ...response.data, type: "dataset" } };
  }

  /** Retrieves a record and verifies that Geonorge identifies it as a service. */
  async getService(
    id: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeServiceMetadata>> {
    const response = await this.getMetadata(id, options);
    if (response.data.type !== "service") {
      throw new ResponseValidationError(
        `Geonorge metadata ${id} is ${response.data.type}, not a service.`,
        { provider: geonorgeProvider.id },
      );
    }
    return { ...response, data: { ...response.data, type: "service" } };
  }

  async #search(
    type: "dataset",
    parameters: GeonorgeSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeSearchResult<GeonorgeDatasetSummary>>>;
  async #search(
    type: "service",
    parameters: GeonorgeSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeSearchResult<GeonorgeServiceSummary>>>;
  async #search(
    type: SearchType,
    parameters: GeonorgeSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<GeonorgeSearchResult<SearchSummary>>> {
    const parsed = searchInputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Geonorge catalogue search.", {
        provider: geonorgeProvider.id,
        cause: parsed.error,
      });
    }
    const offset = parsed.data.offset ?? 0;
    const limit = Math.min(parsed.data.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const upstreamOffset = offset + 1;
    const result = await this.#http.request({
      provider: geonorgeProvider,
      url: `${BASE_URL}/search`,
      query: searchQuery(type, parsed.data, offset, limit),
      headers: { "Accept-Language": "nb-NO" },
      schema: geonorgeSearchResponseSchema,
      transform: (response) => {
        assertSearchContract(response, type, upstreamOffset, limit);
        return response;
      },
      options,
      cacheTtlMs: geonorgeProvider.cacheTtlMs.search,
    });
    assertSearchContract(result.data, type, upstreamOffset, limit);
    const items: SearchSummary[] =
      type === "dataset"
        ? (result.data.Results ?? []).map((hit) => normalizeSearchHit(hit, "dataset"))
        : (result.data.Results ?? []).map((hit) => normalizeSearchHit(hit, "service"));
    const hasMore = offset + items.length < result.data.NumFound;
    return createResponse(
      {
        items,
        pagination: {
          offset,
          limit,
          returned: items.length,
          totalItems: result.data.NumFound,
          hasMore,
          truncated: hasMore,
        },
      },
      responseSource(geonorgeProvider),
      result.data,
      result.cached,
      options,
    );
  }

  async *#searchAll(
    type: SearchType,
    parameters: GeonorgeSearchParameters,
    options: RequestOptions & PaginateOptions,
  ): AsyncGenerator<SearchSummary, void, undefined> {
    const { maxItems, maxPages } = resolvePaginateOptions(options);
    if (maxItems === 0) return;
    let offset = parameters.offset ?? 0;
    let emitted = 0;
    const pageSignatures = new Set<string>();
    const seenIds = new Set<string>();
    for (let request = 0; request < maxPages; request += 1) {
      const response =
        type === "dataset"
          ? await this.searchDatasets({ ...parameters, offset }, options)
          : await this.searchServices({ ...parameters, offset }, options);
      const items: SearchSummary[] = response.data.items;
      if (items.length === 0) return;
      const signature = items.map((item) => item.id).join("\u0000");
      if (pageSignatures.has(signature)) {
        throw new ResponseValidationError(
          "Geonorge returned a repeated result page; pagination stopped before yielding duplicates.",
          { provider: geonorgeProvider.id },
        );
      }
      pageSignatures.add(signature);
      for (const item of items) {
        if (seenIds.has(item.id)) {
          throw new ResponseValidationError(
            "Geonorge returned an overlapping result page; pagination stopped before yielding duplicates.",
            { provider: geonorgeProvider.id },
          );
        }
        seenIds.add(item.id);
        yield item;
        emitted += 1;
        if (maxItems !== undefined && emitted >= maxItems) return;
      }
      if (!response.data.pagination.hasMore) return;
      offset += items.length;
    }
  }
}
