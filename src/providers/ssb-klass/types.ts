/** Languages officially supported by the SSB Klass API. */
export type KlassLanguage = "nb" | "nn" | "en";

/** Stable identifiers of commonly used official Klass classifications. */
export const klassClassificationIds = {
  municipalities: 131,
  counties: 104,
  industry: 6,
  occupations: 7,
  education: 36,
  countriesSsb3: 91,
  countriesAlpha2: 100,
  countriesAlpha3: 552,
} as const;

/** Numeric identifier assigned to a Klass classification or codelist. */
export type KlassClassificationId = number;

/** Numeric identifier assigned to one dated classification version. */
export type KlassVersionId = number;

/** Numeric identifier assigned to one fixed correspondence table. */
export type KlassCorrespondenceTableId = number;

/** Normalized distinction between official classifications and SSB-specific codelists. */
export type KlassClassificationType = "classification" | "codelist" | "unknown";

/** Result paging used by both upstream-paged and SDK-bounded operations. */
export type KlassPagination = {
  /** Zero-based page returned to the caller. */
  page: number;
  /** Maximum number of items on this page. */
  pageSize: number;
  /** Total items reported by Klass or found in the bounded upstream payload. */
  totalItems: number;
  /** Total number of SDK pages. */
  totalPages: number;
  /** Whether Klass itself paged the upstream response. */
  upstreamPaged: boolean;
};

/** Contact information published for a Klass resource. */
export type KlassContactPerson = {
  name?: string;
  email?: string;
  phone?: string;
};

/** A hierarchy level within a classification version. */
export type KlassLevel = {
  number: number;
  name: string;
};

/** One provider-authored change-log entry. */
export type KlassChangelogEntry = {
  changedAt?: string;
  description?: string;
};

/** Summary returned while browsing classifications and codelists. */
export type KlassClassificationSummary = {
  id: KlassClassificationId;
  name: string;
  type: KlassClassificationType;
  familyId?: number;
  lastModified: string;
  description?: string;
};

/** One language-specific result from Klass full-text classification search. */
export type KlassClassificationSearchHit = {
  id: KlassClassificationId;
  name: string;
  language: KlassLanguage;
  snippet: string;
  score: number;
};

/** Whether a version is before, active on, or after the date of retrieval. */
export type KlassVersionStatus = "historical" | "current" | "future";

/** Summary of one dated classification version. */
export type KlassVersionSummary = {
  id: KlassVersionId;
  name: string;
  validFrom: string;
  validTo?: string;
  lastModified: string;
  publishedLanguages: KlassLanguage[];
  status: KlassVersionStatus;
};

/** Detailed metadata for a classification or codelist. */
export type KlassClassification = KlassClassificationSummary & {
  primaryLanguage?: KlassLanguage;
  copyrighted?: boolean;
  includesShortName?: boolean;
  includesNotes?: boolean;
  contactPerson?: KlassContactPerson;
  owningSection?: string;
  statisticalUnits: string[];
  versions: KlassVersionSummary[];
};

/** Summary of an alternative grouping attached to a classification version. */
export type KlassVariantSummary = {
  id: number;
  name: string;
  lastModified: string;
  publishedLanguages: KlassLanguage[];
  contactPerson?: KlassContactPerson;
  owningSection?: string;
};

/** One source-to-target code relationship returned by Klass. */
export type KlassCorrespondenceItem = {
  sourceCode: string;
  sourceName: string;
  sourceShortName?: string;
  targetCode: string;
  targetName: string;
  targetShortName?: string;
  /** Present for range correspondence, absent for a dated snapshot or fixed table. */
  validFrom?: string;
  /** Present for a bounded range; may be absent for an indefinite range. */
  validTo?: string;
};

/** Summary of a fixed mapping between two classification versions. */
export type KlassCorrespondenceTableSummary = {
  id: KlassCorrespondenceTableId;
  name: string;
  sourceVersionId: KlassVersionId;
  sourceVersionName: string;
  targetVersionId: KlassVersionId;
  targetVersionName: string;
  changeTable: boolean;
  lastModified: string;
  publishedLanguages: KlassLanguage[];
  sourceLevel?: KlassLevel;
  targetLevel?: KlassLevel;
};

/** Metadata for a fixed correspondence table, excluding its potentially large map. */
export type KlassCorrespondenceTableMetadata = KlassCorrespondenceTableSummary & {
  contactPerson?: KlassContactPerson;
  owningSection?: string;
  description?: string;
  changelog: KlassChangelogEntry[];
};

/** A bounded page from one fixed correspondence table. */
export type KlassCorrespondenceTable = KlassCorrespondenceTableMetadata & {
  items: KlassCorrespondenceItem[];
  pagination: KlassPagination;
};

/** Detailed version metadata without automatically publishing its unbounded code payload. */
export type KlassVersion = KlassVersionSummary & {
  introduction?: string;
  contactPerson?: KlassContactPerson;
  owningSection?: string;
  legalBase?: string;
  publications?: string;
  derivedFrom?: string;
  levels: KlassLevel[];
  correspondenceTables: KlassCorrespondenceTableSummary[];
  variants: KlassVariantSummary[];
  changelog: KlassChangelogEntry[];
  /** Number of embedded classification items validated in the provider response. */
  codeCount: number;
};

/** A normalized code in a dated or ranged Klass classification. */
export type KlassCode = {
  code: string;
  parentCode?: string;
  level: string;
  name: string;
  shortName?: string;
  presentationName?: string;
  validFrom?: string;
  validTo?: string;
  /** Validity clipped to the requested range, when Klass returns a range result. */
  validFromInRequestedRange?: string;
  /** End of validity clipped to the requested range. */
  validToInRequestedRange?: string;
  notes?: string;
};

/** One official code-change edge at a classification-version boundary. */
export type KlassCodeChange = {
  oldCode?: string;
  oldName?: string;
  oldShortName?: string;
  newCode?: string;
  newName?: string;
  newShortName?: string;
  occurredAt: string;
};

/** Parameters for browsing classifications and, optionally, SSB codelists. */
export type KlassListClassificationsParameters = {
  language?: KlassLanguage;
  includeCodelists?: boolean;
  includeDescription?: boolean;
  /** ISO 8601 date-time. */
  changedSince?: string;
  page?: number;
  pageSize?: number;
};

/** A provider-paged classification listing. */
export type KlassListClassificationsResult = {
  items: KlassClassificationSummary[];
  pagination: KlassPagination;
};

/** Parameters for Klass full-text classification search. */
export type KlassSearchClassificationsParameters = {
  query: string;
  includeCodelists?: boolean;
  ssbSection?: string;
  page?: number;
  pageSize?: number;
};

/** A provider-paged set of language-specific classification search hits. */
export type KlassSearchClassificationsResult = {
  items: KlassClassificationSearchHit[];
  pagination: KlassPagination;
};

/** Concise alias for a classification-list result. */
export type KlassClassificationList = KlassListClassificationsResult;

/** Concise alias for a classification-search result. */
export type KlassClassificationSearchResult = KlassSearchClassificationsResult;

/** Parameters for retrieving one classification and its version summaries. */
export type KlassGetClassificationParameters = {
  classificationId: KlassClassificationId;
  language?: KlassLanguage;
  includeFuture?: boolean;
};

/** Parameters for a bounded view of versions embedded in a classification. */
export type KlassListVersionsParameters = KlassGetClassificationParameters & {
  page?: number;
  pageSize?: number;
};

/** A bounded SDK page of classification versions. */
export type KlassListVersionsResult = {
  items: KlassVersionSummary[];
  pagination: KlassPagination;
};

/** Concise alias for a bounded classification-version listing. */
export type KlassVersionList = KlassListVersionsResult;

/** Parameters for retrieving one version's metadata. */
export type KlassGetVersionParameters = {
  versionId: KlassVersionId;
  language?: KlassLanguage;
  includeFuture?: boolean;
};

/** Shared filters and SDK-local paging for dated and ranged code-list operations. */
export type KlassCodePageParameters = {
  classificationId: KlassClassificationId;
  language?: KlassLanguage;
  includeFuture?: boolean;
  /** Restrict the upstream response to exact code values. */
  codes?: string[];
  /** Restrict the upstream response to one hierarchy level. */
  level?: string;
  page?: number;
  pageSize?: number;
};

/** Parameters for codes valid on one date. */
export type KlassListCodesAtDateParameters = KlassCodePageParameters & {
  date: string;
  from?: never;
  to?: never;
};

/** Parameters for codes intersecting an inclusive/exclusive date range. */
export type KlassListCodesInRangeParameters = KlassCodePageParameters & {
  date?: never;
  from: string;
  /** Exclusive range end. An omitted end is indefinite. */
  to?: string;
};

/** Parameters for an SDK-bounded page of one official version's embedded codes. */
export type KlassListCodesForVersionParameters = {
  versionId: KlassVersionId;
  language?: KlassLanguage;
  includeFuture?: boolean;
  level?: string;
  page?: number;
  pageSize?: number;
};

/** Parameters for a safely bounded code-list operation. */
export type KlassListCodesParameters =
  | KlassListCodesAtDateParameters
  | KlassListCodesInRangeParameters
  | KlassListCodesForVersionParameters;

/** A bounded page of codes; Klass does not page this upstream payload. */
export type KlassListCodesResult = {
  items: KlassCode[];
  pagination: KlassPagination;
};

/** Concise alias for a bounded code-list result. */
export type KlassCodeList = KlassListCodesResult;

/** Parameters for efficient exact code lookup at one classification date. */
export type KlassGetCodeAtDateParameters = {
  classificationId: KlassClassificationId;
  code: string;
  date: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
};

/**
 * Parameters for exact lookup inside one version's embedded code list.
 *
 * Klass does not expose a version-code item endpoint, so this scope validates
 * the complete version payload before selecting the exact code.
 */
export type KlassGetCodeForVersionParameters = {
  versionId: KlassVersionId;
  code: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
};

/** Efficient dated or explicit-version exact code lookup. */
export type KlassGetCodeParameters =
  KlassGetCodeAtDateParameters | KlassGetCodeForVersionParameters;

/**
 * Parameters for provider-supported code-pattern search.
 *
 * Klass does not offer code-name search, so this deliberately accepts only the
 * official `selectCodes` wildcard/range syntax.
 */
export type KlassSearchCodesParameters = {
  classificationId: KlassClassificationId;
  codePattern: string;
  date: string;
  level?: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
  page?: number;
  pageSize?: number;
};

/** A bounded page of code-pattern matches. */
export type KlassSearchCodesResult = {
  items: KlassCode[];
  pagination: KlassPagination;
};

/** Parameters for correspondence tables attached to one classification version. */
export type KlassListCorrespondenceTablesParameters = {
  versionId: KlassVersionId;
  language?: KlassLanguage;
  includeFuture?: boolean;
  page?: number;
  pageSize?: number;
};

/** A bounded SDK page of correspondence-table summaries. */
export type KlassListCorrespondenceTablesResult = {
  items: KlassCorrespondenceTableSummary[];
  pagination: KlassPagination;
};

/** Concise alias for a correspondence-table listing. */
export type KlassCorrespondenceTableList = KlassListCorrespondenceTablesResult;

/** Parameters for one fixed correspondence table and a bounded page of its map. */
export type KlassGetCorrespondenceTableParameters = {
  correspondenceTableId: KlassCorrespondenceTableId;
  language?: KlassLanguage;
  page?: number;
  pageSize?: number;
};

/** Parameters for a fixed version-to-version correspondence table. */
export type KlassGetFixedCorrespondenceParameters = KlassGetCorrespondenceTableParameters & {
  mode: "fixed";
};

/** Parameters for a correspondence snapshot between two classifications. */
export type KlassGetDatedCorrespondenceParameters = {
  mode: "date";
  sourceClassificationId: KlassClassificationId;
  targetClassificationId: KlassClassificationId;
  date: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
  /** Reverse source and target in the official snapshot response. */
  inverted?: boolean;
  page?: number;
  pageSize?: number;
};

/** Parameters for correspondence intersecting a date range. */
export type KlassGetRangeCorrespondenceParameters = {
  mode: "range";
  sourceClassificationId: KlassClassificationId;
  targetClassificationId: KlassClassificationId;
  from: string;
  /** Exclusive range end. An omitted end is indefinite. */
  to?: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
  page?: number;
  pageSize?: number;
};

/** The three correspondence operations supported by the curated namespace. */
export type KlassGetCorrespondenceParameters =
  | KlassGetFixedCorrespondenceParameters
  | KlassGetDatedCorrespondenceParameters
  | KlassGetRangeCorrespondenceParameters;

/** Bounded result from a fixed correspondence table. */
export type KlassGetFixedCorrespondenceResult = {
  mode: "fixed";
  table: KlassCorrespondenceTableMetadata;
  items: KlassCorrespondenceItem[];
  pagination: KlassPagination;
};

/** Bounded correspondence valid on one date. */
export type KlassGetDatedCorrespondenceResult = {
  mode: "date";
  sourceClassificationId: KlassClassificationId;
  targetClassificationId: KlassClassificationId;
  date: string;
  inverted: boolean;
  items: KlassCorrespondenceItem[];
  pagination: KlassPagination;
};

/** Bounded correspondence intersecting one date range. */
export type KlassGetRangeCorrespondenceResult = {
  mode: "range";
  sourceClassificationId: KlassClassificationId;
  targetClassificationId: KlassClassificationId;
  from: string;
  to?: string;
  items: KlassCorrespondenceItem[];
  pagination: KlassPagination;
};

/** Discriminated result from fixed, dated, or ranged correspondence. */
export type KlassGetCorrespondenceResult =
  | KlassGetFixedCorrespondenceResult
  | KlassGetDatedCorrespondenceResult
  | KlassGetRangeCorrespondenceResult;

/** Concise alias for fixed, dated, or ranged correspondence. */
export type KlassCorrespondence = KlassGetCorrespondenceResult;

/** Parameters for code-change edges over a date range. */
export type KlassListCodeChangesParameters = {
  classificationId: KlassClassificationId;
  /** Boundary date excluded by Klass; returned events occur strictly after it. */
  from: string;
  /** Boundary date excluded by Klass; returned events occur strictly before it. */
  to?: string;
  language?: KlassLanguage;
  includeFuture?: boolean;
  page?: number;
  pageSize?: number;
};

/** A bounded page of code-change graph edges. */
export type KlassListCodeChangesResult = {
  items: KlassCodeChange[];
  pagination: KlassPagination;
};

/** Concise alias for a bounded code-change result. */
export type KlassCodeChanges = KlassListCodeChangesResult;

/** Administrative classification selected by a high-level resolution helper. */
export type KlassAdministrativeCodeKind = "municipality" | "county";

/** Parameters shared by municipality- and county-code resolution. */
export type KlassResolveAdministrativeCodeParameters = {
  code: string;
  /** Needed when the code cannot be assigned to one historical version unambiguously. */
  sourceDate?: string;
  targetDate: string;
  language?: KlassLanguage;
  /** Includes unpublished future versions when Klass makes them available. */
  includeFuture?: boolean;
};

/** Explicit outcome of an official administrative-code resolution attempt. */
export type KlassCodeResolutionStatus =
  | "unchanged"
  | "renamed"
  | "replaced"
  | "merged"
  | "split"
  | "ambiguous"
  | "not_found"
  | "context_required";

/** Compact code and validity context used in a resolution graph. */
export type KlassCodeResolutionMatch = {
  code: string;
  name: string;
  validFrom?: string;
  validTo?: string;
};

/**
 * An ambiguity-preserving municipality or county resolution.
 *
 * Provider attribution, cache state, and retrieval time remain in the SDK's
 * normal `OpenDataResponse` envelope rather than being duplicated here.
 */
export type KlassCodeResolution = {
  kind: KlassAdministrativeCodeKind;
  input: {
    code: string;
    sourceDate?: string;
    targetDate: string;
  };
  status: KlassCodeResolutionStatus;
  sourceCode?: KlassCodeResolutionMatch;
  /** Candidates at the requested target date; never silently reduced to one. */
  matches: KlassCodeResolutionMatch[];
  /** Other official codes participating on the older side of the mapping. */
  predecessors: KlassCodeResolutionMatch[];
  /** Other official codes participating on the newer side of the mapping. */
  successors: KlassCodeResolutionMatch[];
  /** Chronological official change edges supporting the result. */
  changes: KlassCodeChange[];
  warnings: string[];
};
