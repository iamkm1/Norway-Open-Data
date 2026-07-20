/** Resource categories exposed by the Data.norge catalogue search. */
export type CatalogResourceType =
  "dataset" | "data-service" | "concept" | "information-model" | "unknown";

/** Search parameters supported by the Data.norge catalogue adapter. */
export type CatalogSearchParameters = {
  /** Text matched by Data.norge against titles, descriptions, and keywords. */
  query: string;
  /** Restricts results to one or more catalogue resource categories. */
  type?: Array<Exclude<CatalogResourceType, "unknown">>;
  /** Publisher organization number or a complete Data.norge organization path. */
  publisher?: string;
  /** Official access-rights code, for example `PUBLIC` or `RESTRICTED`. */
  accessRights?: string;
  /** Zero-based result page. Defaults to zero. */
  page?: number;
  /** Number of results per page. Defaults to ten. */
  size?: number;
};

/** A publisher summary attached to catalogue resources. */
export type CatalogPublisherSummary = {
  id?: string;
  name?: string;
  uri?: string;
  organizationPath?: string;
};

/** One way in which a catalogued dataset can be accessed. */
export type CatalogDistribution = {
  title?: string;
  accessUrl?: string;
  downloadUrl?: string;
  format?: string;
};

/** A normalized resource discovered through Data.norge. */
export type CatalogResource = {
  id: string;
  type: CatalogResourceType;
  title: string;
  description?: string;
  publisher?: CatalogPublisherSummary;
  accessRights?: string;
  license?: string;
  landingPage?: string;
  distributions?: CatalogDistribution[];
};

/** Pagination metadata returned by catalogue searches. */
export type CatalogSearchPagination = {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
};

/** Catalogue resources and their pagination metadata. */
export type CatalogSearchResult = {
  items: CatalogResource[];
  pagination: CatalogSearchPagination;
};

/** Organization metadata from Data.norge's prescribed publisher URI. */
export type CatalogPublisher = {
  id: string;
  uri: string;
  name: string;
  legalName?: string;
  organizationPath?: string;
  homepage?: string;
  parentId?: string;
  organizationType?: string;
  status?: string;
};
