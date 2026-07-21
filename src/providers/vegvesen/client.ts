import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import {
  ConfigurationError,
  InputValidationError,
  ResponseValidationError,
} from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import { paginateCursor, type PaginateOptions } from "../../core/paginate.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  roadNetworkResponseSchema,
  roadObjectSchema,
  roadObjectSearchResponseSchema,
  roadObjectTypeListSchema,
  roadObjectTypeSchema,
  type RawRoadNetworkResponse,
  type RawRoadNetworkSegment,
  type RawRoadObject,
  type RawRoadObjectSearchResponse,
  type RawRoadObjectType,
} from "./schemas.js";
import type {
  RoadGeometry,
  RoadNetworkParameters,
  RoadNetworkResult,
  RoadNetworkSegment,
  RoadObject,
  RoadObjectLocation,
  RoadObjectSearchParameters,
  RoadObjectSearchResult,
  RoadObjectType,
  RoadPagination,
} from "./types.js";

const BASE_URL = "https://nvdbapiles.atlas.vegvesen.no";
const TYPE_METADATA_TTL_MS = 24 * 60 * 60 * 1_000;
const ROAD_DATA_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_PAGE_SIZE = 100;

// Current sensitive types in the public NVDB V4 data catalogue. Anonymous SDK
// methods deliberately do not attempt authentication or expose these resources.
const DOCUMENTED_SENSITIVE_TYPE_IDS = new Set([562, 793, 871, 890, 892, 894, 895, 901, 903, 905]);

const positiveIdSchema = z.number().int().positive();
const municipalityCodeSchema = z
  .string()
  .regex(/^\d{4}$/, "Expected a four-digit municipality code.");
const countyCodeSchema = z.string().regex(/^\d{2}$/, "Expected a two-digit county code.");
const boundingBoxSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([minLongitude, minLatitude, maxLongitude, maxLatitude]) => {
    return minLongitude < maxLongitude && minLatitude < maxLatitude;
  }, "The bounding box minimums must be smaller than its maximums.");

const roadObjectSearchParametersSchema = z.object({
  typeId: positiveIdSchema,
  municipalityCode: municipalityCodeSchema.optional(),
  countyCode: countyCodeSchema.optional(),
  roadReference: z.string().trim().min(1).optional(),
  boundingBox: boundingBoxSchema.optional(),
  pageSize: z.number().int().positive().optional(),
  start: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0)
    .optional(),
});

const roadNetworkParametersSchema = z.object({
  municipalityCode: municipalityCodeSchema.optional(),
  countyCode: countyCodeSchema.optional(),
  boundingBox: boundingBoxSchema.optional(),
  roadCategory: z
    .array(z.enum(["E", "R", "F", "K", "P", "S"]))
    .min(1)
    .optional(),
  pageSize: z.number().int().positive().optional(),
  start: z
    .string()
    .min(1)
    .refine((value) => value.trim().length > 0)
    .optional(),
});

function normalizeGeometry(
  raw:
    | {
        wkt?: string;
        geojson?: unknown;
        geoJson?: unknown;
      }
    | undefined,
): RoadGeometry | undefined {
  if (raw === undefined) return undefined;
  const hasGeoJson = raw.geojson !== undefined || raw.geoJson !== undefined;
  if (raw.wkt === undefined && !hasGeoJson) return undefined;
  return {
    ...(raw.wkt === undefined ? {} : { wkt: raw.wkt }),
    ...(hasGeoJson ? { geoJson: raw.geojson ?? raw.geoJson } : {}),
  };
}

function normalizeCode(value: string | number, width: number): string {
  return String(value).padStart(width, "0");
}

function normalizeRoadObjectLocation(raw: RawRoadObject): RoadObjectLocation | undefined {
  const municipalityCodes = raw.lokasjon?.kommuner?.map((value) => normalizeCode(value, 4)) ?? [];
  const countyCodes = raw.lokasjon?.fylker?.map((value) => normalizeCode(value, 2)) ?? [];
  const roadReferences =
    raw.lokasjon?.vegsystemreferanser?.flatMap((reference) =>
      reference.kortform === undefined ? [] : [reference.kortform],
    ) ?? [];
  const geometry = normalizeGeometry(raw.geometri ?? raw.lokasjon?.geometri);
  if (
    municipalityCodes.length === 0 &&
    countyCodes.length === 0 &&
    roadReferences.length === 0 &&
    geometry === undefined
  ) {
    return undefined;
  }
  return {
    ...(municipalityCodes.length === 0 ? {} : { municipalityCodes }),
    ...(countyCodes.length === 0 ? {} : { countyCodes }),
    ...(roadReferences.length === 0 ? {} : { roadReferences }),
    ...(geometry === undefined ? {} : { geometry }),
  };
}

/** Converts a validated provider-native road object to the SDK's stable shape. */
export function normalizeRoadObject(raw: RawRoadObject): RoadObject {
  const location = normalizeRoadObjectLocation(raw);
  return {
    id: raw.id,
    typeId: raw.metadata.type.id,
    ...(raw.metadata.type.navn === undefined ? {} : { typeName: raw.metadata.type.navn }),
    ...(raw.metadata.versjon === undefined ? {} : { version: raw.metadata.versjon }),
    properties: raw.egenskaper
      .filter((property) => (property.sensitivitet ?? 0) === 0 && property.sensitiv !== true)
      .map((property) => {
        const value = Object.hasOwn(property, "verdi")
          ? property.verdi
          : Object.hasOwn(property, "innhold")
            ? property.innhold
            : null;
        const unit = property.enhet?.kortnavn ?? property.enhet?.navn;
        return {
          ...(property.id === undefined ? {} : { id: property.id }),
          name: property.navn,
          value,
          ...(unit === undefined ? {} : { unit }),
        };
      }),
    ...(location === undefined ? {} : { location }),
  };
}

function normalizeRoadObjectType(raw: RawRoadObjectType): RoadObjectType {
  return {
    id: raw.id,
    name: raw.navn,
    ...(raw.kortnavn == null ? {} : { shortName: raw.kortnavn }),
    ...(raw.beskrivelse == null ? {} : { description: raw.beskrivelse }),
    ...(raw.status == null ? {} : { status: raw.status }),
    categories: (raw.kategorier ?? []).map((category) => category.navn),
    properties: (raw.egenskapstyper ?? [])
      .filter((property) => (property.sensitivitet ?? 0) === 0)
      .map((property) => {
        const unit = property.enhet?.kortnavn ?? property.enhet?.navn;
        return {
          id: property.id,
          name: property.navn,
          ...(property.beskrivelse == null ? {} : { description: property.beskrivelse }),
          ...(property.egenskapstype === undefined ? {} : { valueType: property.egenskapstype }),
          ...(property.obligatorisk_verdi === undefined
            ? {}
            : { required: property.obligatorisk_verdi }),
          ...(unit === undefined ? {} : { unit }),
        };
      }),
    sensitive: false,
  };
}

function sanitizeRoadObjectType(raw: RawRoadObjectType): RawRoadObjectType {
  return {
    ...raw,
    ...(raw.egenskapstyper === undefined
      ? {}
      : {
          egenskapstyper: raw.egenskapstyper.filter(
            (property) => (property.sensitivitet ?? 0) === 0,
          ),
        }),
  };
}

function isBlockedTypeId(typeId: number): boolean {
  return DOCUMENTED_SENSITIVE_TYPE_IDS.has(typeId);
}

function sanitizeRoadObject(raw: RawRoadObject, expectedTypeId: number): RawRoadObject {
  if (raw.metadata.type.id !== expectedTypeId || isBlockedTypeId(raw.metadata.type.id)) {
    throw new ResponseValidationError("NVDB returned a blocked or unexpected road-object type.", {
      provider: "vegvesen",
    });
  }
  return {
    ...raw,
    egenskaper: raw.egenskaper.filter(
      (property) => (property.sensitivitet ?? 0) === 0 && property.sensitiv !== true,
    ),
  };
}

function normalizePagination(raw: RawRoadObjectSearchResponse["metadata"]): RoadPagination {
  const next = raw.returnert === 0 ? undefined : (raw.neste ?? undefined);
  return {
    returned: raw.returnert,
    pageSize: raw.sidestørrelse,
    ...(raw.antall === undefined ? {} : { totalItems: raw.antall }),
    ...(next === undefined ? {} : { nextStart: next.start, nextUrl: next.href }),
  };
}

function normalizeRoadObjectSearch(raw: RawRoadObjectSearchResponse): RoadObjectSearchResult {
  return {
    items: raw.objekter.map(normalizeRoadObject),
    pagination: normalizePagination(raw.metadata),
  };
}

function normalizeNetworkSegment(raw: RawRoadNetworkSegment): RoadNetworkSegment {
  const geometry = normalizeGeometry(raw.geometri);
  return {
    sequenceId: raw.veglenkesekvensid,
    ...(raw.veglenkenummer === undefined ? {} : { linkNumber: raw.veglenkenummer }),
    ...(raw.segmentnummer === undefined ? {} : { segmentNumber: raw.segmentnummer }),
    ...(raw.startposisjon === undefined ? {} : { startPosition: raw.startposisjon }),
    ...(raw.sluttposisjon === undefined ? {} : { endPosition: raw.sluttposisjon }),
    ...(raw.lengde === undefined ? {} : { length: raw.lengde }),
    ...(raw.typeVeg === undefined ? {} : { roadType: raw.typeVeg }),
    ...(raw.detaljnivå === undefined ? {} : { detailLevel: raw.detaljnivå }),
    ...(raw.kommune === undefined ? {} : { municipalityCode: normalizeCode(raw.kommune, 4) }),
    ...(raw.fylke === undefined ? {} : { countyCode: normalizeCode(raw.fylke, 2) }),
    ...(raw.vegsystemreferanse?.kortform === undefined
      ? {}
      : { roadReference: raw.vegsystemreferanse.kortform }),
    ...(geometry === undefined ? {} : { geometry }),
  };
}

function normalizeRoadNetwork(raw: RawRoadNetworkResponse): RoadNetworkResult {
  return {
    items: raw.objekter.map(normalizeNetworkSegment),
    pagination: normalizePagination(raw.metadata),
  };
}

function assertPublicTypeId(typeId: number): void {
  if (DOCUMENTED_SENSITIVE_TYPE_IDS.has(typeId)) {
    throw new InputValidationError(
      `NVDB road-object type ${typeId} is sensitive and is not supported by this SDK.`,
      { provider: "vegvesen" },
    );
  }
}

/** Client for anonymous public reads from Statens vegvesen's NVDB API Les V4. */
export class VegvesenClient {
  readonly #http: HttpClient;
  readonly #applicationName?: string;

  /** @internal */
  constructor(http: HttpClient, applicationName?: string) {
    this.#http = http;
    this.#applicationName = applicationName;
  }

  /** Lists public road-object types from the current NVDB data catalogue. */
  async getRoadObjectTypes(options?: RequestOptions): Promise<OpenDataResponse<RoadObjectType[]>> {
    const headers = this.#headers();
    const result = await this.#http.request({
      provider: "vegvesen",
      url: `${BASE_URL}/datakatalog/api/v1/vegobjekttyper`,
      query: { inkluder: "minimum" },
      headers,
      schema: roadObjectTypeListSchema,
      transform: (data) =>
        data
          .filter((type) => !type.sensitiv && !isBlockedTypeId(type.id))
          .map(sanitizeRoadObjectType),
      options,
      cacheTtlMs: TYPE_METADATA_TTL_MS,
    });
    const publicTypes = result.data;
    return createResponse(
      publicTypes.map(normalizeRoadObjectType),
      responseSource(providers.vegvesen),
      publicTypes,
      result.cached,
      options,
    );
  }

  /** Gets full public metadata for one road-object type. */
  async getRoadObjectType(
    typeId: number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<RoadObjectType>> {
    const headers = this.#headers();
    const parsedTypeId = this.#parseId(typeId, "road-object type ID");
    assertPublicTypeId(parsedTypeId);
    const result = await this.#http.request({
      provider: "vegvesen",
      url: `${BASE_URL}/datakatalog/api/v1/vegobjekttyper/${parsedTypeId}`,
      query: { inkluder: "alle" },
      headers,
      schema: roadObjectTypeSchema,
      transform: (data) => {
        if (data.id !== parsedTypeId || data.sensitiv || isBlockedTypeId(data.id)) {
          throw new ResponseValidationError(
            "NVDB returned blocked or unexpected road-object type metadata.",
            { provider: "vegvesen" },
          );
        }
        return sanitizeRoadObjectType(data);
      },
      options,
      cacheTtlMs: TYPE_METADATA_TTL_MS,
    });
    const publicType = result.data;
    return createResponse(
      normalizeRoadObjectType(publicType),
      responseSource(providers.vegvesen),
      publicType,
      result.cached,
      options,
    );
  }

  /** Searches public road objects and returns NVDB's opaque continuation marker. */
  async searchRoadObjects(
    parameters: RoadObjectSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<RoadObjectSearchResult>> {
    const headers = this.#headers();
    const parsed = roadObjectSearchParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid NVDB road-object search parameters.", {
        provider: "vegvesen",
        cause: parsed.error,
      });
    }
    assertPublicTypeId(parsed.data.typeId);
    const result = await this.#http.request({
      provider: "vegvesen",
      url: `${BASE_URL}/vegobjekter/api/v4/vegobjekter/${parsed.data.typeId}`,
      query: {
        kommune: parsed.data.municipalityCode,
        fylke: parsed.data.countyCode,
        vegsystemreferanse: parsed.data.roadReference,
        kartutsnitt: parsed.data.boundingBox?.join(","),
        antall: parsed.data.pageSize ?? DEFAULT_PAGE_SIZE,
        start: parsed.data.start,
        inkluder: ["metadata", "egenskaper", "lokasjon", "geometri"],
        inkluderAntall: false,
        srid: 4326,
      },
      headers,
      schema: roadObjectSearchResponseSchema,
      transform: (data) => ({
        ...data,
        objekter: data.objekter.map((object) => sanitizeRoadObject(object, parsed.data.typeId)),
      }),
      options,
      cacheTtlMs: ROAD_DATA_TTL_MS,
    });
    return createResponse(
      normalizeRoadObjectSearch(result.data),
      responseSource(providers.vegvesen),
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets one current public road object by type ID and object ID. */
  async getRoadObject(
    typeId: number,
    objectId: number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<RoadObject>> {
    const headers = this.#headers();
    const parsedTypeId = this.#parseId(typeId, "road-object type ID");
    const parsedObjectId = this.#parseId(objectId, "road-object ID");
    assertPublicTypeId(parsedTypeId);
    const result = await this.#http.request({
      provider: "vegvesen",
      url: `${BASE_URL}/vegobjekter/api/v4/vegobjekter/${parsedTypeId}/${parsedObjectId}`,
      query: {
        inkluder: ["metadata", "egenskaper", "lokasjon", "geometri"],
        srid: 4326,
      },
      headers,
      schema: roadObjectSchema,
      transform: (data) => {
        if (data.id !== parsedObjectId) {
          throw new ResponseValidationError(
            "NVDB returned a different road object than requested.",
            {
              provider: "vegvesen",
            },
          );
        }
        return sanitizeRoadObject(data, parsedTypeId);
      },
      options,
      cacheTtlMs: ROAD_DATA_TTL_MS,
    });
    return createResponse(
      normalizeRoadObject(result.data),
      responseSource(providers.vegvesen),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Iterates every matching public road object, following NVDB's continuation
   * marker. Bounded by `maxItems` and `maxPages`.
   */
  async *searchRoadObjectsAll(
    parameters: RoadObjectSearchParameters,
    options?: RequestOptions & PaginateOptions,
  ): AsyncGenerator<RoadObject, void, undefined> {
    yield* paginateCursor(
      async (cursor) => {
        const result = await this.searchRoadObjects(
          { ...parameters, ...(cursor === undefined ? {} : { start: cursor }) },
          options,
        );
        const next = result.data.pagination.nextStart;
        return {
          items: result.data.items,
          ...(next === undefined ? {} : { nextCursor: next }),
        };
      },
      parameters.start,
      options ?? {},
      "vegvesen",
    );
  }

  /**
   * Iterates every matching segment of the public road network, following
   * NVDB's continuation marker. Bounded by `maxItems` and `maxPages`.
   */
  async *getRoadNetworkAll(
    parameters: RoadNetworkParameters = {},
    options?: RequestOptions & PaginateOptions,
  ): AsyncGenerator<RoadNetworkSegment, void, undefined> {
    yield* paginateCursor(
      async (cursor) => {
        const result = await this.getRoadNetwork(
          { ...parameters, ...(cursor === undefined ? {} : { start: cursor }) },
          options,
        );
        const next = result.data.pagination.nextStart;
        return {
          items: result.data.items,
          ...(next === undefined ? {} : { nextCursor: next }),
        };
      },
      parameters.start,
      options ?? {},
      "vegvesen",
    );
  }

  /** Reads one page of the public segmented road network. */
  async getRoadNetwork(
    parameters: RoadNetworkParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<RoadNetworkResult>> {
    const headers = this.#headers();
    const parsed = roadNetworkParametersSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid NVDB road-network parameters.", {
        provider: "vegvesen",
        cause: parsed.error,
      });
    }
    const roadReferences = parsed.data.roadCategory?.map((category) => `${category}V`).join(",");
    const result = await this.#http.request({
      provider: "vegvesen",
      url: `${BASE_URL}/vegnett/api/v4/veglenkesekvenser/segmentert`,
      query: {
        kommune: parsed.data.municipalityCode,
        fylke: parsed.data.countyCode,
        kartutsnitt: parsed.data.boundingBox?.join(","),
        vegsystemreferanse: roadReferences,
        antall: parsed.data.pageSize ?? DEFAULT_PAGE_SIZE,
        start: parsed.data.start,
        inkluderAntall: false,
        srid: 4326,
      },
      headers,
      schema: roadNetworkResponseSchema,
      options,
      cacheTtlMs: ROAD_DATA_TTL_MS,
    });
    return createResponse(
      normalizeRoadNetwork(result.data),
      responseSource(providers.vegvesen),
      result.data,
      result.cached,
      options,
    );
  }

  #headers(): { "X-Client": string } {
    if (this.#applicationName === undefined || this.#applicationName.trim().length === 0) {
      throw new ConfigurationError(
        "Statens vegvesen requests require applicationName for the mandatory X-Client header.",
        { provider: "vegvesen" },
      );
    }
    return { "X-Client": this.#applicationName };
  }

  #parseId(value: number, label: string): number {
    const parsed = positiveIdSchema.safeParse(value);
    if (!parsed.success) {
      throw new InputValidationError(`Invalid NVDB ${label}.`, {
        provider: "vegvesen",
        cause: parsed.error,
      });
    }
    return parsed.data;
  }
}
