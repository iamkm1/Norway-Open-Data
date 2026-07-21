import { InputValidationError } from "./errors.js";

/** Default cap on logical page or continuation batches walked by one iterator. */
const DEFAULT_MAX_PAGES = 100;

/** Bounds applied to an auto-paginating iterator. */
export type PaginateOptions = {
  /** Stops after yielding this many items. Zero avoids any request. Defaults to unlimited. */
  maxItems?: number;
  /** Stops after this many logical pages or continuation batches. Must be 1-100. */
  maxPages?: number;
};

/** @internal */
export type PageResult<T> = {
  items: T[];
  totalPages: number;
};

/** @internal */
export type CursorResult<T> = {
  items: T[];
  nextCursor?: string;
};

/** Validated bounds shared by every auto-paginating iterator. @internal */
export type ResolvedPaginateOptions = {
  maxItems?: number;
  maxPages: number;
};

/** @internal */
export function resolvePaginateOptions(options: PaginateOptions = {}): ResolvedPaginateOptions {
  const { maxItems } = options;
  if (maxItems !== undefined && (!Number.isSafeInteger(maxItems) || maxItems < 0)) {
    throw new InputValidationError("maxItems must be a non-negative safe integer.");
  }

  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > DEFAULT_MAX_PAGES) {
    throw new InputValidationError("maxPages must be a safe integer between 1 and 100.");
  }

  return {
    ...(maxItems === undefined ? {} : { maxItems }),
    maxPages,
  };
}

/**
 * Walks a zero-indexed, page-numbered provider listing.
 *
 * Stops at the provider's last page, at an empty page, or when a caller bound
 * is reached, so a contract change cannot produce an unbounded request loop.
 *
 * @internal
 */
export async function* paginatePages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  startPage: number,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  const { maxItems, maxPages } = resolvePaginateOptions(options);
  if (maxItems === 0) return;
  let page = startPage;
  let emitted = 0;
  for (let request = 0; request < maxPages; request += 1) {
    const { items, totalPages } = await fetchPage(page);
    for (const item of items) {
      yield item;
      emitted += 1;
      if (maxItems !== undefined && emitted >= maxItems) return;
    }
    if (items.length === 0) return;
    page += 1;
    if (page >= totalPages) return;
  }
}

/**
 * Walks a provider listing that returns an opaque continuation marker.
 *
 * @internal
 */
export async function* paginateCursor<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorResult<T>>,
  startCursor: string | undefined,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, undefined> {
  const { maxItems, maxPages } = resolvePaginateOptions(options);
  if (maxItems === 0) return;
  let cursor = startCursor;
  let emitted = 0;
  for (let request = 0; request < maxPages; request += 1) {
    const { items, nextCursor } = await fetchPage(cursor);
    for (const item of items) {
      yield item;
      emitted += 1;
      if (maxItems !== undefined && emitted >= maxItems) return;
    }
    if (items.length === 0 || nextCursor === undefined) return;
    cursor = nextCursor;
  }
}
