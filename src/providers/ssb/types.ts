/** A selection query against a current SSB PxWeb v2 table. */
export type StatisticsQuery = {
  tableId: string;
  selections: Record<string, string[]>;
  language?: "en" | "no";
};

/** A normalized SSB table dimension. */
export type StatisticsDimension = {
  code: string;
  label?: string;
  values: Array<{
    code: string;
    label?: string;
  }>;
};

/** Detailed metadata used to build and validate SSB table queries. */
export type StatisticsTableMetadata = {
  tableId: string;
  title?: string;
  updatedAt?: string;
  dimensions: StatisticsDimension[];
};

/** A flattened JSON-stat2 statistical result. */
export type StatisticsResult = {
  tableId: string;
  title?: string;
  updatedAt?: string;
  dimensions: StatisticsDimension[];
  /** One row per JSON-stat cell; the observation is stored in `value`. */
  rows: Array<Record<string, string | number | null>>;
};

/** The validated JSON-stat2 shape returned by SSB. */
export type JsonStatDataset = {
  version: string;
  class: string;
  label?: string;
  updated?: string;
  id: string[];
  size: number[];
  dimension: Record<
    string,
    {
      label?: string;
      category: {
        index: Record<string, number> | string[];
        label?: Record<string, string>;
      };
    }
  >;
  value: Array<number | null> | Record<string, number | null>;
  [key: string]: unknown;
};
