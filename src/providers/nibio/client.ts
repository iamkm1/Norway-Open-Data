import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import {
  collectFeaturePage,
  iterateFeaturePages,
  type FeaturePageBatch,
  type FeaturePageFetcher,
  type FeaturePageRequest,
} from "../../core/feature-page.js";
import { parseBoundingBox, parseCoordinates } from "../../core/geo.js";
import { ResponseValidationError } from "../../core/errors.js";
import type { GeoJsonCrsMetadata } from "../../core/geojson.js";
import { responseSource } from "../../core/provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { parseAr50Gml } from "./gml.js";
import { nibioProvider } from "./provider.js";
import type {
  LandResourceBoundingBoxQuery,
  LandResourceFeature,
  LandResourcePointQuery,
  LandResourceResult,
  NibioFeatureQueryOptions,
} from "./types.js";

const AR50_URL = "https://wfs.nibio.no/cgi-bin/ar50_2";
const DEFAULT_LIMIT = 100;
const AR50_PROPERTIES = [
  "msGeometry",
  "lokalid",
  "objtype",
  "arealtype",
  "skogbonitet",
  "treslag",
  "jordbruk",
  "vegetasjonsdekke",
  "informasjon",
  "navnerom",
  "oppdateringsdato",
].join(",");

const NIBIO_SOURCE_CRS = {
  identifier: "EPSG:4258",
  uri: "http://www.opengis.net/def/crs/EPSG/0/4258",
  axisOrder: "latitude-longitude",
} as const;

const xmlResponseSchema = z.string().trim().min(1);

type SpatialInput =
  | { kind: "point"; latitude: number; longitude: number }
  | {
      kind: "bounding-box";
      south: number;
      west: number;
      north: number;
      east: number;
    };

type PageContext = {
  raw: string[];
  cached: boolean[];
  crs?: GeoJsonCrsMetadata;
};

function pointInput(query: LandResourcePointQuery): SpatialInput {
  const point = parseCoordinates(query, nibioProvider.id);
  return { kind: "point", ...point };
}

function boundingBoxInput(query: LandResourceBoundingBoxQuery): SpatialInput {
  const box = parseBoundingBox(query.boundingBox, nibioProvider.id);
  return { kind: "bounding-box", ...box };
}

function spatialInput(query: LandResourcePointQuery | LandResourceBoundingBoxQuery): SpatialInput {
  return "boundingBox" in query ? boundingBoxInput(query) : pointInput(query);
}

function xmlPoint(input: Extract<SpatialInput, { kind: "point" }>): string {
  return `<gml:Point gml:id="point" srsName="urn:ogc:def:crs:OGC:1.3:CRS84"><gml:pos>${input.longitude} ${input.latitude}</gml:pos></gml:Point>`;
}

function xmlBoundingBox(input: Extract<SpatialInput, { kind: "bounding-box" }>): string {
  const positions = [
    `${input.west} ${input.south}`,
    `${input.east} ${input.south}`,
    `${input.east} ${input.north}`,
    `${input.west} ${input.north}`,
    `${input.west} ${input.south}`,
  ].join(" ");
  return `<gml:Polygon gml:id="bounding-box" srsName="urn:ogc:def:crs:OGC:1.3:CRS84"><gml:exterior><gml:LinearRing><gml:posList srsDimension="2">${positions}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon>`;
}

function spatialFilter(input: SpatialInput): string {
  const geometry = input.kind === "point" ? xmlPoint(input) : xmlBoundingBox(input);
  return `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:Intersects><fes:ValueReference>msGeometry</fes:ValueReference>${geometry}</fes:Intersects></fes:Filter>`;
}

function queryOptions(query: NibioFeatureQueryOptions): {
  limit: number;
  pageSize?: number;
  maxPages?: number;
  startOffset?: number;
} {
  return {
    limit: query.limit ?? DEFAULT_LIMIT,
    ...(query.pageSize === undefined ? {} : { pageSize: query.pageSize }),
    ...(query.maxPages === undefined ? {} : { maxPages: query.maxPages }),
    ...(query.offset === undefined ? {} : { startOffset: query.offset }),
  };
}

function pageRaw(raw: readonly string[]): unknown {
  return raw.length === 1 ? raw[0] : [...raw];
}

function pageKey(features: readonly LandResourceFeature[]): string {
  return features
    .map((feature) => String(feature.id))
    .sort()
    .join("\u001e");
}

/** Client for NIBIO's openly accessible, generalized AR50 land-resource WFS. */
export class NibioClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  #fetcher(
    spatial: SpatialInput,
    context: PageContext,
    options?: RequestOptions,
  ): FeaturePageFetcher<LandResourceFeature> {
    const filter = spatialFilter(spatial);
    return async (page: FeaturePageRequest): Promise<FeaturePageBatch<LandResourceFeature>> => {
      const result = await this.#http.request({
        provider: nibioProvider,
        url: AR50_URL,
        query: {
          SERVICE: "WFS",
          VERSION: "2.0.0",
          REQUEST: "GetFeature",
          TYPENAMES: "ms:AR50",
          PROPERTYNAME: AR50_PROPERTIES,
          OUTPUTFORMAT: "application/gml+xml; version=3.2",
          SRSNAME: "EPSG:4326",
          COUNT: page.pageSize,
          STARTINDEX: page.offset,
          SORTBY: "lokalid",
          FILTER: filter,
        },
        responseType: "text",
        schema: xmlResponseSchema,
        options,
        cacheTtlMs: nibioProvider.cacheTtlMs.landResource,
      });
      const parsed = parseAr50Gml(result.data);
      if (context.crs !== undefined && context.crs.identifier !== parsed.crs.identifier) {
        throw new ResponseValidationError(
          "NIBIO changed CRS declarations between AR50 feature pages.",
          { provider: nibioProvider.id },
        );
      }
      context.crs ??= parsed.crs;
      context.raw.push(result.data);
      context.cached.push(result.cached);

      if (
        typeof parsed.numberMatched === "number" &&
        page.offset + parsed.features.length > parsed.numberMatched
      ) {
        throw new ResponseValidationError(
          "NIBIO returned more AR50 features than numberMatched permits.",
          { provider: nibioProvider.id },
        );
      }
      const hasMore =
        typeof parsed.numberMatched === "number"
          ? page.offset + parsed.features.length < parsed.numberMatched
          : parsed.features.length === page.pageSize;
      if (parsed.features.length === 0 && hasMore) {
        throw new ResponseValidationError(
          "NIBIO reported more AR50 features after an empty page.",
          { provider: nibioProvider.id },
        );
      }
      return { features: parsed.features, hasMore };
    };
  }

  async #collect(
    query: LandResourcePointQuery | LandResourceBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<LandResourceResult>> {
    const context: PageContext = { raw: [], cached: [] };
    const bounded = await collectFeaturePage(this.#fetcher(spatialInput(query), context, options), {
      ...queryOptions(query),
      signal: options?.signal,
      provider: nibioProvider.id,
      pageKey,
    });
    return createResponse(
      {
        type: "FeatureCollection",
        features: bounded.features,
        crs: context.crs ?? {
          identifier: "EPSG:4326",
          uri: "http://www.opengis.net/def/crs/EPSG/0/4326",
          axisOrder: "longitude-latitude",
          declared: true,
          original: "EPSG:4326",
        },
        sourceCrs: NIBIO_SOURCE_CRS,
        pagination: bounded.pagination,
      },
      responseSource(nibioProvider),
      pageRaw(context.raw),
      context.cached.length > 0 && context.cached.every(Boolean),
      options,
    );
  }

  /** Returns generalized AR50 land-resource classifications at a WGS84 point. */
  async getLandResourcesAt(
    query: LandResourcePointQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<LandResourceResult>> {
    return this.#collect(query, options);
  }

  /** Searches generalized AR50 polygons intersecting a WGS84 bounding box. */
  async searchLandResources(
    query: LandResourceBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<LandResourceResult>> {
    return this.#collect(query, options);
  }

  /** Lazily iterates bounded AR50 pages for a point or bounding box. */
  async *iterateLandResources(
    query: LandResourcePointQuery | LandResourceBoundingBoxQuery,
    options?: RequestOptions,
  ): AsyncGenerator<LandResourceFeature, void, undefined> {
    const context: PageContext = { raw: [], cached: [] };
    const pages = iterateFeaturePages(this.#fetcher(spatialInput(query), context, options), {
      ...queryOptions(query),
      signal: options?.signal,
      provider: nibioProvider.id,
      pageKey,
    });
    for await (const page of pages) yield* page.features;
  }
}
