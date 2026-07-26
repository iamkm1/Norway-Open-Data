/**
 * Bounded, protocol-neutral feature pagination.
 *
 * ArcGIS REST generally advances by numeric offset, WFS by `startIndex`, and
 * OGC API Features may publish an opaque `next` link. Provider adapters map
 * those details onto this small batch contract while retaining control of the
 * fixed upstream URL. The helper never follows a URL itself.
 */
import { InputValidationError, ProviderError, ResponseValidationError } from "./errors.js";

export const DEFAULT_FEATURE_PAGE_SIZE = 100;
export const MAX_FEATURE_PAGE_SIZE = 1_000;
export const MAX_FEATURE_PAGES = 100;
export const MAX_FEATURE_ITEMS = 10_000;

/** One request made by the bounded page walker. */
export type FeaturePageRequest = {
  /** Zero-based request number within this walk. */
  page: number;
  /** Number of features successfully consumed before this request. */
  offset: number;
  /** Requested maximum response size for this request. */
  pageSize: number;
  /** Opaque, already-validated continuation marker when the protocol supplies one. */
  cursor?: string;
  signal?: AbortSignal;
};

/** One provider page mapped to the protocol-neutral pagination contract. */
export type FeaturePageBatch<Feature> = {
  features: readonly Feature[];
  /** True only when the provider says another page exists. */
  hasMore: boolean;
  /** Opaque continuation marker; provider adapters must validate URL-based markers first. */
  nextCursor?: string;
};

/** One validated page yielded by {@link iterateFeaturePages}. */
export type FeaturePageChunk<Feature> = {
  features: Feature[];
  page: number;
  offset: number;
  requestedPageSize: number;
  hasMore: boolean;
  nextCursor?: string;
};

/** Completeness and continuation metadata for a bounded feature walk. */
export type FeaturePagePagination = {
  /** Caller-requested maximum feature count. */
  limit: number;
  /** Configured maximum provider page size. */
  pageSize: number;
  pagesFetched: number;
  returned: number;
  /** True when a caller or safety bound stopped the walk while more data existed. */
  truncated: boolean;
  /** Provider continuation marker, when one exists and the result is truncated. */
  nextCursor?: string;
  /** Numeric continuation offset for offset-based protocols. */
  nextOffset?: number;
};

/** A bounded collection suitable for one public geospatial search response. */
export type BoundedFeaturePage<Feature> = {
  features: Feature[];
  pagination: FeaturePagePagination;
};

/** Safety bounds shared by ArcGIS, WFS and OGC API Features adapters. */
export type FeaturePageOptions<Feature> = {
  /**
   * Explicit maximum number of features to return, from zero to 10,000.
   *
   * Providers should impose a smaller public limit when their service warrants
   * it. Requiring this value prevents an accidental country-wide download.
   */
  limit: number;
  /** Maximum requested provider page size. Defaults to 100 and is capped at 1,000. */
  pageSize?: number;
  /** Maximum provider requests. Defaults to 100 and cannot exceed 100. */
  maxPages?: number;
  /** Starting offset for ArcGIS REST or WFS pagination. */
  startOffset?: number;
  /** Starting opaque marker for OGC or provider-specific continuation. */
  startCursor?: string;
  signal?: AbortSignal;
  /** Provider id attached to pagination errors. */
  provider?: string;
  /**
   * Stable identity for one non-empty page.
   *
   * The default fingerprints JSON-compatible feature contents independent of
   * feature order. Override this with stable feature IDs when available.
   */
  pageKey?: (features: readonly Feature[]) => string;
};

/** Function that fetches one bounded provider page. */
export type FeaturePageFetcher<Feature> = (
  request: FeaturePageRequest,
) => Promise<FeaturePageBatch<Feature>>;

type ResolvedFeaturePageOptions<Feature> = {
  limit: number;
  pageSize: number;
  maxPages: number;
  startOffset: number;
  startCursor?: string;
  signal?: AbortSignal;
  provider?: string;
  pageKey: (features: readonly Feature[]) => string;
};

function errorDetails(provider: string | undefined): { provider?: string } {
  return provider === undefined ? {} : { provider };
}

function paginationError(message: string, provider: string | undefined): ResponseValidationError {
  return new ResponseValidationError(message, errorDetails(provider));
}

function throwIfAborted(signal: AbortSignal | undefined, provider: string | undefined): void {
  if (signal?.aborted !== true) return;
  throw new ProviderError(
    `${provider ?? "Geospatial provider"} feature pagination was cancelled by the caller.`,
    {
      ...errorDetails(provider),
      cause: signal.reason,
    },
  );
}

function normalizeForPageKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForPageKey);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalizeForPageKey(child)]),
    );
  }
  return value;
}

function defaultPageKey<Feature>(features: readonly Feature[]): string {
  return features
    .map((feature) => JSON.stringify(normalizeForPageKey(feature)))
    .sort()
    .join("\u001e");
}

function resolveFeaturePageOptions<Feature>(
  options: FeaturePageOptions<Feature>,
): ResolvedFeaturePageOptions<Feature> {
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 0 ||
    options.limit > MAX_FEATURE_ITEMS
  ) {
    throw new InputValidationError(
      `Feature limit must be a safe integer between 0 and ${MAX_FEATURE_ITEMS}.`,
      errorDetails(options.provider),
    );
  }
  const pageSize = options.pageSize ?? DEFAULT_FEATURE_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_FEATURE_PAGE_SIZE) {
    throw new InputValidationError(
      `Feature pageSize must be a safe integer between 1 and ${MAX_FEATURE_PAGE_SIZE}.`,
      errorDetails(options.provider),
    );
  }
  const maxPages = options.maxPages ?? MAX_FEATURE_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > MAX_FEATURE_PAGES) {
    throw new InputValidationError(
      `Feature maxPages must be a safe integer between 1 and ${MAX_FEATURE_PAGES}.`,
      errorDetails(options.provider),
    );
  }
  const startOffset = options.startOffset ?? 0;
  if (!Number.isSafeInteger(startOffset) || startOffset < 0) {
    throw new InputValidationError(
      "Feature startOffset must be a non-negative safe integer.",
      errorDetails(options.provider),
    );
  }
  return {
    limit: options.limit,
    pageSize,
    maxPages,
    startOffset,
    ...(options.startCursor === undefined ? {} : { startCursor: options.startCursor }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.provider === undefined ? {} : { provider: options.provider }),
    pageKey: options.pageKey ?? defaultPageKey,
  };
}

function validateBatch<Feature>(
  batch: FeaturePageBatch<Feature>,
  requestedPageSize: number,
  provider: string | undefined,
): void {
  if (
    typeof batch !== "object" ||
    batch === null ||
    !Array.isArray(batch.features) ||
    typeof batch.hasMore !== "boolean" ||
    (batch.nextCursor !== undefined && typeof batch.nextCursor !== "string")
  ) {
    throw paginationError(
      "A geospatial provider returned malformed pagination metadata.",
      provider,
    );
  }
  if (batch.features.length > requestedPageSize) {
    throw paginationError(
      "A geospatial provider returned more features than the requested page size.",
      provider,
    );
  }
  if (batch.features.length === 0 && batch.hasMore) {
    throw paginationError(
      "A geospatial provider reported another page after an empty feature page.",
      provider,
    );
  }
  if (!batch.hasMore && batch.nextCursor !== undefined) {
    throw paginationError(
      "A geospatial provider returned a continuation marker while reporting no next page.",
      provider,
    );
  }
}

function summary<Feature>(
  options: ResolvedFeaturePageOptions<Feature>,
  pagesFetched: number,
  returned: number,
  offset: number,
  hasMore: boolean,
  nextCursor: string | undefined,
): FeaturePagePagination {
  return {
    limit: options.limit,
    pageSize: options.pageSize,
    pagesFetched,
    returned,
    truncated: hasMore,
    ...(hasMore && nextCursor !== undefined ? { nextCursor } : {}),
    ...(hasMore && nextCursor === undefined ? { nextOffset: offset } : {}),
  };
}

/**
 * Lazily walks bounded provider pages.
 *
 * Repeated opaque cursors are rejected before the same request is sent twice.
 * Repeated non-empty page contents are rejected after the duplicate response,
 * which also protects offset-based services that ignore their requested
 * offset. Empty pages terminate normally only when `hasMore` is false.
 */
export async function* iterateFeaturePages<Feature>(
  fetchPage: FeaturePageFetcher<Feature>,
  options: FeaturePageOptions<Feature>,
): AsyncGenerator<FeaturePageChunk<Feature>, FeaturePagePagination, undefined> {
  const resolved = resolveFeaturePageOptions(options);
  let cursor = resolved.startCursor;
  let offset = resolved.startOffset;
  let returned = 0;
  let pagesFetched = 0;
  let hasMore = false;
  let continuation: string | undefined;
  const requestedCursors = new Set<string>();
  const pageKeys = new Set<string>();

  if (resolved.limit === 0) {
    return summary(resolved, pagesFetched, returned, offset, false, undefined);
  }

  while (pagesFetched < resolved.maxPages && returned < resolved.limit) {
    throwIfAborted(resolved.signal, resolved.provider);
    if (cursor !== undefined) {
      if (requestedCursors.has(cursor)) {
        throw paginationError(
          "A geospatial provider returned a repeated pagination cursor; stopped before requesting the same page again.",
          resolved.provider,
        );
      }
      requestedCursors.add(cursor);
    }

    const requestedPageSize = Math.min(resolved.pageSize, resolved.limit - returned);
    const request: FeaturePageRequest = {
      page: pagesFetched,
      offset,
      pageSize: requestedPageSize,
      ...(cursor === undefined ? {} : { cursor }),
      ...(resolved.signal === undefined ? {} : { signal: resolved.signal }),
    };
    const batch = await fetchPage(request);
    throwIfAborted(resolved.signal, resolved.provider);
    validateBatch(batch, requestedPageSize, resolved.provider);

    if (batch.features.length > 0) {
      let pageKey: string;
      try {
        pageKey = resolved.pageKey(batch.features);
      } catch (cause) {
        throw new ResponseValidationError(
          "A geospatial feature page could not be fingerprinted for repeated-page protection.",
          { ...errorDetails(resolved.provider), cause },
        );
      }
      if (pageKey.length === 0) {
        throw paginationError(
          "A geospatial feature page produced an empty repeated-page fingerprint.",
          resolved.provider,
        );
      }
      if (pageKeys.has(pageKey)) {
        throw paginationError(
          "A geospatial provider repeated a feature page; stopped before an endless pagination loop.",
          resolved.provider,
        );
      }
      pageKeys.add(pageKey);
    }

    const pageOffset = offset;
    pagesFetched += 1;
    returned += batch.features.length;
    offset += batch.features.length;
    hasMore = batch.hasMore;
    continuation = batch.nextCursor;

    yield {
      features: [...batch.features],
      page: pagesFetched - 1,
      offset: pageOffset,
      requestedPageSize,
      hasMore: batch.hasMore,
      ...(batch.nextCursor === undefined ? {} : { nextCursor: batch.nextCursor }),
    };

    if (!batch.hasMore) {
      return summary(resolved, pagesFetched, returned, offset, false, undefined);
    }
    cursor = batch.nextCursor;
  }

  return summary(resolved, pagesFetched, returned, offset, hasMore, continuation);
}

/** Collects a bounded lazy page walk into one public feature page. */
export async function collectFeaturePage<Feature>(
  fetchPage: FeaturePageFetcher<Feature>,
  options: FeaturePageOptions<Feature>,
): Promise<BoundedFeaturePage<Feature>> {
  const iterator = iterateFeaturePages(fetchPage, options);
  const features: Feature[] = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return { features, pagination: next.value };
    features.push(...next.value.features);
  }
}
