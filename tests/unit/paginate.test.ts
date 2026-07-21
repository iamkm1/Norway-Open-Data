import companyFixture from "../fixtures/brreg-company.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { paginateCursor, paginatePages } from "../../src/core/paginate.js";
import { NorwayOpenData } from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

async function collect<T>(source: AsyncGenerator<T, void, undefined>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

describe("paginatePages", () => {
  it("walks every page and stops on the last one", async () => {
    const pages = [
      { items: [1, 2], totalPages: 3 },
      { items: [3, 4], totalPages: 3 },
      { items: [5], totalPages: 3 },
    ];
    const fetchPage = vi.fn(async (page: number) => pages[page] ?? { items: [], totalPages: 3 });
    expect(await collect(paginatePages(fetchPage, 0))).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops early on an empty page", async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as number[], totalPages: 99 }));
    expect(await collect(paginatePages(fetchPage, 0))).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("honors maxItems and stops requesting", async () => {
    const fetchPage = vi.fn(async () => ({ items: [1, 2, 3], totalPages: 99 }));
    expect(await collect(paginatePages(fetchPage, 0, { maxItems: 4 }))).toEqual([1, 2, 3, 1]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });

  it("caps runaway listings with maxPages", async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], totalPages: Number.MAX_SAFE_INTEGER }));
    const items = await collect(paginatePages(fetchPage, 0, { maxPages: 3 }));
    expect(items).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("falls back to the default page cap for non-positive values", async () => {
    const fetchPage = vi.fn(async (page: number) =>
      page === 0 ? { items: [1], totalPages: 2 } : { items: [], totalPages: 2 },
    );
    expect(await collect(paginatePages(fetchPage, 0, { maxPages: 0 }))).toEqual([1]);
  });
});

describe("paginateCursor", () => {
  it("follows continuation markers until they run out", async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      if (cursor === undefined) return { items: ["a"], nextCursor: "c1" };
      if (cursor === "c1") return { items: ["b"], nextCursor: "c2" };
      return { items: ["c"] };
    });
    expect(await collect(paginateCursor(fetchPage, undefined))).toEqual(["a", "b", "c"]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it("stops when a page is empty even if a cursor is returned", async () => {
    const fetchPage = vi.fn(async () => ({ items: [] as string[], nextCursor: "loop" }));
    expect(await collect(paginateCursor(fetchPage, undefined))).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it("honors maxItems", async () => {
    const fetchPage = vi.fn(async () => ({ items: ["x", "y"], nextCursor: "next" }));
    expect(await collect(paginateCursor(fetchPage, undefined, { maxItems: 3 }))).toEqual([
      "x",
      "y",
      "x",
    ]);
  });
});

describe("client auto-pagination", () => {
  it("iterates Brreg search results across pages", async () => {
    const page = (number: number, totalPages: number): unknown => ({
      _embedded: { enheter: [companyFixture] },
      page: { size: 1, totalElements: totalPages, totalPages, number },
    });
    const fetch = vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      return jsonResponse(page(Number(url.searchParams.get("page") ?? 0), 2));
    }) as unknown as typeof globalThis.fetch;

    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    const companies = await collect(sdk.companies.searchAll({ name: "Eksempel", size: 1 }));
    expect(companies).toHaveLength(2);
    expect(companies[0]?.organizationNumber).toBe(companyFixture.organisasjonsnummer);
  });

  it("applies maxItems to a client iterator", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        _embedded: { enheter: [companyFixture] },
        page: { size: 1, totalElements: 100, totalPages: 100, number: 0 },
      }),
    ) as unknown as typeof globalThis.fetch;

    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    const companies = await collect(sdk.companies.searchAll({}, { maxItems: 2 }));
    expect(companies).toHaveLength(2);
  });
});
