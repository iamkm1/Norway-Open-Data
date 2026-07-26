import datasetFixture from "../fixtures/geonorge-dataset.json" with { type: "json" };
import searchFixture from "../fixtures/geonorge-search.json" with { type: "json" };
import serviceFixture from "../fixtures/geonorge-service.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import { InputValidationError, ResponseValidationError } from "../../src/core/errors.js";
import { GeonorgeClient } from "../../src/providers/geonorge/client.js";
import {
  geonorgeMetadataSchema,
  geonorgeSearchResponseSchema,
} from "../../src/providers/geonorge/schemas.js";
import { collect, jsonResponse, resolvedConfig, sequenceFetch } from "./helpers.js";

function clientFor(fetch: typeof globalThis.fetch): GeonorgeClient {
  return new GeonorgeClient(new HttpClient(resolvedConfig(fetch)));
}

describe("Geonorge client", () => {
  it("translates zero-based offsets, builds exact facets, and keeps search hits light", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(searchFixture));
    const response = await clientFor(fetch).searchDatasets(
      {
        query: "boundary",
        publisher: "Kartverket",
        theme: "Basis geodata",
        offset: 0,
        limit: 2,
      },
      { includeRaw: true },
    );

    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://kartkatalog.geonorge.no/api/search");
    expect(url.searchParams.get("text")).toBe("boundary");
    expect(url.searchParams.get("offset")).toBe("1");
    expect(url.searchParams.get("limit")).toBe("2");
    expect(url.searchParams.get("orderby")).toBe("title");
    expect(url.searchParams.get("facets[0]name")).toBe("type");
    expect(url.searchParams.get("facets[0]value")).toBe("dataset");
    expect(url.searchParams.get("facets[1]name")).toBe("organization");
    expect(url.searchParams.get("facets[1]value")).toBe("Kartverket");
    expect(url.searchParams.get("facets[2]name")).toBe("theme");
    expect(url.searchParams.get("facets[2]value")).toBe("Basis geodata");
    const headers = new Headers(mock.mock.calls[0]?.[1]?.headers as HeadersInit);
    expect(headers.get("Accept-Language")).toBe("nb-NO");

    expect(response.data.pagination).toEqual({
      offset: 0,
      limit: 2,
      returned: 2,
      totalItems: 3,
      hasMore: true,
      truncated: true,
    });
    expect(response.data.items[0]).toMatchObject({
      id: "dataset-a",
      type: "dataset",
      title: "Administrative units",
      publisher: "Kartverket",
      themes: ["Basis geodata"],
      access: {
        isOpenData: true,
        isRestricted: false,
        isProtected: false,
      },
    });
    expect(response.data.items[0]).not.toHaveProperty("distributions");
    expect(response.raw).toMatchObject({ NumFound: 3, Type: "dataset" });
  });

  it("caps page size at 100 rather than forwarding an unbounded limit", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse({ NumFound: 0, Limit: 100, Offset: 1, Results: [] }),
    );
    const response = await clientFor(fetch).searchDatasets({ limit: 50_000 });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.searchParams.get("limit")).toBe("100");
    expect(response.data.pagination.limit).toBe(100);
  });

  it("normalizes detailed dataset metadata and preserves validated raw fields on request", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(datasetFixture));
    const response = await clientFor(fetch).getDataset("no.met.adc:weather/product", {
      includeRaw: true,
    });

    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe(
      "/api/getdata/no.met.adc%3Aweather%2Fproduct",
    );
    expect(response.data).toMatchObject({
      id: "no.met.adc:weather/product",
      type: "dataset",
      title: "Weather observations",
      publisher: "Meteorologisk institutt",
      themes: ["Klima og meteorologi", "Vær og klima"],
      keywords: ["vær", "observasjoner"],
      geographicExtent: { south: 57, west: -18, north: 72, east: 33 },
      license: {
        name: "Norsk lisens for offentlige data (NLOD) 2.0",
        url: "https://data.norge.no/nlod/no/2.0",
      },
      attribution: "Credit Meteorologisk institutt.",
      useLimitations: "Do not imply that the publisher endorses derived products.",
      access: {
        isOpenData: true,
        isRestricted: false,
        isProtected: false,
        label: "Åpne data",
      },
      updates: {
        createdAt: "2020-01-02T00:00:00",
        updatedAt: "2026-06-15T10:20:30Z",
        maintenanceFrequency: "Daglig",
        status: "Pågående",
      },
    });
    expect(response.data.referenceSystems).toHaveLength(2);
    expect(response.data.contacts).toHaveLength(3);

    expect(response.data.distributions[0]).toMatchObject({
      kind: "wfs",
      protocol: "OGC:WFS",
      formats: [{ name: "GML", version: "3.2" }],
    });
    const ogcFeatures = response.data.distributions.find(
      (distribution) => distribution.kind === "ogc-api-features",
    );
    expect(ogcFeatures).toMatchObject({ protocol: "OGC:API-Features" });
    const arcGis = response.data.distributions.find(
      (distribution) => distribution.kind === "arcgis-rest",
    );
    expect(arcGis?.formats).toEqual([{ name: "GeoJSON" }, { name: "JSON" }]);
    expect(
      response.data.distributions.find((distribution) => distribution.kind === "download-api"),
    ).toMatchObject({
      protocol: "GEONORGE:DOWNLOAD",
      unitsOfDistribution: "landsfiler",
    });
    expect(
      response.data.distributions.find((distribution) => distribution.kind === "unknown"),
    ).toMatchObject({ protocol: "VENDOR:CUSTOM" });

    expect(response.data.services).toEqual([
      {
        id: "service-wms",
        title: "Weather observations WMS",
        kind: "wms",
        protocol: "OGC:WMS",
        url: "https://example.test/wms?service=WMS&request=GetCapabilities",
      },
      {
        kind: "wfs",
        protocol: "OGC:WFS",
        url: "https://example.test/wfs?service=WFS&request=GetCapabilities",
      },
    ]);
    expect(response.raw).toMatchObject({ ServiceUuid: "service-wms" });
  });

  it("normalizes service endpoints and deduplicates operates-on identifiers", async () => {
    const { fetch } = sequenceFetch(jsonResponse(serviceFixture));
    const response = await clientFor(fetch).getService("service-wms");
    expect(response.data).toMatchObject({
      type: "service",
      serviceType: "view",
      operatesOn: ["no.met.adc:weather/product"],
    });
    expect(response.data.distributions).toEqual([
      {
        kind: "wms",
        protocol: "OGC:WMS",
        protocolName: "WMS-tjeneste",
        url: "https://example.test/wms?service=WMS&request=GetCapabilities",
        organization: "Meteorologisk institutt",
        formats: [{ name: "PNG", version: "1.3.0" }],
      },
    ]);
    expect(response.raw).toBeUndefined();
  });

  it("walks item offsets by returned count in deterministic order", async () => {
    const third = {
      ...searchFixture.Results[0],
      Uuid: "dataset-c",
      Title: "Coastline",
    };
    const { fetch, mock } = sequenceFetch(
      jsonResponse(searchFixture),
      jsonResponse({
        ...searchFixture,
        Offset: 3,
        Results: [third],
      }),
    );

    const items = await collect(
      clientFor(fetch).searchDatasetsAll({ query: "data", limit: 2 }, { maxPages: 3 }),
    );
    expect(items.map((item) => item.id)).toEqual(["dataset-a", "dataset-b", "dataset-c"]);
    expect(
      mock.mock.calls.map((call) => new URL(String(call[0])).searchParams.get("offset")),
    ).toEqual(["1", "3"]);
  });

  it("stops iterators before yielding a repeated or overlapping page", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({ ...searchFixture, NumFound: 4 }),
      jsonResponse({ ...searchFixture, NumFound: 4, Offset: 3 }),
    );
    await expect(
      collect(clientFor(fetch).searchDatasetsAll({ limit: 2 }, { maxPages: 3 })),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("does not send a request when an iterator maxItems bound is zero", async () => {
    let requested = false;
    const fetch = async (): Promise<Response> => {
      requested = true;
      return jsonResponse({});
    };
    await expect(collect(clientFor(fetch).searchDatasetsAll({}, { maxItems: 0 }))).resolves.toEqual(
      [],
    );
    expect(requested).toBe(false);
  });

  it.each([{ query: "" }, { offset: 100_001 }, { limit: 0 }])(
    "rejects invalid search input before requesting: %o",
    async (parameters) => {
      const client = clientFor(async () => jsonResponse({}));
      await expect(client.searchDatasets(parameters)).rejects.toBeInstanceOf(InputValidationError);
    },
  );

  it.each(["", ".", "..", `bad${String.fromCharCode(0)}id`])(
    "rejects an invalid opaque metadata identifier: %s",
    async (id) => {
      const client = clientFor(async () => jsonResponse({}));
      await expect(client.getMetadata(id)).rejects.toBeInstanceOf(InputValidationError);
    },
  );

  it("rejects a provider type mismatch in search and typed lookup methods", async () => {
    const wrongSearch = {
      ...searchFixture,
      Results: searchFixture.Results.map((hit) => ({ ...hit, Type: "service" })),
    };
    const searchClient = clientFor(sequenceFetch(jsonResponse(wrongSearch)).fetch);
    await expect(searchClient.searchDatasets({ limit: 2 })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );

    const lookupClient = clientFor(sequenceFetch(jsonResponse(serviceFixture)).fetch);
    await expect(lookupClient.getDataset("service-wms")).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("rejects malformed used fields and invalid WGS84 extents", async () => {
    const missingAccessFlag = {
      ...datasetFixture,
      AccessIsProtected: undefined,
    };
    const malformedClient = clientFor(sequenceFetch(jsonResponse(missingAccessFlag)).fetch);
    await expect(malformedClient.getMetadata("no.met.adc:weather/product")).rejects.toBeInstanceOf(
      ResponseValidationError,
    );

    const invalidExtent = {
      ...datasetFixture,
      BoundingBox: {
        ...datasetFixture.BoundingBox,
        NorthBoundLatitude: "200,00",
      },
    };
    const extentClient = clientFor(sequenceFetch(jsonResponse(invalidExtent)).fetch);
    await expect(extentClient.getMetadata("no.met.adc:weather/product")).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("rejects unknown catalogue fields at root and consumed nested boundaries", () => {
    const unknownSearchRoot = { ...searchFixture, UnexpectedSearchField: true };
    const unknownSearchHit = {
      ...searchFixture,
      Results: [
        { ...searchFixture.Results[0], UnexpectedHitField: true },
        searchFixture.Results[1],
      ],
    };
    const unknownMetadataRoot = { ...datasetFixture, UnexpectedMetadataField: true };
    const unknownConstraintsField = {
      ...datasetFixture,
      Constraints: {
        ...datasetFixture.Constraints,
        UnexpectedConstraintField: true,
      },
    };

    for (const [schema, value] of [
      [geonorgeSearchResponseSchema, unknownSearchRoot],
      [geonorgeSearchResponseSchema, unknownSearchHit],
      [geonorgeMetadataSchema, unknownMetadataRoot],
      [geonorgeMetadataSchema, unknownConstraintsField],
    ] as const) {
      expect(schema.safeParse(value).success).toBe(false);
    }
  });
});
