/** Default cap on provider requests made by one auto-paginating iterator. */
const DEFAULT_MAX_PAGES = 100;

/** Bounds applied to an auto-paginating iterator. */
export type PaginateOptions = {
  /** Stops after yielding this many items. Defaults to unlimited. */
  maxItems?: number;
  /** Stops after this many provider requests. Defaults to 100. */
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

function pageLimit(options: PaginateOptions): number {
  const configured = options.maxPages ?? DEFAULT_MAX_PAGES;
  return configured > 0 ? configured : DEFAULT_MAX_PAGES;
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
  const maxPages = pageLimit(options);
  let page = startPage;
  let emitted = 0;
  for (let request = 0; request < maxPages; request += 1) {
    const { items, totalPages } = await fetchPage(page);
    for (const item of items) {
      yield item;
      emitted += 1;
      if (options.maxItems !== undefined && emitted >= options.maxItems) return;
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
  const maxPages = pageLimit(options);
  let cursor = startCursor;
  let emitted = 0;
  for (let request = 0; request < maxPages; request += 1) {
    const { items, nextCursor } = await fetchPage(cursor);
    for (const item of items) {
      yield item;
      emitted += 1;
      if (options.maxItems !== undefined && emitted >= options.maxItems) return;
    }
    if (items.length === 0 || nextCursor === undefined) return;
    cursor = nextCursor;
  }
}
