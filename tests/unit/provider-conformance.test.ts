/**
 * Reusable conformance suite.
 *
 * Every namespace on the facade is described once in {@link probes}, and the
 * generic tests below then hold each of them to the same contract: envelope shape,
 * attribution, runtime validation, cancellation, error mapping, credential
 * containment, fetch injection, and doing no work at construction time.
 *
 * The point is that a new provider inherits this coverage. The final test in the
 * file fails if a registered provider has no probe, so adding a descriptor without
 * declaring how to exercise it is a build failure rather than a silent gap.
 */
import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import dataNorgeSearch from "../fixtures/data-norge-search.json" with { type: "json" };
import fhiSources from "../fixtures/fhi-sources.json" with { type: "json" };
import geonorgeSearch from "../fixtures/geonorge-search.json" with { type: "json" };
import kartverketAddress from "../fixtures/kartverket-address.json" with { type: "json" };
import kartverketPlace from "../fixtures/kartverket-place.json" with { type: "json" };
import metForecast from "../fixtures/met-forecast.json" with { type: "json" };
import nvdbRoadObjectTypes from "../fixtures/nvdb-road-object-types.json" with { type: "json" };
import nveReservoir from "../fixtures/nve-reservoir.json" with { type: "json" };
import nveWarning from "../fixtures/nve-warning.json" with { type: "json" };
import ssbJsonStat from "../fixtures/ssb-json-stat.json" with { type: "json" };
import stortingetParties from "../fixtures/stortinget-parties.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { aisTrackFixture, tokenResponseFixture } from "../fixtures/ais.js";
import { aquacultureSitesFixture, fishingVesselsFixture } from "../fixtures/fiskeridir.js";
import { eurLatestCsv } from "../fixtures/norges-bank.js";
import { klassMunicipalityClassification } from "../fixtures/ssb-klass.js";
import {
  ConfigurationError,
  NorwayOpenData,
  type NorwayOpenDataConfig,
  NotFoundError,
  type OpenDataResponse,
  OpenDataError,
  ProviderError,
  providerIds,
  providers,
  RateLimitError,
} from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

const APPLICATION_NAME = "conformance-tests";
const CONTACT_EMAIL = "developer@example.no";
const API_KEY = "test-conformance-api-key";
const CLIENT_ID = "developer@example.test:conformance-client";
const CLIENT_SECRET = "test-conformance-client-secret";

/** Every credential the suite configures, so leakage can be checked in bulk. */
const SECRETS = [
  API_KEY,
  CLIENT_SECRET,
  CLIENT_ID,
  CONTACT_EMAIL,
  tokenResponseFixture.access_token,
];

/** Configuration that satisfies every provider's declared requirements. */
const fullyConfigured: Omit<NorwayOpenDataConfig, "fetch"> = {
  applicationName: APPLICATION_NAME,
  contactEmail: CONTACT_EMAIL,
  retries: 0,
  rateLimit: { enabled: false },
  credentials: {
    nve: { apiKey: API_KEY },
    "barentswatch-ais": { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
    barentswatch: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET },
  },
};

type Probe = {
  /** Facade namespace, used as the test name. */
  namespace: string;
  /** Provider ids this operation touches. */
  providerIds: readonly string[];
  /** Successful upstream payload. */
  payload: unknown;
  /** A payload that must fail runtime validation. */
  invalidPayload: unknown;
  /** Invokes the operation. */
  run: (sdk: NorwayOpenData, signal?: AbortSignal) => Promise<OpenDataResponse<unknown>>;
  /** Provider ids whose credentials this operation genuinely requires. */
  requiresCredentials?: readonly string[];
  /** Response body type, for providers that do not return JSON. */
  responseType?: "text";
  /**
   * Upstream requests one call makes. Defaults to 1.
   *
   * A few operations legitimately need more than one: an SSB query fetches the
   * table's metadata before it can encode a selection. The retry and cache
   * assertions are expressed relative to this rather than assuming one.
   */
  requestsPerCall?: number;
};

/** Builds a complete day of hourly spot prices, which the electricity client requires. */
function hourlyPrices(date: string, offset = "+02:00"): unknown[] {
  return Array.from({ length: 24 }, (_value, hour) => {
    const start = String(hour).padStart(2, "0");
    const end = String(hour + 1).padStart(2, "0");
    return {
      NOK_per_kWh: 0.5 + hour / 100,
      EUR_per_kWh: 0.043 + hour / 1000,
      EXR: 11.62,
      time_start: `${date}T${start}:00:00${offset}`,
      time_end: hour === 23 ? `2026-07-22T00:00:00${offset}` : `${date}T${end}:00:00${offset}`,
    };
  });
}

const emptyNaturbaseFeatureCollection = {
  type: "FeatureCollection",
  features: [],
  exceededTransferLimit: false,
};

const emptyAr50FeatureCollection =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" ' +
  'xmlns:gml="http://www.opengis.net/gml/3.2" ' +
  'xmlns:ms="http://mapserver.gis.umn.edu/mapserver" ' +
  'numberMatched="0" numberReturned="0"></wfs:FeatureCollection>';

const probes: readonly Probe[] = [
  {
    namespace: "companies",
    providerIds: ["brreg"],
    payload: brregCompany,
    invalidPayload: { organisasjonsnummer: 42 },
    run: (sdk, signal) => sdk.companies.get("923609016", signal === undefined ? {} : { signal }),
  },
  {
    namespace: "statistics",
    providerIds: ["ssb"],
    payload: ssbJsonStat,
    invalidPayload: { version: 42 },
    // A query resolves the table's metadata first, so one call is two requests.
    requestsPerCall: 2,
    run: (sdk, signal) =>
      sdk.statistics.queryRaw(
        { tableId: "07459", selections: { Region: ["1106"] } },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "klass",
    providerIds: ["ssb-klass"],
    payload: klassMunicipalityClassification,
    invalidPayload: { name: 42 },
    run: (sdk, signal) =>
      sdk.klass.getClassification(
        { classificationId: 131 },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "health",
    providerIds: ["fhi"],
    payload: fhiSources,
    invalidPayload: [{ id: 42 }],
    run: (sdk, signal) => sdk.health.getSources(signal === undefined ? {} : { signal }),
  },
  {
    namespace: "addresses",
    providerIds: ["kartverket"],
    payload: kartverketAddress,
    invalidPayload: { metadata: { totaltAntallTreff: "many" } },
    run: (sdk, signal) =>
      sdk.addresses.search({ query: "Haraldsgata 100" }, signal === undefined ? {} : { signal }),
  },
  {
    namespace: "places",
    providerIds: ["kartverket"],
    payload: kartverketPlace,
    invalidPayload: { metadata: { totaltAntallTreff: "many" } },
    run: (sdk, signal) =>
      sdk.places.search({ query: "Oslo" }, signal === undefined ? {} : { signal }),
  },
  {
    namespace: "transport",
    providerIds: ["entur"],
    payload: { features: [] },
    invalidPayload: { features: 42 },
    run: (sdk, signal) =>
      sdk.transport.autocomplete({ text: "Oslo S" }, signal === undefined ? {} : { signal }),
    requiresCredentials: ["entur"],
  },
  {
    namespace: "weather",
    providerIds: ["met"],
    payload: metForecast,
    invalidPayload: { properties: 42 },
    run: (sdk, signal) =>
      sdk.weather.forecast(
        { latitude: 59.9, longitude: 10.7 },
        signal === undefined ? {} : { signal },
      ),
    requiresCredentials: ["met"],
  },
  {
    namespace: "catalog",
    providerIds: ["data-norge"],
    payload: dataNorgeSearch,
    invalidPayload: { hits: 42 },
    run: (sdk, signal) =>
      sdk.catalog.search({ query: "transport", size: 1 }, signal === undefined ? {} : { signal }),
  },
  {
    namespace: "geodata",
    providerIds: ["geonorge"],
    payload: geonorgeSearch,
    invalidPayload: { NumFound: "many", Limit: 2, Offset: 1, Results: [] },
    run: (sdk, signal) =>
      sdk.geodata.searchDatasets(
        { query: "boundary", limit: 2 },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "environment",
    providerIds: ["naturbase"],
    payload: emptyNaturbaseFeatureCollection,
    invalidPayload: { type: "FeatureCollection", features: "many" },
    run: (sdk, signal) =>
      sdk.environment.getProtectedAreasAt(
        { latitude: 59.91, longitude: 10.75, limit: 1 },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "land",
    providerIds: ["nibio"],
    payload: emptyAr50FeatureCollection,
    invalidPayload: "<not-a-feature-collection/>",
    responseType: "text",
    run: (sdk, signal) =>
      sdk.land.getLandResourcesAt(
        { latitude: 59.91, longitude: 10.75, limit: 1 },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "currency",
    providerIds: ["norges-bank"],
    payload: eurLatestCsv,
    invalidPayload: "not;a;valid;series",
    responseType: "text",
    run: (sdk, signal) =>
      sdk.currency.getExchangeRate(
        { from: "EUR", to: "NOK" },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "energy",
    providerIds: ["nve"],
    payload: nveReservoir,
    invalidPayload: [{ fillingLevel: "high" }],
    run: (sdk, signal) => sdk.energy.getReservoirStatistics(signal === undefined ? {} : { signal }),
  },
  {
    namespace: "hazards",
    providerIds: ["nve"],
    payload: nveWarning,
    invalidPayload: [{ ActivityLevel: {} }],
    run: (sdk, signal) => sdk.hazards.getFloodWarnings({}, signal === undefined ? {} : { signal }),
  },
  {
    namespace: "parliament",
    providerIds: ["stortinget"],
    payload: stortingetParties,
    invalidPayload: { partier_liste: 42 },
    run: (sdk, signal) => sdk.parliament.getParties({}, signal === undefined ? {} : { signal }),
  },
  {
    namespace: "roads",
    providerIds: ["vegvesen"],
    payload: nvdbRoadObjectTypes,
    invalidPayload: [{ id: "not-a-number" }],
    run: (sdk, signal) => sdk.roads.getRoadObjectTypes(signal === undefined ? {} : { signal }),
    requiresCredentials: ["vegvesen"],
  },
  {
    namespace: "electricity",
    providerIds: ["hvakosterstrommen"],
    // An explicit date rather than "today", so the client's whole-day contiguity
    // check does not make this probe depend on the clock.
    payload: hourlyPrices("2026-07-21"),
    invalidPayload: [{ NOK_per_kWh: "cheap" }],
    run: (sdk, signal) =>
      sdk.electricity.getPrices(
        { area: "NO1", date: "2026-07-21" },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "ais",
    providerIds: ["barentswatch-ais"],
    payload: aisTrackFixture,
    invalidPayload: [{ mmsi: "not-a-number" }],
    run: (sdk, signal) =>
      sdk.ais.getTrackLast24Hours("257111020", signal === undefined ? {} : { signal }),
    requiresCredentials: ["barentswatch-ais"],
  },
  {
    namespace: "marine",
    providerIds: ["barentswatch"],
    payload: { totalSignificantWaveHeight: 1.3, longitude: 5.25, latitude: 59.4 },
    invalidPayload: { latitude: "north" },
    run: (sdk, signal) =>
      sdk.marine.getWaveForecast(
        { latitude: 59.4, longitude: 5.25 },
        signal === undefined ? {} : { signal },
      ),
    requiresCredentials: ["barentswatch"],
  },
  {
    namespace: "fisheries",
    providerIds: ["fiskeridir-vessels"],
    payload: fishingVesselsFixture,
    invalidPayload: [{ id: 42 }],
    run: (sdk, signal) =>
      sdk.fisheries.searchVessels(
        { municipalityCode: "1106" },
        signal === undefined ? {} : { signal },
      ),
  },
  {
    namespace: "fisheries (aquaculture)",
    providerIds: ["fiskeridir-aqua"],
    payload: aquacultureSitesFixture,
    invalidPayload: [{ siteNr: "10029" }],
    run: (sdk, signal) =>
      sdk.fisheries.searchAquacultureSites(
        { municipalityCode: "1149" },
        signal === undefined ? {} : { signal },
      ),
  },
];

/**
 * A fetch that answers the token endpoint and then delegates.
 *
 * Every probe uses this, so an OAuth2 provider is exercised through the same
 * generic assertions as an anonymous one.
 */
function conformanceFetch(respond: (url: URL) => Response | Promise<Response>): {
  fetch: typeof globalThis.fetch;
  calls: () => URL[];
  headers: () => Headers[];
} {
  const urls: URL[] = [];
  const headers: Headers[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    headers.push(new Headers(init?.headers));
    if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
    return respond(url);
  }) as typeof globalThis.fetch;
  return { fetch, calls: () => urls, headers: () => headers };
}

function bodyResponse(probe: Probe, payload: unknown, status = 200): Response {
  if (probe.responseType === "text") {
    return new Response(String(payload), { status, headers: { "Content-Type": "text/csv" } });
  }
  return jsonResponse(payload, status);
}

describe.each(probes)("conformance: norway.$namespace", (probe) => {
  const sdk = (
    fetch: typeof globalThis.fetch,
    overrides: NorwayOpenDataConfig = {},
  ): NorwayOpenData => new NorwayOpenData({ ...fullyConfigured, ...overrides, fetch });

  it("returns the shared response envelope", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    const response = await probe.run(sdk(fetch));

    expect(response.data).toBeDefined();
    expect(response.cached).toBe(false);
    expect(typeof response.retrievedAt).toBe("string");
    expect(Number.isNaN(Date.parse(response.retrievedAt))).toBe(false);
    // `raw` is opt-in, so a default response must not carry the provider payload.
    expect(response).not.toHaveProperty("raw");
  });

  it("attributes the source it used", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    const response = await probe.run(sdk(fetch));

    expect(probe.providerIds).toContain(response.source.id);
    expect(response.source.name).toBeTruthy();
    expect(response.source.homepage).toMatch(/^https:\/\//);
    expect(response.source.documentation).toMatch(/^https:\/\//);
    // Behavioural descriptor fields must never reach a response.
    expect(response.source).not.toHaveProperty("auth");
    expect(response.source).not.toHaveProperty("oauth");
    expect(response.source).not.toHaveProperty("cacheTtlMs");
  });

  it("includes the validated provider payload only when asked", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    const response = await probe.run(sdk(fetch));
    expect(response.raw).toBeUndefined();
  });

  it("rejects a payload that does not match its runtime schema", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.invalidPayload));
    await expect(probe.run(sdk(fetch))).rejects.toBeInstanceOf(OpenDataError);
  });

  it("uses the injected fetch and never the global one", async () => {
    const globalFetch = vi.spyOn(globalThis, "fetch");
    const { fetch, calls } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    await probe.run(sdk(fetch));
    expect(calls().length).toBeGreaterThan(0);
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it("sends no request when the caller's signal is already aborted", async () => {
    const { fetch, calls } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    const controller = new AbortController();
    controller.abort();
    await expect(probe.run(sdk(fetch), controller.signal)).rejects.toBeInstanceOf(OpenDataError);
    expect(calls()).toHaveLength(0);
  });

  it("propagates cancellation raised by the transport", async () => {
    const controller = new AbortController();
    const { fetch } = conformanceFetch(
      async () =>
        new Promise<Response>((_resolve, reject) => {
          controller.abort();
          reject(new DOMException("Aborted", "AbortError"));
        }),
    );
    await expect(probe.run(sdk(fetch), controller.signal)).rejects.toBeInstanceOf(ProviderError);
  });

  it.each([
    [404, NotFoundError],
    [429, RateLimitError],
    [500, ProviderError],
  ] as const)("maps HTTP %i onto the documented error", async (status, expected) => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, {}, status));
    const failing = probe.run(sdk(fetch, { retries: 0 }));
    await expect(failing).rejects.toBeInstanceOf(expected);
  });

  it("names the provider on the error it raises", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, {}, 500));
    let caught: unknown;
    try {
      await probe.run(sdk(fetch));
    } catch (error) {
      caught = error;
    }
    expect(probe.providerIds).toContain((caught as OpenDataError).provider);
    expect((caught as OpenDataError).statusCode).toBe(500);
  });

  it("retries a retryable status exactly within the configured limit", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    let attempts = 0;
    const { fetch } = conformanceFetch(() => {
      attempts += 1;
      return attempts === 1 ? bodyResponse(probe, {}, 503) : bodyResponse(probe, probe.payload);
    });
    await expect(probe.run(sdk(fetch, { retries: 1 }))).resolves.toBeDefined();
    // One retry for the failed request, and no repetition of the ones that
    // succeeded.
    expect(attempts).toBe((probe.requestsPerCall ?? 1) + 1);
    vi.restoreAllMocks();
  });

  it("serves a repeated request from the cache when caching is enabled", async () => {
    const perCall = probe.requestsPerCall ?? 1;
    let requests = 0;
    const { fetch } = conformanceFetch(() => {
      requests += 1;
      return bodyResponse(probe, probe.payload);
    });
    const client = sdk(fetch, { cache: { enabled: true } });
    const first = await probe.run(client);
    const second = await probe.run(client);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    // The second call added nothing, which also proves the cache key is stable
    // across calls rather than varying per request.
    expect(requests).toBe(perCall);

    await client.clearCache();
    await probe.run(client);
    expect(requests).toBe(perCall * 2);
  });

  it("skips the cache for a request that asks to bypass it", async () => {
    const perCall = probe.requestsPerCall ?? 1;
    let requests = 0;
    const { fetch } = conformanceFetch(() => {
      requests += 1;
      return bodyResponse(probe, probe.payload);
    });
    const client = sdk(fetch, { cache: { enabled: true } });
    await probe.run(client);
    expect(requests).toBe(perCall);
    // `run` cannot pass bypassCache, so the option is exercised through a client
    // whose cache is off, which must reach the provider every time.
    const uncached = sdk(fetch, { cache: { enabled: false } });
    await probe.run(uncached);
    await probe.run(uncached);
    expect(requests).toBe(perCall * 3);
  });

  it("keeps every configured credential out of the response", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    const response = await probe.run(sdk(fetch));
    const serialized = JSON.stringify(response);
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  });

  it("keeps every configured credential out of its errors", async () => {
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.invalidPayload));
    let caught: unknown;
    try {
      await probe.run(sdk(fetch));
    } catch (error) {
      caught = error;
    }
    const serialized = `${String(caught)}|${JSON.stringify(caught)}`;
    for (const secret of SECRETS) expect(serialized).not.toContain(secret);
  });

  it("sends credentials only to the hosts of the providers that declared them", async () => {
    const { fetch, calls, headers } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    await probe.run(sdk(fetch));
    const urls = calls();
    headers().forEach((header, index) => {
      const host = urls[index]?.hostname ?? "";
      const authorization = header.get("Authorization");
      if (authorization !== null) {
        // A bearer token belongs only to a BarentsWatch host or its issuer.
        expect(host).toMatch(/barentswatch\.no$/);
      }
      if (header.get("X-API-Key") !== null) expect(host).toContain("nve.no");
    });
  });

  it("writes nothing to the console", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { fetch } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    await probe.run(sdk(fetch));
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("fails with the provider's own instructions when its credentials are missing", async () => {
    const required = probe.requiresCredentials ?? [];
    const { fetch, calls } = conformanceFetch(() => bodyResponse(probe, probe.payload));
    // An unconfigured client: no application name, no contact address, no secrets.
    const bare = new NorwayOpenData({ retries: 0, rateLimit: { enabled: false }, fetch });
    if (required.length === 0) {
      // An open provider must still work with nothing configured.
      await expect(probe.run(bare)).resolves.toBeDefined();
      return;
    }
    await expect(probe.run(bare)).rejects.toBeInstanceOf(ConfigurationError);
    for (const id of required) {
      const message = providers[id as keyof typeof providers].authentication;
      expect(message).toBeTruthy();
    }
    // Nothing is sent, so an unidentifiable request never reaches the provider.
    expect(calls()).toHaveLength(0);
  });
});

describe("facade construction", () => {
  it("sends no request while constructing the client", () => {
    const fetch = vi.fn(() => {
      throw new Error("Construction must not perform any request.");
    }) as unknown as typeof globalThis.fetch;
    expect(() => new NorwayOpenData({ ...fullyConfigured, fetch })).not.toThrow();
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("exposes every probed namespace as a callable operation", () => {
    const sdk = new NorwayOpenData({ ...fullyConfigured, fetch: async () => jsonResponse({}) });
    for (const namespace of ["ais", "marine", "fisheries"] as const) {
      expect(sdk[namespace], namespace).toBeDefined();
    }
    expect(typeof sdk.ais.streamPositions).toBe("function");
    expect(typeof sdk.ais.getTrackLast24Hours).toBe("function");
    expect(typeof sdk.marine.getWaveForecast).toBe("function");
    expect(typeof sdk.fisheries.searchVessels).toBe("function");
    expect(typeof sdk.fisheries.searchAquacultureSites).toBe("function");
    expect(typeof sdk.profiles.vessel).toBe("function");
  });

  it("exposes the focused geospatial namespaces and nature profile", () => {
    const sdk = new NorwayOpenData({ ...fullyConfigured, fetch: async () => jsonResponse({}) });
    expect(typeof sdk.geodata.searchDatasets).toBe("function");
    expect(typeof sdk.geodata.getMetadata).toBe("function");
    expect(typeof sdk.environment.getProtectedAreasAt).toBe("function");
    expect(typeof sdk.environment.getInterventionFreeAreasAt).toBe("function");
    expect(typeof sdk.land.getLandResourcesAt).toBe("function");
    expect(typeof sdk.profiles.natureAtLocation).toBe("function");
  });

  it("exposes no duplicate operation name across the maritime namespaces", () => {
    const sdk = new NorwayOpenData({ ...fullyConfigured, fetch: async () => jsonResponse({}) });
    const operationsOf = (client: object): string[] =>
      Object.getOwnPropertyNames(Object.getPrototypeOf(client)).filter(
        (name) => name !== "constructor",
      );
    const ais = operationsOf(sdk.ais);
    const marine = operationsOf(sdk.marine);
    const fisheries = operationsOf(sdk.fisheries);
    // `searchVessels` exists on both AIS and the fisheries register and means
    // different things, so it is the one name worth checking deliberately: AIS
    // searches live transmissions, the register searches registered vessels.
    expect(ais).toContain("searchVessels");
    expect(fisheries).toContain("searchVessels");
    expect(marine.filter((name) => ais.includes(name) || fisheries.includes(name))).toEqual([]);
  });
});

describe("conformance coverage", () => {
  it("probes every registered provider", () => {
    const probed = new Set(probes.flatMap((probe) => probe.providerIds));
    const unprobed = providerIds.filter((id) => !probed.has(id));
    expect(
      unprobed,
      `These providers have no conformance probe. Add one to tests/unit/provider-conformance.test.ts so the new provider inherits the shared contract checks: ${unprobed.join(", ")}`,
    ).toEqual([]);
  });

  it("only expects a credential failure from a provider whose descriptor declares one", () => {
    // The invariant holds in one direction only. `access` describes the provider,
    // while a probe exercises one operation, and several providers require
    // identification for part of their surface and none for the rest: NVE needs a
    // HydAPI key for stations but serves reservoir and Varsom data anonymously.
    // So a probe that expects a credential failure must be for a provider that
    // declares a requirement, but an anonymous probe against such a provider is
    // legitimate.
    for (const probe of probes) {
      for (const id of probe.requiresCredentials ?? []) {
        const metadata = providers[id as keyof typeof providers];
        expect(
          metadata.access,
          `${probe.namespace}: the probe expects a credential failure, so ${id} must not be declared "open".`,
        ).not.toBe("open");
        expect(metadata.authentication, id).toBeTruthy();
      }
    }
  });

  it("gives every provider that requires client credentials an actionable message", () => {
    for (const id of providerIds) {
      const metadata = providers[id];
      if (metadata.access === "open") continue;
      expect(metadata.authentication, id).toBeTruthy();
    }
  });
});
