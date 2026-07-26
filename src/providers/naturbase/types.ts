import type { FeaturePagePagination } from "../../core/feature-page.js";
import type { BoundingBox, Coordinates } from "../../core/geo.js";
import type {
  GeoJsonCrsMetadata,
  GeoJsonFeature,
  GeoJsonMultiPolygon,
  GeoJsonPolygonGeometry,
} from "../../core/geojson.js";

/** Polygon geometry returned by the selected Naturbase layers. */
export type NaturbaseAreaGeometry = GeoJsonPolygonGeometry | GeoJsonMultiPolygon | null;

/** CRS of the upstream dataset before server-side conversion to WGS84. */
export type NaturbaseSourceCrs = {
  identifier: "EPSG:25833";
  uri: "http://www.opengis.net/def/crs/EPSG/0/25833";
  axisOrder: "easting-northing";
};

/** Safe bounds shared by Naturbase point and bounding-box requests. */
export type NaturbaseFeatureQueryOptions = {
  /** Maximum features to return. Defaults to 100; never exceeds the SDK-wide 10,000 cap. */
  limit?: number;
  /** Maximum features requested from one upstream page. Defaults to 100. */
  pageSize?: number;
  /** Maximum upstream pages. Defaults to 100. */
  maxPages?: number;
  /** Zero-based upstream result offset. Defaults to zero. */
  offset?: number;
};

/** A point lookup in WGS84 decimal degrees. */
export type NaturbasePointQuery = Coordinates & NaturbaseFeatureQueryOptions;

/** A bounded spatial search in WGS84 decimal degrees. */
export type NaturbaseBoundingBoxQuery = NaturbaseFeatureQueryOptions & {
  boundingBox: BoundingBox;
};

/** A bounded, normalized GeoJSON feature result. */
export type NaturbaseFeatureResult<Feature> = {
  type: "FeatureCollection";
  features: Feature[];
  /** CRS of the returned GeoJSON coordinates. */
  crs: GeoJsonCrsMetadata;
  /** CRS published by the source layer before server-side conversion. */
  sourceCrs: NaturbaseSourceCrs;
  pagination: FeaturePagePagination;
};

/** Normalized attributes for one current protected area. */
export type ProtectedAreaProperties = {
  id: string;
  cddaId?: string;
  name?: string;
  officialName?: string;
  factSheetUrl?: string;
  protectionForm?: string;
  aggregatedProtectionForm?: string;
  regulationUrl?: string;
  protectedAt?: string;
  firstProtectedAt?: string;
  protectionPlan?: string;
  municipality?: string;
  managementAuthority?: string;
  managementAuthorityType?: string;
  iucnCategory?: string;
  revisionStatus?: string;
  threatAssessment?: string;
  majorEcosystemType?: string;
};

/** One current protected area from Naturbase. */
export type ProtectedAreaFeature = GeoJsonFeature<ProtectedAreaProperties, NaturbaseAreaGeometry>;

/** Normalized attributes for one proposed protected area. */
export type ProposedProtectedAreaProperties = {
  id: string;
  name?: string;
  protectionForm?: string;
  protectionPlan?: string;
  municipality?: string;
  factSheetUrl?: string;
  objectType?: string;
  capturedAt?: string;
  surveyMethod?: string;
  accuracyMeters?: number;
};

/** One proposed protected area from Naturbase. */
export type ProposedProtectedAreaFeature = GeoJsonFeature<
  ProposedProtectedAreaProperties,
  NaturbaseAreaGeometry
>;

/** Normalized attributes for one NiN nature locality. */
export type NatureTypeProperties = {
  id: string;
  areaName?: string;
  municipalities?: string;
  natureType?: string;
  natureTypeCode?: string;
  localityQuality?: number;
  condition?: number;
  conditionDescription?: string;
  biodiversity?: number;
  biodiversityDescription?: string;
  majorEcosystem?: string;
  mosaic?: boolean;
  accuracy?: number;
  uncertainty?: number;
  uncertaintyDescription?: string;
  surveyedAt?: string;
  surveyYear?: number;
  commissioningOrganization?: string;
  surveyor?: string;
  contractor?: string;
  surveyInstructionsUrl?: string;
  projectName?: string;
  mappingUnits?: string;
  descriptionVariables?: string;
  factSheetUrl?: string;
  redListed?: boolean;
  nearThreatened?: boolean;
  poorlyMapped?: boolean;
  centralEcosystemFunction?: boolean;
  statusInDescription?: boolean;
  noManagementStatus?: boolean;
};

/** One modern important NiN nature locality. */
export type NatureTypeFeature = GeoJsonFeature<NatureTypeProperties, NaturbaseAreaGeometry>;

/** Official intervention-free zone code. */
export type InterventionFreeZone = "1" | "2" | "v";

/** Normalized attributes for intervention-free nature status in January 2023. */
export type InterventionFreeAreaProperties = {
  id: string;
  zone: InterventionFreeZone;
  zoneDescription:
    | "1-3 km from major infrastructure"
    | "3-5 km from major infrastructure"
    | "At least 5 km from major infrastructure (wilderness-like nature)";
  areaSquareKilometers?: number;
  statusDate: "2023-01";
};

/** One latest-status intervention-free nature area. */
export type InterventionFreeAreaFeature = GeoJsonFeature<
  InterventionFreeAreaProperties,
  NaturbaseAreaGeometry
>;
