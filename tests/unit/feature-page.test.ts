import { describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  ProviderError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import {
  collectFeaturePage,
  iterateFeaturePages,
  type FeaturePageBatch,
  type FeaturePageRequest,
} from "../../src/core/feature-page.js";

type TestFeature = { id: number; properties?: { name: string } };

describe("bounded feature pages", () => {
  it("collects offset or cursor pages and reports a complete result", async () => {
    const fetchPage = vi.fn(
      async (request: FeaturePageRequest): Promise<FeaturePageBatch<TestFeature>> =>
        request.page === 0
          ? {
              features: [{ id: 1 }, { id: 2 }],
              hasMore: true,
              nextCursor: "page-2",
            }
          : { features: [{ id: 3 }], hasMore: false },
    );

    const result = await collectFeaturePage(fetchPage, {
      limit: 4,
      pageSize: 2,
      provider: "test",
    });

    expect(result.features.map(({ id }) => id)).toEqual([1, 2, 3]);
    expect(result.pagination).toEqual({
      limit: 4,
      pageSize: 2,
      pagesFetched: 2,
      returned: 3,
      truncated: false,
    });
    expect(fetchPage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ page: 0, offset: 0, pageSize: 2 }),
    );
    expect(fetchPage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ page: 1, offset: 2, pageSize: 2, cursor: "page-2" }),
    );
  });

  it("accepts an empty first page and reports it as complete", async () => {
    const fetchPage = vi.fn(async () => ({ features: [], hasMore: false }));
    const result = await collectFeaturePage(fetchPage, { limit: 100 });

    expect(result.features).toEqual([]);
    expect(result.pagination).toMatchObject({
      pagesFetched: 1,
      returned: 0,
      truncated: false,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("does no work when the explicit feature limit is zero", async () => {
    const fetchPage = vi.fn(async () => ({ features: [{ id: 1 }], hasMore: false }));
    const result = await collectFeaturePage(fetchPage, { limit: 0 });

    expect(result.features).toEqual([]);
    expect(result.pagination).toMatchObject({
      limit: 0,
      pagesFetched: 0,
      returned: 0,
      truncated: false,
    });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("reports a provider continuation when the item limit truncates the result", async () => {
    const fetchPage = vi.fn(async () => ({
      features: [{ id: 1 }, { id: 2 }],
      hasMore: true,
      nextCursor: "continue-here",
    }));
    const result = await collectFeaturePage(fetchPage, { limit: 2, pageSize: 2 });

    expect(result.pagination).toEqual({
      limit: 2,
      pageSize: 2,
      pagesFetched: 1,
      returned: 2,
      truncated: true,
      nextCursor: "continue-here",
    });
  });

  it("reports a numeric continuation when maxPages bounds an offset service", async () => {
    const fetchPage = vi.fn(async () => ({
      features: [{ id: 1 }, { id: 2 }],
      hasMore: true,
    }));
    const result = await collectFeaturePage(fetchPage, {
      limit: 10,
      pageSize: 2,
      maxPages: 1,
      startOffset: 20,
    });

    expect(result.pagination).toMatchObject({
      pagesFetched: 1,
      returned: 2,
      truncated: true,
      nextOffset: 22,
    });
  });

  it("reduces the final requested page size to the remaining item budget", async () => {
    const requestedSizes: number[] = [];
    const fetchPage = vi.fn(async (request: FeaturePageRequest) => {
      requestedSizes.push(request.pageSize);
      return request.page === 0
        ? { features: [{ id: 1 }, { id: 2 }], hasMore: true }
        : { features: [{ id: 3 }], hasMore: true };
    });

    const result = await collectFeaturePage(fetchPage, { limit: 3, pageSize: 2 });

    expect(requestedSizes).toEqual([2, 1]);
    expect(result.features).toHaveLength(3);
    expect(result.pagination.truncated).toBe(true);
    expect(result.pagination.nextOffset).toBe(3);
  });

  it("rejects a repeated cursor before requesting the same page again", async () => {
    const fetchPage = vi.fn(async (request: FeaturePageRequest) => ({
      features: [{ id: request.page + 1 }],
      hasMore: true,
      nextCursor: "same",
    }));

    await expect(
      collectFeaturePage(fetchPage, { limit: 10, pageSize: 1, provider: "ogc" }),
    ).rejects.toThrow(/repeated pagination cursor/u);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("rejects repeated page contents even when an offset keeps advancing", async () => {
    const fetchPage = vi.fn(async () => ({
      features: [
        { id: 1, properties: { name: "one" } },
        { id: 2, properties: { name: "two" } },
      ],
      hasMore: true,
    }));

    await expect(
      collectFeaturePage(fetchPage, { limit: 10, pageSize: 2, provider: "arcgis" }),
    ).rejects.toThrow(/repeated a feature page/u);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("detects repeated contents independently of feature order", async () => {
    const pages = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 1 }],
    ];
    const fetchPage = vi.fn(async (request: FeaturePageRequest) => ({
      features: pages[request.page] ?? [],
      hasMore: true,
    }));

    await expect(collectFeaturePage(fetchPage, { limit: 10, pageSize: 2 })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("wraps unusable custom page fingerprints as response validation failures", async () => {
    const fetchPage = vi.fn(async () => ({
      features: [{ id: 1 }],
      hasMore: false,
    }));

    await expect(
      collectFeaturePage(fetchPage, {
        limit: 1,
        pageKey: () => {
          throw new Error("cannot identify this page");
        },
      }),
    ).rejects.toMatchObject({
      name: "ResponseValidationError",
      cause: expect.any(Error),
    });

    await expect(
      collectFeaturePage(fetchPage, {
        limit: 1,
        pageKey: () => "",
      }),
    ).rejects.toThrow(/empty repeated-page fingerprint/u);
  });

  it("rejects empty endless pages and oversized provider pages", async () => {
    await expect(
      collectFeaturePage(async () => ({ features: [], hasMore: true }), {
        limit: 10,
        provider: "wfs",
      }),
    ).rejects.toThrow(/empty feature page/u);

    await expect(
      collectFeaturePage(async () => ({ features: [{ id: 1 }, { id: 2 }], hasMore: false }), {
        limit: 10,
        pageSize: 1,
        provider: "arcgis",
      }),
    ).rejects.toThrow(/more features than the requested page size/u);
  });

  it("rejects inconsistent continuation metadata", async () => {
    await expect(
      collectFeaturePage(
        async () => ({ features: [{ id: 1 }], hasMore: false, nextCursor: "impossible" }),
        { limit: 10 },
      ),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("passes the caller signal through and rejects before an already-aborted request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    const fetchPage = vi.fn(async () => ({ features: [], hasMore: false }));

    await expect(
      collectFeaturePage(fetchPage, {
        limit: 10,
        signal: controller.signal,
        provider: "naturbase",
      }),
    ).rejects.toMatchObject({ name: "ProviderError", provider: "naturbase" });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it("observes an abort between pages without issuing another request", async () => {
    const controller = new AbortController();
    const fetchPage = vi.fn(async (request: FeaturePageRequest) => {
      expect(request.signal).toBe(controller.signal);
      return { features: [{ id: 1 }], hasMore: true };
    });
    const iterator = iterateFeaturePages(fetchPage, {
      limit: 10,
      pageSize: 1,
      signal: controller.signal,
      provider: "nibio",
    });

    await expect(iterator.next()).resolves.toMatchObject({ done: false });
    controller.abort();
    await expect(iterator.next()).rejects.toBeInstanceOf(ProviderError);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("is lazy and stops fetching when iteration stops early", async () => {
    const fetchPage = vi.fn(async () => ({
      features: [{ id: 1 }],
      hasMore: true,
    }));
    const iterator = iterateFeaturePages(fetchPage, { limit: 10, pageSize: 1 });

    expect(fetchPage).not.toHaveBeenCalled();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    await iterator.return({
      limit: 10,
      pageSize: 1,
      pagesFetched: 1,
      returned: 1,
      truncated: true,
      nextOffset: 1,
    });
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it.each([
    { limit: -1 },
    { limit: 10_001 },
    { limit: 1.5 },
    { limit: Number.NaN },
    { limit: 1, pageSize: 0 },
    { limit: 1, pageSize: 1_001 },
    { limit: 1, maxPages: 0 },
    { limit: 1, maxPages: 101 },
    { limit: 1, startOffset: -1 },
    { limit: 1, startOffset: 1.5 },
  ])("rejects unsafe bounds before fetching: %o", async (options) => {
    const fetchPage = vi.fn(async () => ({ features: [], hasMore: false }));

    await expect(collectFeaturePage(fetchPage, options)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
