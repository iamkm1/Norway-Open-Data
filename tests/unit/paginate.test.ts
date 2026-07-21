import companyFixture from "../fixtures/brreg-company.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { InputValidationError, ResponseValidationError } from "../../src/core/errors.js";
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

  it("does not request or yield anything when maxItems is zero", async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], totalPages: 1 }));

    expect(await collect(paginatePages(fetchPage, 0, { maxItems: 0 }))).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid maxItems %s before requesting",
    async (maxItems) => {
      const fetchPage = vi.fn(async () => ({ items: [1], totalPages: 1 }));
      const result = collect(paginatePages(fetchPage, 0, { maxItems }));

      await expect(result).rejects.toBeInstanceOf(InputValidationError);
      await expect(result).rejects.toThrow(/maxItems/u);
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );

  it("caps runaway listings with maxPages", async () => {
    const fetchPage = vi.fn(async () => ({ items: [1], totalPages: Number.MAX_SAFE_INTEGER }));
    const items = await collect(paginatePages(fetchPage, 0, { maxPages: 3 }));
    expect(items).toHaveLength(3);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 101])(
    "rejects invalid or unsafe maxPages %s before requesting",
    async (maxPages) => {
      const fetchPage = vi.fn(async () => ({ items: [1], totalPages: 1 }));
      const result = collect(paginatePages(fetchPage, 0, { maxPages }));

      await expect(result).rejects.toBeInstanceOf(InputValidationError);
      await expect(result).rejects.toThrow(/maxPages/u);
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );
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

  it("rejects an immediately repeated cursor before requesting its page twice", async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => ({
      items: [cursor ?? "initial"],
      nextCursor: "same",
    }));
    const yielded: string[] = [];

    const result = (async () => {
      for await (const item of paginateCursor(fetchPage, undefined)) yielded.push(item);
    })();

    await expect(result).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(result).rejects.toThrow(/repeated pagination cursor/u);
    expect(yielded).toEqual(["initial", "same"]);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "same");
  });

  it("also bounds a provider that repeats an empty cursor", async () => {
    const fetchPage = vi.fn(async (cursor: string | undefined) => ({
      items: [cursor ?? "initial"],
      nextCursor: "",
    }));

    await expect(collect(paginateCursor(fetchPage, undefined))).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "");
  });

  it("rejects a cursor cycle before requesting an earlier page again", async () => {
    const pages = new Map<string | undefined, { items: string[]; nextCursor: string }>([
      [undefined, { items: ["initial"], nextCursor: "a" }],
      ["a", { items: ["a"], nextCursor: "b" }],
      ["b", { items: ["b"], nextCursor: "a" }],
    ]);
    const fetchPage = vi.fn(async (cursor: string | undefined) => {
      const page = pages.get(cursor);
      if (page === undefined) throw new Error("Unexpected cursor.");
      return page;
    });
    const yielded: string[] = [];

    const result = (async () => {
      for await (const item of paginateCursor(fetchPage, undefined)) yielded.push(item);
    })();

    await expect(result).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(result).rejects.toThrow(/repeated pagination cursor/u);
    expect(yielded).toEqual(["initial", "a", "b"]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, "a");
    expect(fetchPage).toHaveBeenNthCalledWith(3, "b");
  });

  it("honors maxItems", async () => {
    const fetchPage = vi.fn(async () => ({ items: ["x", "y"], nextCursor: "next" }));
    expect(await collect(paginateCursor(fetchPage, undefined, { maxItems: 3 }))).toEqual([
      "x",
      "y",
      "x",
    ]);
  });

  it("does not request or yield anything when maxItems is zero", async () => {
    const fetchPage = vi.fn(async () => ({ items: ["unexpected"], nextCursor: "next" }));

    expect(await collect(paginateCursor(fetchPage, undefined, { maxItems: 0 }))).toEqual([]);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1.5])(
    "rejects invalid maxItems %s before requesting",
    async (maxItems) => {
      const fetchPage = vi.fn(async () => ({ items: ["x"], nextCursor: "next" }));
      const result = collect(paginateCursor(fetchPage, undefined, { maxItems }));

      await expect(result).rejects.toBeInstanceOf(InputValidationError);
      await expect(result).rejects.toThrow(/maxItems/u);
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );

  it.each([-1, 0, Number.NaN, Number.POSITIVE_INFINITY, 1.5, 101])(
    "rejects invalid or unsafe maxPages %s before requesting",
    async (maxPages) => {
      const fetchPage = vi.fn(async () => ({ items: ["x"] }));
      const result = collect(paginateCursor(fetchPage, undefined, { maxPages }));

      await expect(result).rejects.toBeInstanceOf(InputValidationError);
      await expect(result).rejects.toThrow(/maxPages/u);
      expect(fetchPage).not.toHaveBeenCalled();
    },
  );
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
