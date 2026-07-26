import type { BoundingBox } from "../../core/geo.js";

/** Metadata categories returned by the Geonorge catalogue. */
export type GeonorgeMetadataType =
  "dataset" | "service" | "series" | "service-layer" | "software" | "unknown";

/** Search parameters supported by the Geonorge catalogue adapter. */
export type GeonorgeSearchParameters = {
  /** Free text matched by the catalogue. Omitting it lists the selected resource type. */
  query?: string;
  /** Exact publishing-organization facet value. */
  publisher?: string;
  /** Exact Geonorge theme facet value. */
  theme?: string;
  /** Zero-based item offset. Defaults to zero. */
  offset?: number;
  /** Number of items to return. Defaults to ten and is capped at 100. */
  limit?: number;
};

/** Pagination metadata returned by a Geonorge catalogue search. */
export type GeonorgeSearchPagination = {
  /** Zero-based offset requested by the caller. */
  offset: number;
  /** Bounded page size requested from Geonorge. */
  limit: number;
  /** Number of items in this response. */
  returned: number;
  /** Total matching catalogue records reported by Geonorge. */
  totalItems: number;
  /** Whether another result remains after this response. */
  hasMore: boolean;
  /** Whether this response is only a window into a larger result set. */
  truncated: boolean;
};

/** A normalized Geonorge search response. */
export type GeonorgeSearchResult<T> = {
  items: T[];
  pagination: GeonorgeSearchPagination;
};

/** Access flags included with a catalogue resource. */
export type GeonorgeAccess = {
  /** May be absent on a light search hit, but is always present on detailed metadata. */
  isOpenData?: boolean;
  isRestricted: boolean;
  isProtected: boolean;
  label?: string;
  accessConstraints?: string;
  accessConstraintUrl?: string;
  securityConstraints?: string;
  securityNote?: string;
};

/** Fields shared by dataset and service search hits. */
export type GeonorgeMetadataSummary = {
  id: string;
  title: string;
  description?: string;
  publisher?: string;
  themes: string[];
  access: GeonorgeAccess;
  updatedAt?: string;
  spatialScope?: string;
};

/** A lightweight dataset discovered through catalogue search. */
export type GeonorgeDatasetSummary = GeonorgeMetadataSummary & {
  type: "dataset";
};

/** A lightweight service discovered through catalogue search. */
export type GeonorgeServiceSummary = GeonorgeMetadataSummary & {
  type: "service";
  /** Primary endpoint advertised by the search hit, when present. */
  endpoint?: GeonorgeDistribution;
};

/** A contact attached to detailed metadata. */
export type GeonorgeContact = {
  name?: string;
  organization?: string;
  email?: string;
  role?: string;
};

/** A coordinate reference system advertised for a resource. */
export type GeonorgeReferenceSystem = {
  name?: string;
  url?: string;
  namespace?: string;
};

/** Resource-specific licence metadata published in the catalogue. */
export type GeonorgeLicense = {
  name?: string;
  url?: string;
};

/** A file or representation format available through a distribution. */
export type GeonorgeDistributionFormat = {
  name: string;
  version?: string;
};

/** Normalized endpoint and distribution categories recognized by the adapter. */
export type GeonorgeDistributionKind =
  | "wfs"
  | "wms"
  | "ogc-api-features"
  | "arcgis-rest"
  | "rest"
  | "download-file"
  | "download-api"
  | "download"
  | "atom-feed"
  | "offline"
  | "web-page"
  | "unknown";

/** One typed way to access a catalogued resource. */
export type GeonorgeDistribution = {
  kind: GeonorgeDistributionKind;
  /** Provider-native protocol code, retained even when the adapter does not recognize it. */
  protocol?: string;
  protocolName?: string;
  url?: string;
  name?: string;
  organization?: string;
  unitsOfDistribution?: string;
  formats: GeonorgeDistributionFormat[];
};

/** A service related to a dataset. */
export type GeonorgeServiceReference = {
  id?: string;
  title?: string;
  kind: GeonorgeDistributionKind;
  protocol?: string;
  url?: string;
};

/** Publication and maintenance dates as published by Geonorge. */
export type GeonorgeUpdateMetadata = {
  createdAt?: string;
  publishedAt?: string;
  updatedAt?: string;
  metadataUpdatedAt?: string;
  metadataValidFrom?: string;
  metadataValidTo?: string;
  maintenanceFrequency?: string;
  status?: string;
};

/** Detailed normalized metadata returned for any supported catalogue record. */
export type GeonorgeMetadata = {
  id: string;
  title: string;
  type: GeonorgeMetadataType;
  description?: string;
  publisher?: string;
  themes: string[];
  keywords: string[];
  spatialScope?: string;
  geographicExtent?: BoundingBox;
  referenceSystems: GeonorgeReferenceSystem[];
  contacts: GeonorgeContact[];
  license?: GeonorgeLicense;
  attribution?: string;
  useLimitations?: string;
  access: GeonorgeAccess;
  updates: GeonorgeUpdateMetadata;
  distributions: GeonorgeDistribution[];
  services: GeonorgeServiceReference[];
  /** Dataset identifiers on which a service operates. */
  operatesOn: string[];
  serviceType?: string;
};

/** Detailed metadata whose provider-native type is `dataset`. */
export type GeonorgeDatasetMetadata = GeonorgeMetadata & {
  type: "dataset";
};

/** Detailed metadata whose provider-native type is `service`. */
export type GeonorgeServiceMetadata = GeonorgeMetadata & {
  type: "service";
};
