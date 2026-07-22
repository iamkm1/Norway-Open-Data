/** A register or statistics bank publishing tables through the FHI open API. */
export type HealthStatisticsSource = {
  /** Source identifier used in table, metadata, dimension and data lookups. */
  id: string;
  title: string;
  description?: string;
  aboutUrl?: string;
  publishedBy?: string;
};

/** One published table listed for an FHI statistics source. */
export type HealthStatisticsTable = {
  tableId: number;
  title: string;
  publishedAt?: string;
  modifiedAt?: string;
};

/** Descriptive documentation for one FHI table. */
export type HealthTableMetadata = {
  source: string;
  tableId: number;
  name: string;
  isOfficialStatistics?: boolean;
  /** Provider-authored sections; `content` is HTML exactly as FHI publishes it. */
  paragraphs: Array<{ header?: string; content?: string }>;
};

/** A selectable dimension category. FHI category values can nest hierarchically. */
export type HealthDimensionValue = {
  code: string;
  label?: string;
  children?: HealthDimensionValue[];
};

/** One queryable dimension of an FHI table. */
export type HealthDimension = {
  code: string;
  label?: string;
  values: HealthDimensionValue[];
};

/** The queryable dimensions of one FHI table. */
export type HealthTableDimensions = {
  source: string;
  tableId: number;
  dimensions: HealthDimension[];
};

/** A selection query against one FHI open-API table. */
export type HealthStatisticsQuery = {
  /** Source identifier from `getSources()`, e.g. `daar`. */
  source: string;
  tableId: number;
  /**
   * Dimension code to selected category codes. `["*"]` selects every category
   * of that dimension, including nested child categories.
   */
  selections: Record<string, string[]>;
  /** Provider-side cap on returned rows, forwarded as `response.maxRowCount`. */
  maxRowCount?: number;
};

/** A flat dimension of a returned statistics cube. */
export type HealthCubeDimension = {
  code: string;
  label?: string;
  values: Array<{ code: string; label?: string }>;
};

/**
 * One flattened observation. Dimension codes map to category codes; the
 * observation is in `value`, and `flag` preserves FHI's cell marker when the
 * provider suppressed or could not compute the number.
 */
export type HealthStatisticsRow = {
  /** Numeric observation, or null when the cell is empty or flagged. */
  value: number | null;
  /**
   * FHI flag symbol exactly as published, e.g. `:` for anonymized cells.
   * The meaning of each symbol is in the result's `flags` legend.
   */
  flag?: string;
} & Record<string, string | number | null | undefined>;

/** A flattened FHI JSON-stat2 result with the provider's flag legend. */
export type HealthStatisticsResult = {
  source: string;
  tableId: number;
  title?: string;
  updatedAt?: string;
  dimensions: HealthCubeDimension[];
  /**
   * FHI's flag legend for this table: symbol to provider-supplied meaning
   * (Norwegian), e.g. `":"` to `"Anonymisert eller skjult av andre årsaker"`.
   * Flagged observations must stay suppressed in downstream use.
   */
  flags: Record<string, string>;
  rows: HealthStatisticsRow[];
};

/** The validated JSON-stat2 shape returned by FHI data queries. */
export type HealthJsonStatDataset = {
  version: string;
  class: string;
  label?: string | null;
  updated?: string | null;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label?: string | null;
      category: {
        index: Record<string, number> | string[];
        label?: Record<string, string>;
      };
    }
  >;
  /** Observations: numbers, FHI flag symbols (strings) or nulls. */
  value: Array<number | string | null> | Record<string, number | string | null>;
  extension?: {
    flags?: {
      index?: string[];
      label?: Record<string, string>;
    } | null;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};
