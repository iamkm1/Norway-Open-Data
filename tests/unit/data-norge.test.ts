import dataServiceFixture from "../fixtures/data-norge-service.json" with { type: "json" };
import dataServiceSearchFixture from "../fixtures/data-norge-service-search.json" with { type: "json" };
import datasetFixture from "../fixtures/data-norge-dataset.json" with { type: "json" };
import searchFixture from "../fixtures/data-norge-search.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import {
  InputValidationError,
  RateLimitError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import { DataNorgeClient } from "../../src/providers/data-norge/client.js";
import { dataNorgePublisherTurtle } from "../fixtures/data-norge-publisher.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

function createClient(fetch: typeof globalThis.fetch, cacheEnabled = false): DataNorgeClient {
  return new DataNorgeClient(
    new HttpClient({
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: cacheEnabled, maxEntries: 100 },
      credentials: { nve: {} },
    }),
  );
}

describe("Data.norge catalogue", () => {
  it("constructs a filtered type-specific search and normalizes pagination", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(searchFixture));
    const result = await createClient(fetch).search(
      {
        query: "weather",
        type: ["dataset"],
        publisher: "/STAT/972417904/971032081",
        accessRights: "PUBLIC",
        page: 0,
        size: 1,
      },
      { includeRaw: true },
    );

    expect(result.data).toEqual({
      items: [
        {
          id: "fd3f4eaa-ae1b-3f02-b54c-a93e74a2c7af",
          type: "dataset",
          title: "Værdata",
          description: "Meteorologiske måleverdier fra værstasjoner langs vegnettet.",
          publisher: {
            id: "971032081",
            name: "Statens vegvesen",
            uri: "https://data.norge.no/organizations/971032081",
            organizationPath: "/STAT/972417904/971032081",
          },
          accessRights: "PUBLIC",
        },
      ],
      pagination: { page: 0, size: 1, totalItems: 1, totalPages: 1 },
    });
    expect(result.raw).toEqual(searchFixture);
    expect(mock.mock.calls[0]?.[0]).toBe(
      "https://search.api.fellesdatakatalog.digdir.no/search/datasets",
    );
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      query: "weather",
      filters: {
        orgPath: { value: "/STAT/972417904/971032081" },
        accessRights: { value: "PUBLIC" },
      },
      pagination: { page: 0, size: 1 },
    });
  });

  it("combines several explicitly requested resource types deterministically", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse({
        ...searchFixture,
        page: { currentPage: 0, size: 2, totalElements: 1, totalPages: 1 },
      }),
      jsonResponse(dataServiceSearchFixture),
    );
    const result = await createClient(fetch).search({
      query: "weather",
      type: ["dataset", "data-service"],
      size: 2,
    });

    expect(result.data.items.map((item) => item.type)).toEqual(["dataset", "data-service"]);
    expect(result.data.pagination).toEqual({ page: 0, size: 2, totalItems: 2, totalPages: 1 });
    expect(mock.mock.calls.map((call) => String(call[0]))).toEqual([
      "https://search.api.fellesdatakatalog.digdir.no/search/datasets",
      "https://search.api.fellesdatakatalog.digdir.no/search/data-services",
    ]);
  });

  it("normalizes stable dataset and data-service resource responses", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(datasetFixture),
      jsonResponse(dataServiceFixture),
    );
    const client = createClient(fetch);
    const dataset = await client.getDataset(datasetFixture.id);
    const service = await client.getDataService(dataServiceFixture.id);

    expect(dataset.data).toMatchObject({
      id: datasetFixture.id,
      type: "dataset",
      title: "Værdata",
      accessRights: "PUBLIC",
      license: "https://data.norge.no/nlod/no/2.0",
      landingPage: "https://dataut.vegvesen.no/weather",
      distributions: [
        {
          title: "Værdata som JSON",
          accessUrl: "https://dataut.vegvesen.no/weather/api",
          downloadUrl: "https://dataut.vegvesen.no/weather.json",
          format: "JSON",
        },
      ],
    });
    expect(service.data).toMatchObject({
      id: dataServiceFixture.id,
      type: "data-service",
      title: "Subseasonal",
      license: "http://publications.europa.eu/resource/authority/licence/CC_BY_4_0",
      landingPage: "https://api.met.no/weatherapi/subseasonal/1.0/documentation",
    });
    expect(mock.mock.calls[0]?.[0]).toContain(`/v1/datasets/${datasetFixture.id}`);
    expect(mock.mock.calls[1]?.[0]).toContain(`/v1/data-services/${dataServiceFixture.id}`);
  });

  it("parses the prescribed publisher URI's Turtle response", async () => {
    const { fetch, mock } = sequenceFetch(
      new Response(dataNorgePublisherTurtle, { headers: { "Content-Type": "text/turtle" } }),
    );
    const result = await createClient(fetch).getPublisher("991825827", { includeRaw: true });

    expect(result.data).toEqual({
      id: "991825827",
      uri: "https://organization-catalog.fellesdatakatalog.digdir.no/organizations/991825827",
      name: "Digitaliseringsdirektoratet",
      legalName: "DIGITALISERINGSDIREKTORATET",
      organizationPath: "/STAT/932384469/991825827",
      homepage: "https://www.digdir.no/",
      parentId: "932384469",
      organizationType: "ORGL",
      status: "NormalAktivitet",
    });
    expect(result.raw).toBe(dataNorgePublisherTurtle);
    const headers = new Headers((mock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get("Accept")).toBe("text/turtle");
  });

  it("resolves an organization number to its organization path before search", async () => {
    const { fetch, mock } = sequenceFetch(
      new Response(dataNorgePublisherTurtle),
      jsonResponse(searchFixture),
    );
    await createClient(fetch).search({ query: "weather", publisher: "991825827" });

    expect(mock).toHaveBeenCalledTimes(2);
    const searchBody = JSON.parse(String((mock.mock.calls[1]?.[1] as RequestInit).body));
    expect(searchBody.filters.orgPath.value).toBe("/STAT/932384469/991825827");
  });

  it("supports empty searches and caches search metadata for ten minutes", async () => {
    const empty = {
      hits: [],
      aggregations: {},
      page: { currentPage: 0, size: 10, totalElements: 0, totalPages: 0 },
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(empty));
    const client = createClient(fetch, true);
    const first = await client.search({ query: "definitely-not-present" });
    const second = await client.search({ query: "definitely-not-present" });

    expect(first.data.items).toEqual([]);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it.each([
    { currentPage: 0, size: 1, totalElements: 3, totalPages: 3 },
    { currentPage: 1, size: 1, totalElements: 3, totalPages: 3 },
    { currentPage: 2, size: 1, totalElements: 3, totalPages: 3 },
  ])("preserves coherent single-type page metadata: %o", async (page) => {
    const { fetch } = sequenceFetch(jsonResponse({ ...searchFixture, page }));
    const response = await createClient(fetch).search({ query: "weather", type: ["dataset"] });
    expect(response.data.pagination).toEqual({
      page: page.currentPage,
      size: page.size,
      totalItems: page.totalElements,
      totalPages: page.totalPages,
    });
  });

  it.each([
    { currentPage: 0, size: 0, totalElements: 1, totalPages: 0 },
    { currentPage: 0, size: 1, totalElements: 1, totalPages: 0 },
    { currentPage: 0, size: 1, totalElements: 0, totalPages: 0 },
    { currentPage: 0, size: 1, totalPages: 1 },
  ])("rejects malformed provider pagination: %o", async (page) => {
    const { fetch } = sequenceFetch(jsonResponse({ ...searchFixture, page }));
    await expect(createClient(fetch).search({ query: "weather" })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("rejects invalid identifiers and malformed responses", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const client = createClient(fetch);
    await expect(client.getDataset("../dataset")).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getPublisher("123")).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      client.search({
        query: "weather",
        type: ["dataset", "data-service"],
        page: 2,
        size: 50,
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();

    const malformed = sequenceFetch(jsonResponse({ hits: [] }));
    await expect(createClient(malformed.fetch).search({ query: "weather" })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("surfaces the catalogue's documented rate limit", async () => {
    const { fetch } = sequenceFetch(
      new Response("rate limited", { status: 429, headers: { "Retry-After": "60" } }),
    );
    await expect(createClient(fetch).search({ query: "weather" })).rejects.toMatchObject({
      constructor: RateLimitError,
      retryAfter: 60,
    });
  });

  it("does not cache malformed Turtle and verifies resource response identity", async () => {
    const turtle = sequenceFetch(
      new Response("this is not publisher Turtle"),
      new Response(dataNorgePublisherTurtle),
    );
    const client = createClient(turtle.fetch, true);
    await expect(client.getPublisher("991825827")).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(client.getPublisher("991825827")).resolves.toBeDefined();
    expect(turtle.mock).toHaveBeenCalledTimes(2);

    const mismatch = sequenceFetch(jsonResponse({ ...datasetFixture, id: "different-id" }));
    await expect(createClient(mismatch.fetch).getDataset(datasetFixture.id)).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });
});
