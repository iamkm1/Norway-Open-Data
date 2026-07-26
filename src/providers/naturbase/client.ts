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
import {
  resolveGeoJsonCrs,
  type GeoJsonCrsDeclaration,
  type GeoJsonCrsMetadata,
} from "../../core/geojson.js";
import { ResponseValidationError } from "../../core/errors.js";
import { responseSource, type OpenDataSource } from "../../core/provider.js";
import type { OpenDataResponse, QueryParameters, RequestOptions } from "../../core/types.js";
import { naturbaseProvider } from "./provider.js";
import {
  interventionFreeAreaResponseSchema,
  natureTypeResponseSchema,
  proposedProtectedAreaResponseSchema,
  protectedAreaResponseSchema,
  type RawInterventionFreeAreaResponse,
  type RawNatureTypeResponse,
  type RawProposedProtectedAreaResponse,
  type RawProtectedAreaResponse,
} from "./schemas.js";
import type {
  InterventionFreeAreaFeature,
  InterventionFreeAreaProperties,
  NatureTypeFeature,
  NaturbaseBoundingBoxQuery,
  NaturbaseFeatureQueryOptions,
  NaturbaseFeatureResult,
  NaturbasePointQuery,
  ProposedProtectedAreaFeature,
  ProtectedAreaFeature,
} from "./types.js";

const ARCGIS_ROOT = "https://kart.miljodirektoratet.no/arcgis/rest/services";
const INTERVENTION_FREE_URL = "https://kart.miljodirektoratet.no/geoserver/inngrepsfrinatur/ows";
const DEFAULT_LIMIT = 100;

const NATURBASE_SOURCE_CRS = {
  identifier: "EPSG:25833",
  uri: "http://www.opengis.net/def/crs/EPSG/0/25833",
  axisOrder: "easting-northing",
} as const;

const INTERVENTION_FREE_SOURCE: OpenDataSource = {
  ...responseSource(naturbaseProvider),
  license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
  attribution: "Miljødirektoratet - inngrepsfri natur 01.2023",
};

const PROTECTED_FIELDS = [
  "OBJECTID",
  "naturvernId",
  "cddaId",
  "navn",
  "offisieltNavn",
  "faktaark",
  "verneform",
  "verneformAggregert",
  "verneforskrift",
  "vernedato",
  "foerstegangVernet",
  "verneplan",
  "kommune",
  "forvaltningsmyndighet",
  "forvaltningsmyndighetType",
  "iucn",
  "revisjon",
  "truetVurdering",
  "majorEcosystemType",
].join(",");

const PROPOSED_FIELDS = [
  "OBJECTID",
  "foreslattVernId",
  "navn",
  "verneform",
  "verneplan",
  "kommune",
  "faktaark",
  "objekttype",
  "datafangstdato",
  "maalemetode",
  "noeyaktighet",
].join(",");

const NATURE_TYPE_FIELDS = [
  "OBJECTID",
  "NiNID",
  "Områdenavn",
  "Kommuner",
  "Naturtype",
  "Naturtypekode",
  "Lokalitetskvalitet",
  "Tilstand",
  "Tilstandbeskrivelse",
  "Naturmangfold",
  "Naturmangfoldbeskrivelse",
  "Hovedøkosystem",
  "Mosaikk",
  "Nøyaktighet",
  "Usikkerhet",
  "Usikkerhetsbeskrivelse",
  "Kartleggingsdato",
  "Kartleggingsår",
  "Oppdragsgiver",
  "Kartlegger",
  "Oppdragstaker",
  "Kartleggingsinstruks",
  "Prosjektnavn",
  "NiNKartleggingsenheter",
  "NiNBeskrivelsesvariabler",
  "Faktaark",
  "UK_Truet",
  "UK_NærTruet",
  "UK_SpesieltDårligKartlagt",
  "UK_SentralØkosystemFunksjon",
  "UK_SeBekrivelseNaturtype",
  "UK_IngenStatus",
].join(",");

type ArcGisCollection = {
  features: unknown[];
  crs?: GeoJsonCrsDeclaration | null;
  exceededTransferLimit?: boolean;
};

type ArcGisCollectionFeature<Response extends ArcGisCollection> = Response["features"][number];

type ArcGisLayer<Response extends ArcGisCollection, Feature> = {
  url: string;
  fields: string;
  schema: z.ZodType<Response>;
  cacheTtlMs: number;
  normalize: (feature: ArcGisCollectionFeature<Response>) => Feature;
};

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
  raw: unknown[];
  cached: boolean[];
  crs?: GeoJsonCrsMetadata;
};

function optionalString(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function optionalNumber(value: number | null | undefined): number | undefined {
  if (value == null) return undefined;
  return value;
}

function optionalBoolean(value: number | null | undefined): boolean | undefined {
  if (value == null) return undefined;
  return value === 1;
}

function epochToIso(value: number | null | undefined, field: string): string | undefined {
  if (value == null) return undefined;
  try {
    return new Date(value).toISOString();
  } catch (cause) {
    throw new ResponseValidationError(
      `Naturbase returned an invalid epoch timestamp in ${field}.`,
      { provider: naturbaseProvider.id, cause },
    );
  }
}

function verifyArcGisObjectId(featureId: string | number, objectId: number): void {
  if (String(featureId) !== String(objectId)) {
    throw new ResponseValidationError(
      "Naturbase returned a GeoJSON feature ID that does not match OBJECTID.",
      { provider: naturbaseProvider.id },
    );
  }
}

function normalizeProtectedArea(
  feature: RawProtectedAreaResponse["features"][number],
): ProtectedAreaFeature {
  const properties = feature.properties;
  verifyArcGisObjectId(feature.id, properties.OBJECTID);
  return {
    type: "Feature",
    id: properties.naturvernId,
    geometry: feature.geometry,
    properties: {
      id: properties.naturvernId,
      ...(optionalString(properties.cddaId) === undefined
        ? {}
        : { cddaId: optionalString(properties.cddaId) }),
      ...(optionalString(properties.navn) === undefined
        ? {}
        : { name: optionalString(properties.navn) }),
      ...(optionalString(properties.offisieltNavn) === undefined
        ? {}
        : { officialName: optionalString(properties.offisieltNavn) }),
      ...(optionalString(properties.faktaark) === undefined
        ? {}
        : { factSheetUrl: optionalString(properties.faktaark) }),
      ...(optionalString(properties.verneform) === undefined
        ? {}
        : { protectionForm: optionalString(properties.verneform) }),
      ...(optionalString(properties.verneformAggregert) === undefined
        ? {}
        : {
            aggregatedProtectionForm: optionalString(properties.verneformAggregert),
          }),
      ...(optionalString(properties.verneforskrift) === undefined
        ? {}
        : { regulationUrl: optionalString(properties.verneforskrift) }),
      ...(epochToIso(properties.vernedato, "vernedato") === undefined
        ? {}
        : { protectedAt: epochToIso(properties.vernedato, "vernedato") }),
      ...(epochToIso(properties.foerstegangVernet, "foerstegangVernet") === undefined
        ? {}
        : {
            firstProtectedAt: epochToIso(properties.foerstegangVernet, "foerstegangVernet"),
          }),
      ...(optionalString(properties.verneplan) === undefined
        ? {}
        : { protectionPlan: optionalString(properties.verneplan) }),
      ...(optionalString(properties.kommune) === undefined
        ? {}
        : { municipality: optionalString(properties.kommune) }),
      ...(optionalString(properties.forvaltningsmyndighet) === undefined
        ? {}
        : {
            managementAuthority: optionalString(properties.forvaltningsmyndighet),
          }),
      ...(optionalString(properties.forvaltningsmyndighetType) === undefined
        ? {}
        : {
            managementAuthorityType: optionalString(properties.forvaltningsmyndighetType),
          }),
      ...(optionalString(properties.iucn) === undefined
        ? {}
        : { iucnCategory: optionalString(properties.iucn) }),
      ...(optionalString(properties.revisjon) === undefined
        ? {}
        : { revisionStatus: optionalString(properties.revisjon) }),
      ...(optionalString(properties.truetVurdering) === undefined
        ? {}
        : { threatAssessment: optionalString(properties.truetVurdering) }),
      ...(optionalString(properties.majorEcosystemType) === undefined
        ? {}
        : { majorEcosystemType: optionalString(properties.majorEcosystemType) }),
    },
  };
}

function normalizeProposedProtectedArea(
  feature: RawProposedProtectedAreaResponse["features"][number],
): ProposedProtectedAreaFeature {
  const properties = feature.properties;
  verifyArcGisObjectId(feature.id, properties.OBJECTID);
  return {
    type: "Feature",
    id: properties.foreslattVernId,
    geometry: feature.geometry,
    properties: {
      id: properties.foreslattVernId,
      ...(optionalString(properties.navn) === undefined
        ? {}
        : { name: optionalString(properties.navn) }),
      ...(optionalString(properties.verneform) === undefined
        ? {}
        : { protectionForm: optionalString(properties.verneform) }),
      ...(optionalString(properties.verneplan) === undefined
        ? {}
        : { protectionPlan: optionalString(properties.verneplan) }),
      ...(optionalString(properties.kommune) === undefined
        ? {}
        : { municipality: optionalString(properties.kommune) }),
      ...(optionalString(properties.faktaark) === undefined
        ? {}
        : { factSheetUrl: optionalString(properties.faktaark) }),
      ...(optionalString(properties.objekttype) === undefined
        ? {}
        : { objectType: optionalString(properties.objekttype) }),
      ...(epochToIso(properties.datafangstdato, "datafangstdato") === undefined
        ? {}
        : { capturedAt: epochToIso(properties.datafangstdato, "datafangstdato") }),
      ...(optionalString(properties.maalemetode) === undefined
        ? {}
        : { surveyMethod: optionalString(properties.maalemetode) }),
      ...(optionalNumber(properties.noeyaktighet) === undefined
        ? {}
        : { accuracyMeters: optionalNumber(properties.noeyaktighet) }),
    },
  };
}

function normalizeNatureType(
  feature: RawNatureTypeResponse["features"][number],
): NatureTypeFeature {
  const properties = feature.properties;
  verifyArcGisObjectId(feature.id, properties.OBJECTID);
  return {
    type: "Feature",
    id: properties.NiNID,
    geometry: feature.geometry,
    properties: {
      id: properties.NiNID,
      ...(optionalString(properties["Områdenavn"]) === undefined
        ? {}
        : { areaName: optionalString(properties["Områdenavn"]) }),
      ...(optionalString(properties.Kommuner) === undefined
        ? {}
        : { municipalities: optionalString(properties.Kommuner) }),
      ...(optionalString(properties.Naturtype) === undefined
        ? {}
        : { natureType: optionalString(properties.Naturtype) }),
      ...(optionalString(properties.Naturtypekode) === undefined
        ? {}
        : { natureTypeCode: optionalString(properties.Naturtypekode) }),
      ...(optionalNumber(properties.Lokalitetskvalitet) === undefined
        ? {}
        : { localityQuality: optionalNumber(properties.Lokalitetskvalitet) }),
      ...(optionalNumber(properties.Tilstand) === undefined
        ? {}
        : { condition: optionalNumber(properties.Tilstand) }),
      ...(optionalString(properties.Tilstandbeskrivelse) === undefined
        ? {}
        : {
            conditionDescription: optionalString(properties.Tilstandbeskrivelse),
          }),
      ...(optionalNumber(properties.Naturmangfold) === undefined
        ? {}
        : { biodiversity: optionalNumber(properties.Naturmangfold) }),
      ...(optionalString(properties.Naturmangfoldbeskrivelse) === undefined
        ? {}
        : {
            biodiversityDescription: optionalString(properties.Naturmangfoldbeskrivelse),
          }),
      ...(optionalString(properties["Hovedøkosystem"]) === undefined
        ? {}
        : { majorEcosystem: optionalString(properties["Hovedøkosystem"]) }),
      ...(optionalBoolean(properties.Mosaikk) === undefined
        ? {}
        : { mosaic: optionalBoolean(properties.Mosaikk) }),
      ...(optionalNumber(properties["Nøyaktighet"]) === undefined
        ? {}
        : { accuracy: optionalNumber(properties["Nøyaktighet"]) }),
      ...(optionalNumber(properties.Usikkerhet) === undefined
        ? {}
        : { uncertainty: optionalNumber(properties.Usikkerhet) }),
      ...(optionalString(properties.Usikkerhetsbeskrivelse) === undefined
        ? {}
        : {
            uncertaintyDescription: optionalString(properties.Usikkerhetsbeskrivelse),
          }),
      ...(epochToIso(properties.Kartleggingsdato, "Kartleggingsdato") === undefined
        ? {}
        : {
            surveyedAt: epochToIso(properties.Kartleggingsdato, "Kartleggingsdato"),
          }),
      ...(optionalNumber(properties["Kartleggingsår"]) === undefined
        ? {}
        : { surveyYear: optionalNumber(properties["Kartleggingsår"]) }),
      ...(optionalString(properties.Oppdragsgiver) === undefined
        ? {}
        : {
            commissioningOrganization: optionalString(properties.Oppdragsgiver),
          }),
      ...(optionalString(properties.Kartlegger) === undefined
        ? {}
        : { surveyor: optionalString(properties.Kartlegger) }),
      ...(optionalString(properties.Oppdragstaker) === undefined
        ? {}
        : { contractor: optionalString(properties.Oppdragstaker) }),
      ...(optionalString(properties.Kartleggingsinstruks) === undefined
        ? {}
        : {
            surveyInstructionsUrl: optionalString(properties.Kartleggingsinstruks),
          }),
      ...(optionalString(properties.Prosjektnavn) === undefined
        ? {}
        : { projectName: optionalString(properties.Prosjektnavn) }),
      ...(optionalString(properties.NiNKartleggingsenheter) === undefined
        ? {}
        : { mappingUnits: optionalString(properties.NiNKartleggingsenheter) }),
      ...(optionalString(properties.NiNBeskrivelsesvariabler) === undefined
        ? {}
        : {
            descriptionVariables: optionalString(properties.NiNBeskrivelsesvariabler),
          }),
      ...(optionalString(properties.Faktaark) === undefined
        ? {}
        : { factSheetUrl: optionalString(properties.Faktaark) }),
      ...(optionalBoolean(properties.UK_Truet) === undefined
        ? {}
        : { redListed: optionalBoolean(properties.UK_Truet) }),
      ...(optionalBoolean(properties["UK_NærTruet"]) === undefined
        ? {}
        : { nearThreatened: optionalBoolean(properties["UK_NærTruet"]) }),
      ...(optionalBoolean(properties["UK_SpesieltDårligKartlagt"]) === undefined
        ? {}
        : {
            poorlyMapped: optionalBoolean(properties["UK_SpesieltDårligKartlagt"]),
          }),
      ...(optionalBoolean(properties["UK_SentralØkosystemFunksjon"]) === undefined
        ? {}
        : {
            centralEcosystemFunction: optionalBoolean(properties["UK_SentralØkosystemFunksjon"]),
          }),
      ...(optionalBoolean(properties.UK_SeBekrivelseNaturtype) === undefined
        ? {}
        : {
            statusInDescription: optionalBoolean(properties.UK_SeBekrivelseNaturtype),
          }),
      ...(optionalBoolean(properties.UK_IngenStatus) === undefined
        ? {}
        : { noManagementStatus: optionalBoolean(properties.UK_IngenStatus) }),
    },
  };
}

function interventionFreeZoneDetails(
  zone: InterventionFreeAreaProperties["zone"],
): InterventionFreeAreaProperties["zoneDescription"] {
  switch (zone) {
    case "1":
      return "1-3 km from major infrastructure";
    case "2":
      return "3-5 km from major infrastructure";
    case "v":
      return "At least 5 km from major infrastructure (wilderness-like nature)";
  }
}

function normalizeInterventionFreeArea(
  feature: RawInterventionFreeAreaResponse["features"][number],
): InterventionFreeAreaFeature {
  const id = String(feature.properties.inonid);
  const expectedFeatureId = `status.${id}`;
  if (feature.id !== expectedFeatureId) {
    throw new ResponseValidationError(
      "Miljødirektoratet returned an intervention-free feature ID inconsistent with inonid.",
      { provider: naturbaseProvider.id },
    );
  }
  return {
    type: "Feature",
    id,
    geometry: feature.geometry,
    properties: {
      id,
      zone: feature.properties.vsone,
      zoneDescription: interventionFreeZoneDetails(feature.properties.vsone),
      ...(optionalNumber(feature.properties.arealkm2) === undefined
        ? {}
        : { areaSquareKilometers: optionalNumber(feature.properties.arealkm2) }),
      statusDate: "2023-01",
    },
  };
}

function pointInput(query: NaturbasePointQuery): SpatialInput {
  const point = parseCoordinates(query, naturbaseProvider.id);
  return { kind: "point", ...point };
}

function boundingBoxInput(query: NaturbaseBoundingBoxQuery): SpatialInput {
  const box = parseBoundingBox(query.boundingBox, naturbaseProvider.id);
  return { kind: "bounding-box", ...box };
}

function arcGisSpatialQuery(input: SpatialInput): QueryParameters {
  if (input.kind === "point") {
    return {
      geometry: `${input.longitude},${input.latitude}`,
      geometryType: "esriGeometryPoint",
      inSR: 4326,
      spatialRel: "esriSpatialRelIntersects",
    };
  }
  return {
    geometry: JSON.stringify({
      xmin: input.west,
      ymin: input.south,
      xmax: input.east,
      ymax: input.north,
      spatialReference: { wkid: 4326 },
    }),
    geometryType: "esriGeometryEnvelope",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
  };
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

function interventionFreeFilter(input: SpatialInput): string {
  const geometry = input.kind === "point" ? xmlPoint(input) : xmlBoundingBox(input);
  return `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:And><fes:Intersects><fes:ValueReference>geom</fes:ValueReference>${geometry}</fes:Intersects><fes:PropertyIsNotEqualTo><fes:ValueReference>vsone</fes:ValueReference><fes:Literal>n</fes:Literal></fes:PropertyIsNotEqualTo></fes:And></fes:Filter>`;
}

function queryOptions(query: NaturbaseFeatureQueryOptions): {
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

function pageRaw(raw: readonly unknown[]): unknown {
  return raw.length === 1 ? raw[0] : [...raw];
}

function consistentCrs(context: PageContext, declaration: unknown): void {
  const current = resolveGeoJsonCrs(declaration, naturbaseProvider.id);
  if (context.crs !== undefined && context.crs.identifier !== current.identifier) {
    throw new ResponseValidationError("Naturbase changed CRS declarations between feature pages.", {
      provider: naturbaseProvider.id,
    });
  }
  context.crs ??= current;
}

function pageKey<Feature extends { id?: string | number }>(features: readonly Feature[]): string {
  return features
    .map((feature) => String(feature.id))
    .sort()
    .join("\u001e");
}

const PROTECTED_LAYER: ArcGisLayer<RawProtectedAreaResponse, ProtectedAreaFeature> = {
  url: `${ARCGIS_ROOT}/vern/MapServer/0/query`,
  fields: PROTECTED_FIELDS,
  schema: protectedAreaResponseSchema,
  cacheTtlMs: naturbaseProvider.cacheTtlMs.protectedArea,
  normalize: normalizeProtectedArea,
};

const PROPOSED_LAYER: ArcGisLayer<RawProposedProtectedAreaResponse, ProposedProtectedAreaFeature> =
  {
    url: `${ARCGIS_ROOT}/vern/MapServer/4/query`,
    fields: PROPOSED_FIELDS,
    schema: proposedProtectedAreaResponseSchema,
    cacheTtlMs: naturbaseProvider.cacheTtlMs.protectedArea,
    normalize: normalizeProposedProtectedArea,
  };

const NATURE_TYPE_LAYER: ArcGisLayer<RawNatureTypeResponse, NatureTypeFeature> = {
  url: `${ARCGIS_ROOT}/naturtyper_nin/MapServer/0/query`,
  fields: NATURE_TYPE_FIELDS,
  schema: natureTypeResponseSchema,
  cacheTtlMs: naturbaseProvider.cacheTtlMs.natureType,
  normalize: normalizeNatureType,
};

/** Client for selected, openly licensed Naturbase vector layers. */
export class NaturbaseClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  #arcGisFetcher<Response extends ArcGisCollection, Feature>(
    layer: ArcGisLayer<Response, Feature>,
    spatial: SpatialInput,
    context: PageContext,
    options?: RequestOptions,
  ): FeaturePageFetcher<Feature> {
    return async (page: FeaturePageRequest): Promise<FeaturePageBatch<Feature>> => {
      const result = await this.#http.request({
        provider: naturbaseProvider,
        url: layer.url,
        query: {
          where: "1=1",
          outFields: layer.fields,
          returnGeometry: true,
          outSR: 4326,
          orderByFields: "OBJECTID",
          resultOffset: page.offset,
          resultRecordCount: page.pageSize,
          f: "geojson",
          ...arcGisSpatialQuery(spatial),
        },
        schema: layer.schema,
        options,
        cacheTtlMs: layer.cacheTtlMs,
      });
      consistentCrs(context, result.data.crs);
      context.raw.push(result.data);
      context.cached.push(result.cached);
      return {
        features: result.data.features.map(layer.normalize),
        hasMore: result.data.exceededTransferLimit === true,
      };
    };
  }

  async #collectArcGis<Response extends ArcGisCollection, Feature extends { id?: string | number }>(
    layer: ArcGisLayer<Response, Feature>,
    spatial: SpatialInput,
    query: NaturbaseFeatureQueryOptions,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<Feature>>> {
    const context: PageContext = { raw: [], cached: [] };
    const bounded = await collectFeaturePage(
      this.#arcGisFetcher(layer, spatial, context, options),
      {
        ...queryOptions(query),
        signal: options?.signal,
        provider: naturbaseProvider.id,
        pageKey,
      },
    );
    return createResponse(
      {
        type: "FeatureCollection",
        features: bounded.features,
        crs: context.crs ?? resolveGeoJsonCrs(undefined, naturbaseProvider.id),
        sourceCrs: NATURBASE_SOURCE_CRS,
        pagination: bounded.pagination,
      },
      responseSource(naturbaseProvider),
      pageRaw(context.raw),
      context.cached.length > 0 && context.cached.every(Boolean),
      options,
    );
  }

  async *#iterateArcGis<
    Response extends ArcGisCollection,
    Feature extends { id?: string | number },
  >(
    layer: ArcGisLayer<Response, Feature>,
    spatial: SpatialInput,
    query: NaturbaseFeatureQueryOptions,
    options?: RequestOptions,
  ): AsyncGenerator<Feature, void, undefined> {
    const context: PageContext = { raw: [], cached: [] };
    const pages = iterateFeaturePages(this.#arcGisFetcher(layer, spatial, context, options), {
      ...queryOptions(query),
      signal: options?.signal,
      provider: naturbaseProvider.id,
      pageKey,
    });
    for await (const page of pages) yield* page.features;
  }

  #interventionFreeFetcher(
    spatial: SpatialInput,
    context: PageContext,
    options?: RequestOptions,
  ): FeaturePageFetcher<InterventionFreeAreaFeature> {
    const filter = interventionFreeFilter(spatial);
    return async (
      page: FeaturePageRequest,
    ): Promise<FeaturePageBatch<InterventionFreeAreaFeature>> => {
      const result = await this.#http.request({
        provider: naturbaseProvider,
        url: INTERVENTION_FREE_URL,
        query: {
          SERVICE: "WFS",
          VERSION: "2.0.0",
          REQUEST: "GetFeature",
          TYPENAMES: "inngrepsfrinatur:status",
          PROPERTYNAME: "geom,inonid,vsone,arealkm2",
          OUTPUTFORMAT: "application/json",
          SRSNAME: "EPSG:4326",
          COUNT: page.pageSize,
          STARTINDEX: page.offset,
          SORTBY: "inonid",
          FILTER: filter,
        },
        schema: interventionFreeAreaResponseSchema,
        options,
        cacheTtlMs: naturbaseProvider.cacheTtlMs.interventionFreeArea,
      });
      consistentCrs(context, result.data.crs);
      context.raw.push(result.data);
      context.cached.push(result.cached);
      const features = result.data.features.map(normalizeInterventionFreeArea);
      const matched = result.data.numberMatched ?? result.data.totalFeatures;
      const hasMore =
        typeof matched === "number"
          ? page.offset + features.length < matched
          : features.length === page.pageSize;
      if (features.length === 0 && hasMore) {
        throw new ResponseValidationError(
          "Miljødirektoratet reported more intervention-free features after an empty page.",
          { provider: naturbaseProvider.id },
        );
      }
      return { features, hasMore };
    };
  }

  async #collectInterventionFree(
    spatial: SpatialInput,
    query: NaturbaseFeatureQueryOptions,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<InterventionFreeAreaFeature>>> {
    const context: PageContext = { raw: [], cached: [] };
    const bounded = await collectFeaturePage(
      this.#interventionFreeFetcher(spatial, context, options),
      {
        ...queryOptions(query),
        signal: options?.signal,
        provider: naturbaseProvider.id,
        pageKey,
      },
    );
    return createResponse(
      {
        type: "FeatureCollection",
        features: bounded.features,
        crs: context.crs ?? resolveGeoJsonCrs("EPSG:4326", naturbaseProvider.id),
        sourceCrs: NATURBASE_SOURCE_CRS,
        pagination: bounded.pagination,
      },
      INTERVENTION_FREE_SOURCE,
      pageRaw(context.raw),
      context.cached.length > 0 && context.cached.every(Boolean),
      options,
    );
  }

  async *#iterateInterventionFree(
    spatial: SpatialInput,
    query: NaturbaseFeatureQueryOptions,
    options?: RequestOptions,
  ): AsyncGenerator<InterventionFreeAreaFeature, void, undefined> {
    const context: PageContext = { raw: [], cached: [] };
    const pages = iterateFeaturePages(this.#interventionFreeFetcher(spatial, context, options), {
      ...queryOptions(query),
      signal: options?.signal,
      provider: naturbaseProvider.id,
      pageKey,
    });
    for await (const page of pages) yield* page.features;
  }

  /** Returns current protected areas whose geometry contains or touches a point. */
  async getProtectedAreasAt(
    query: NaturbasePointQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProtectedAreaFeature>>> {
    return this.#collectArcGis(PROTECTED_LAYER, pointInput(query), query, options);
  }

  /** Searches current protected areas intersecting a WGS84 bounding box. */
  async searchProtectedAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProtectedAreaFeature>>> {
    return this.#collectArcGis(PROTECTED_LAYER, boundingBoxInput(query), query, options);
  }

  /** Lazily iterates bounded pages of current protected areas. */
  async *iterateProtectedAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): AsyncGenerator<ProtectedAreaFeature, void, undefined> {
    yield* this.#iterateArcGis(PROTECTED_LAYER, boundingBoxInput(query), query, options);
  }

  /** Returns proposed protected areas whose geometry contains or touches a point. */
  async getProposedProtectedAreasAt(
    query: NaturbasePointQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProposedProtectedAreaFeature>>> {
    return this.#collectArcGis(PROPOSED_LAYER, pointInput(query), query, options);
  }

  /** Searches proposed protected areas intersecting a WGS84 bounding box. */
  async searchProposedProtectedAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<ProposedProtectedAreaFeature>>> {
    return this.#collectArcGis(PROPOSED_LAYER, boundingBoxInput(query), query, options);
  }

  /** Lazily iterates bounded pages of proposed protected areas. */
  async *iterateProposedProtectedAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): AsyncGenerator<ProposedProtectedAreaFeature, void, undefined> {
    yield* this.#iterateArcGis(PROPOSED_LAYER, boundingBoxInput(query), query, options);
  }

  /** Returns modern important NiN nature localities at a WGS84 point. */
  async getNatureTypesAt(
    query: NaturbasePointQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<NatureTypeFeature>>> {
    return this.#collectArcGis(NATURE_TYPE_LAYER, pointInput(query), query, options);
  }

  /** Searches modern important NiN nature localities intersecting a bounding box. */
  async searchNatureTypes(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<NatureTypeFeature>>> {
    return this.#collectArcGis(NATURE_TYPE_LAYER, boundingBoxInput(query), query, options);
  }

  /** Lazily iterates bounded pages of modern important NiN nature localities. */
  async *iterateNatureTypes(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): AsyncGenerator<NatureTypeFeature, void, undefined> {
    yield* this.#iterateArcGis(NATURE_TYPE_LAYER, boundingBoxInput(query), query, options);
  }

  /** Returns January 2023 intervention-free nature zones at a WGS84 point. */
  async getInterventionFreeAreasAt(
    query: NaturbasePointQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<InterventionFreeAreaFeature>>> {
    return this.#collectInterventionFree(pointInput(query), query, options);
  }

  /** Searches January 2023 intervention-free zones intersecting a bounding box. */
  async searchInterventionFreeAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NaturbaseFeatureResult<InterventionFreeAreaFeature>>> {
    return this.#collectInterventionFree(boundingBoxInput(query), query, options);
  }

  /** Lazily iterates bounded pages of January 2023 intervention-free zones. */
  async *iterateInterventionFreeAreas(
    query: NaturbaseBoundingBoxQuery,
    options?: RequestOptions,
  ): AsyncGenerator<InterventionFreeAreaFeature, void, undefined> {
    yield* this.#iterateInterventionFree(boundingBoxInput(query), query, options);
  }
}
