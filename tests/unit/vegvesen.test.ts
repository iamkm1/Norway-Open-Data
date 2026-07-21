import nvdbRoadNetwork from "../fixtures/nvdb-road-network.json" with { type: "json" };
import nvdbRoadObjectType from "../fixtures/nvdb-road-object-type.json" with { type: "json" };
import nvdbRoadObjectTypes from "../fixtures/nvdb-road-object-types.json" with { type: "json" };
import nvdbRoadObjects from "../fixtures/nvdb-road-objects.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import {
  ConfigurationError,
  InputValidationError,
  NotFoundError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import type { ResolvedConfig } from "../../src/core/types.js";
import { VegvesenClient } from "../../src/providers/vegvesen/client.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

async function collect<T>(source: AsyncGenerator<T, void, undefined>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) items.push(item);
  return items;
}

function createClient(
  fetch: typeof globalThis.fetch,
  applicationName: string | null = "norway-open-data-sdk-tests",
  cacheEnabled = false,
): VegvesenClient {
  const resolvedApplicationName = applicationName ?? undefined;
  const config: ResolvedConfig = {
    ...(resolvedApplicationName === undefined ? {} : { applicationName: resolvedApplicationName }),
    timeoutMs: 1_000,
    retries: 0,
    fetch,
    cache: { enabled: cacheEnabled, maxEntries: 20 },
    credentials: { nve: {} },
  };
  return new VegvesenClient(new HttpClient(config), resolvedApplicationName);
}

function requestHeaders(mock: ReturnType<typeof vi.fn>, index = 0): Headers {
  const init = mock.mock.calls[index]?.[1] as RequestInit | undefined;
  return new Headers(init?.headers);
}

describe("VegvesenClient", () => {
  it("lists only public road-object types and sends the mandatory identity header", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjectTypes));
    const response = await createClient(fetch).getRoadObjectTypes({ includeRaw: true });

    expect(response.data).toEqual([
      expect.objectContaining({
        id: 105,
        name: "Fartsgrense",
        sensitive: false,
        categories: ["Vegnett - Regulering - Trafikk"],
      }),
    ]);
    expect(response.raw).toEqual([nvdbRoadObjectTypes[0]]);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/datakatalog/api/v1/vegobjekttyper");
    expect(url.searchParams.get("inkluder")).toBe("minimum");
    expect(requestHeaders(mock).get("X-Client")).toBe("norway-open-data-sdk-tests");
  });

  it("gets detailed type metadata and excludes sensitive property definitions", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjectType));
    const response = await createClient(fetch).getRoadObjectType(105, { includeRaw: true });

    expect(response.data).toMatchObject({
      id: 105,
      name: "Fartsgrense",
      properties: [
        {
          id: 2021,
          name: "Fartsgrense",
          valueType: "Heltallenum",
          required: true,
          unit: "km/h",
        },
      ],
    });
    expect(JSON.stringify(response.raw)).not.toContain("Skjermet egenskap");
    expect(response.raw).not.toEqual(nvdbRoadObjectType);
    expect(mock.mock.calls[0]?.[0]).toContain(
      "/datakatalog/api/v1/vegobjekttyper/105?inkluder=alle",
    );
  });

  it("constructs road-object filters, preserves dynamic values, and exposes continuation", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjects));
    const response = await createClient(fetch).searchRoadObjects({
      typeId: 105,
      municipalityCode: "1103",
      countyCode: "11",
      roadReference: "EV39S101D1",
      boundingBox: [5.7, 58.8, 5.8, 58.9],
      pageSize: 1,
      start: "previous:1",
    });

    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/vegobjekter/api/v4/vegobjekter/105");
    expect(url.searchParams.get("kommune")).toBe("1103");
    expect(url.searchParams.get("fylke")).toBe("11");
    expect(url.searchParams.get("vegsystemreferanse")).toBe("EV39S101D1");
    expect(url.searchParams.get("kartutsnitt")).toBe("5.7,58.8,5.8,58.9");
    expect(url.searchParams.get("antall")).toBe("1");
    expect(url.searchParams.get("start")).toBe("previous:1");
    expect(url.searchParams.get("srid")).toBe("4326");
    expect(url.searchParams.getAll("inkluder")).toEqual([
      "metadata",
      "egenskaper",
      "lokasjon",
      "geometri",
    ]);
    expect(response.data.items[0]).toMatchObject({
      id: 79558610,
      typeId: 105,
      typeName: "Fartsgrense",
      version: 2,
      properties: [
        { id: 2021, name: "Fartsgrense", value: 90, unit: "km/h" },
        { id: 220001, name: "Relasjoner", value: [{ id: 12345, type: "Eksempel" }] },
      ],
      location: {
        municipalityCodes: ["1103", "1108"],
        countyCodes: ["11"],
        roadReferences: ["EV39 S101D1 m0-757"],
      },
    });
    expect(response.data.pagination).toEqual({
      returned: 1,
      pageSize: 1,
      totalItems: 12,
      nextStart: "79558610:2",
      nextUrl:
        "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/105?start=79558610%3A2",
    });
  });

  it("gets a single road object through the V4 endpoint", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjects.objekter[0]));
    const response = await createClient(fetch).getRoadObject(105, 79558610);

    expect(response.data).toMatchObject({ id: 79558610, typeId: 105 });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/vegobjekter/api/v4/vegobjekter/105/79558610");
    expect(url.searchParams.get("srid")).toBe("4326");
  });

  it("gets segmented road-network data and maps official road categories", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadNetwork));
    const response = await createClient(fetch).getRoadNetwork({
      municipalityCode: "1103",
      roadCategory: ["E", "R"],
      pageSize: 1,
      start: "prior-network-token",
    });

    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/vegnett/api/v4/veglenkesekvenser/segmentert");
    expect(url.searchParams.get("vegsystemreferanse")).toBe("EV,RV");
    expect(url.searchParams.get("start")).toBe("prior-network-token");
    expect(response.data.items[0]).toEqual({
      sequenceId: 281042,
      linkNumber: 1,
      segmentNumber: 5,
      startPosition: 0,
      endPosition: 0.49906761,
      length: 562.066,
      roadType: "Enkel bilveg",
      detailLevel: "Vegtrase og kjørebane",
      municipalityCode: "1103",
      countyCode: "11",
      roadReference: "PV4058 S2D1 m0-562",
      geometry: {
        wkt: "LINESTRING (6.05278514 59.28048865,6.05321338 59.2804539)",
      },
    });
    expect(response.data.pagination.nextStart).toBe("281042:5");
  });

  it("iterates road objects through opaque continuation markers", async () => {
    const terminal = {
      objekter: nvdbRoadObjects.objekter,
      metadata: { antall: 12, returnert: 1, sidestørrelse: 1 },
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjects), jsonResponse(terminal));

    const items = await collect(createClient(fetch).searchRoadObjectsAll({ typeId: 105 }));

    expect(items).toHaveLength(2);
    expect(new URL(String(mock.mock.calls[1]?.[0])).searchParams.get("start")).toBe("79558610:2");
  });

  it("iterates road-network segments through opaque continuation markers", async () => {
    const terminal = {
      objekter: nvdbRoadNetwork.objekter,
      metadata: { returnert: 1, sidestørrelse: 1 },
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadNetwork), jsonResponse(terminal));

    const items = await collect(createClient(fetch).getRoadNetworkAll());

    expect(items).toHaveLength(2);
    expect(new URL(String(mock.mock.calls[1]?.[0])).searchParams.get("start")).toBe("281042:5");
  });

  it("stops a repeated NVDB cursor before requesting the same page twice", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(nvdbRoadNetwork),
      jsonResponse(nvdbRoadNetwork),
    );

    await expect(collect(createClient(fetch).getRoadNetworkAll())).rejects.toMatchObject({
      name: "ResponseValidationError",
      provider: "vegvesen",
      message: expect.stringMatching(/repeated pagination cursor/u),
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("requires applicationName before making any NVDB request", async () => {
    const fetch = vi.fn(async () => jsonResponse(nvdbRoadObjectTypes));
    await expect(createClient(fetch, null).getRoadObjectTypes()).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects invalid filters and documented sensitive types before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse(nvdbRoadObjects));
    const client = createClient(fetch as typeof globalThis.fetch);

    await expect(
      client.searchRoadObjects({ typeId: 105, municipalityCode: "11" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      client.searchRoadObjects({ typeId: 105, boundingBox: [6, 59, 5, 58] }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getRoadObject(871, 1)).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getRoadObjectType(-1)).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed provider responses", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ objekter: [{}], metadata: {} }));
    await expect(createClient(fetch).searchRoadObjects({ typeId: 105 })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("does not expose a repeated continuation marker from an empty terminal page", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        objekter: [],
        metadata: {
          returnert: 0,
          sidestørrelse: 100,
          neste: {
            start: "same-token",
            href: "https://nvdbapiles.atlas.vegvesen.no/vegobjekter/api/v4/vegobjekter/105?start=same-token",
          },
        },
      }),
    );
    const response = await createClient(fetch).searchRoadObjects({
      typeId: 105,
      start: "same-token",
    });
    expect(response.data.pagination).toEqual({ returned: 0, pageSize: 100 });
  });

  it.each(["objects", "network"] as const)(
    "round-trips opaque %s continuation tokens without trimming",
    async (kind) => {
      const payload = kind === "objects" ? nvdbRoadObjects : nvdbRoadNetwork;
      const { fetch, mock } = sequenceFetch(jsonResponse(payload));
      const client = createClient(fetch);
      if (kind === "objects") {
        await client.searchRoadObjects({ typeId: 105, start: " token with spaces " });
      } else {
        await client.getRoadNetwork({ start: " token with spaces " });
      }
      const url = new URL(String(mock.mock.calls[0]?.[0]));
      expect(url.searchParams.get("start")).toBe(" token with spaces ");
    },
  );

  it.each([
    {
      objekter: nvdbRoadObjects.objekter,
      metadata: { returnert: 0, sidestørrelse: 1 },
    },
    {
      objekter: nvdbRoadObjects.objekter,
      metadata: { returnert: 1, sidestørrelse: 0 },
    },
    {
      objekter: nvdbRoadObjects.objekter,
      metadata: { antall: 0, returnert: 1, sidestørrelse: 1 },
    },
    {
      objekter: [],
      metadata: {
        returnert: 0,
        sidestørrelse: 100,
        neste: { start: "", href: "https://nvdbapiles.atlas.vegvesen.no/next" },
      },
    },
  ])("rejects malformed NVDB pagination metadata", async (payload) => {
    const { fetch } = sequenceFetch(jsonResponse(payload));
    await expect(createClient(fetch).searchRoadObjects({ typeId: 105 })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("preserves final and missing-total page semantics", async () => {
    const finalPage = {
      ...nvdbRoadObjects,
      metadata: { returnert: 1, sidestørrelse: 1 },
    };
    const { fetch } = sequenceFetch(jsonResponse(finalPage));
    const response = await createClient(fetch).searchRoadObjects({ typeId: 105 });
    expect(response.data.pagination).toEqual({ returned: 1, pageSize: 1 });
  });

  it("blocks sensitive response types and properties from normalized and raw output", async () => {
    const publicType = nvdbRoadObjectTypes[0];
    if (publicType === undefined) throw new Error("NVDB type fixture must contain a public type.");
    const typeList = sequenceFetch(
      jsonResponse([...nvdbRoadObjectTypes, { ...publicType, id: 871, sensitiv: false }]),
    );
    const listed = await createClient(typeList.fetch).getRoadObjectTypes({ includeRaw: true });
    expect(listed.data.some((type) => type.id === 871)).toBe(false);
    expect(JSON.stringify(listed.raw)).not.toContain('"id":871');

    const blockedObjectPayload = structuredClone(nvdbRoadObjects);
    const blockedObject = blockedObjectPayload.objekter[0];
    if (blockedObject === undefined) throw new Error("NVDB object fixture must contain an object.");
    blockedObject.metadata.type.id = 871;
    const blocked = sequenceFetch(jsonResponse(blockedObjectPayload));
    await expect(
      createClient(blocked.fetch).searchRoadObjects({ typeId: 105 }, { includeRaw: true }),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const propertyPayload = structuredClone(nvdbRoadObjects);
    const object = propertyPayload.objekter[0];
    if (object === undefined) throw new Error("NVDB object fixture must contain an object.");
    object.egenskaper.push({
      id: 999999,
      navn: "blocked-property-marker",
      verdi: "blocked-property-value",
      sensitivitet: 1,
    } as unknown as (typeof object.egenskaper)[number]);
    const properties = sequenceFetch(jsonResponse(propertyPayload));
    const response = await createClient(properties.fetch).searchRoadObjects(
      { typeId: 105 },
      { includeRaw: true },
    );
    expect(JSON.stringify(response.data)).not.toContain("blocked-property");
    expect(JSON.stringify(response.raw)).not.toContain("blocked-property");
  });

  it("uses the provider metadata cache TTL when caching is enabled", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(nvdbRoadObjectType));
    const client = createClient(fetch, "cache-test", true);

    const first = await client.getRoadObjectType(105);
    const second = await client.getRoadObjectType(105);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("surfaces a not-found road object through the shared error model", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 404));
    await expect(createClient(fetch).getRoadObject(105, 999999999)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
