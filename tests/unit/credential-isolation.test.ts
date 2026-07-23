import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import metForecast from "../fixtures/met-forecast.json" with { type: "json" };
import nveReservoir from "../fixtures/nve-reservoir.json" with { type: "json" };
import nveStations from "../fixtures/nve-stations.json" with { type: "json" };
import nveWarning from "../fixtures/nve-warning.json" with { type: "json" };
import nvdbRoadNetwork from "../fixtures/nvdb-road-network.json" with { type: "json" };
import nvdbRoadObjectTypes from "../fixtures/nvdb-road-object-types.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import { NorwayOpenData, ResponseValidationError } from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

type CapturedRequest = { url: URL; headers: Headers };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("provider credential isolation", () => {
  it("sends every identification header only to its intended provider", async () => {
    const applicationName = "credential-isolation-tests";
    const contactEmail = "developer@example.no";
    const apiKey = "test-hydapi-key-value";
    const requests: CapturedRequest[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const headers = new Headers(init?.headers);
      requests.push({ url, headers });
      if (url.hostname === "api.entur.io") return jsonResponse({ features: [] });
      if (url.hostname === "api.met.no") return jsonResponse(metForecast);
      if (url.hostname === "nvdbapiles.atlas.vegvesen.no") {
        return jsonResponse(nvdbRoadObjectTypes);
      }
      if (url.hostname === "hydapi.nve.no") {
        return jsonResponse({
          ...nveStations,
          debug: { headers: { "X-API-Key": apiKey }, contactEmail },
        });
      }
      if (url.hostname === "api01.nve.no") return jsonResponse(nveWarning);
      if (url.hostname === "biapi.nve.no") return jsonResponse(nveReservoir);
      if (url.hostname === "data.brreg.no") return jsonResponse(brregCompany);
      throw new Error(`Unexpected test URL ${url.origin}.`);
    }) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({
      applicationName,
      contactEmail,
      rateLimit: { enabled: false },
      credentials: { nve: { apiKey } },
      fetch,
      retries: 0,
    });

    const responses = [
      await sdk.transport.autocomplete({ text: "Oslo" }, { includeRaw: true }),
      await sdk.weather.forecast({ latitude: 60, longitude: 10 }, { includeRaw: true }),
      await sdk.roads.getRoadObjectTypes({ includeRaw: true }),
      await sdk.hazards.getHydrologyStations({}, { includeRaw: true }),
      await sdk.hazards.getFloodWarnings(
        { startDate: "2026-01-01", endDate: "2026-01-01" },
        { includeRaw: true },
      ),
      await sdk.energy.getReservoirStatistics({ includeRaw: true }),
      await sdk.companies.get("923609016", { includeRaw: true }),
    ];

    for (const request of requests) {
      const isEntur = request.url.hostname === "api.entur.io";
      const isMet = request.url.hostname === "api.met.no";
      const isNvdb = request.url.hostname === "nvdbapiles.atlas.vegvesen.no";
      const isHydApi = request.url.hostname === "hydapi.nve.no";
      expect(request.headers.get("ET-Client-Name")).toBe(isEntur ? applicationName : null);
      expect(request.headers.get("X-Client")).toBe(isNvdb ? applicationName : null);
      expect(request.headers.get("X-API-Key")).toBe(isHydApi ? apiKey : null);
      if (isMet) {
        expect(request.headers.get("User-Agent")).toContain(applicationName);
        expect(request.headers.get("User-Agent")).toContain(contactEmail);
      } else {
        expect(request.headers.get("User-Agent")).toBeNull();
      }
    }
    const serializedResponses = JSON.stringify(responses);
    expect(serializedResponses).not.toContain(apiKey);
    expect(serializedResponses).not.toContain(contactEmail);
  });

  it("does not expose echoed credentials through errors or logs", async () => {
    const apiKey = "test-error-key-value";
    const contactEmail = "developer@example.no";
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetch = vi.fn(async () =>
      jsonResponse({
        itemCount: "invalid",
        debug: { "X-API-Key": apiKey, contactEmail },
      }),
    ) as typeof globalThis.fetch;
    let caught: unknown;
    try {
      await new NorwayOpenData({
        applicationName: "credential-isolation-tests",
        contactEmail,
        rateLimit: { enabled: false },
        credentials: { nve: { apiKey } },
        fetch,
        retries: 0,
      }).hazards.getHydrologyStations();
    } catch (caughtError) {
      caught = caughtError;
    }
    expect(caught).toBeInstanceOf(ResponseValidationError);
    expect(String(caught)).not.toContain(apiKey);
    expect(String(caught)).not.toContain(contactEmail);
    expect(JSON.stringify(caught)).not.toContain(apiKey);
    expect(JSON.stringify(caught)).not.toContain(contactEmail);
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * `applicationName` identifies the caller to a provider in a public header. It
 * is not a credential, and a provider is free to return the same word in its own
 * data. Treating it as a secret rewrites valid payloads before validation, which
 * turns an ordinary response into a `ResponseValidationError`.
 */
describe("public identification values never rewrite provider payloads", () => {
  const publicName = "vegvesen";

  it("leaves an NVDB continuation URL intact when it contains the application name", async () => {
    const fetch = vi.fn(async () => jsonResponse(nvdbRoadNetwork)) as typeof globalThis.fetch;
    const response = await new NorwayOpenData({
      applicationName: publicName,
      rateLimit: { enabled: false },
      fetch,
      retries: 0,
    }).roads.getRoadNetwork({}, { includeRaw: true });

    expect(response.data.pagination.nextUrl).toBe(
      "https://nvdbapiles.atlas.vegvesen.no/vegnett/api/v4/veglenkesekvenser/segmentert?start=281042%3A5",
    );
    expect(JSON.stringify(response)).not.toContain("[REDACTED]");
  });

  it("follows the unchanged continuation URL through the road-network iterator", async () => {
    const fetch = vi.fn(async () => jsonResponse(nvdbRoadNetwork)) as typeof globalThis.fetch;
    const segments = [];
    for await (const segment of new NorwayOpenData({
      applicationName: publicName,
      rateLimit: { enabled: false },
      fetch,
      retries: 0,
    }).roads.getRoadNetworkAll({}, { maxPages: 2 })) {
      segments.push(segment);
    }

    expect(segments).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("leaves Entur payload text intact when it contains the application name", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        features: [
          {
            geometry: { coordinates: [10.75, 59.91] },
            properties: { id: "NSR:StopPlace:1", name: "Entur testpunkt", locality: "Entur" },
          },
        ],
      }),
    ) as typeof globalThis.fetch;
    const response = await new NorwayOpenData({
      applicationName: "Entur testpunkt",
      rateLimit: { enabled: false },
      fetch,
      retries: 0,
    }).transport.autocomplete({ text: "Entur" }, { includeRaw: true });

    expect(response.data[0]?.name).toBe("Entur testpunkt");
    expect(JSON.stringify(response)).not.toContain("[REDACTED]");
  });

  it("still redacts real credentials echoed anywhere in a payload", async () => {
    const apiKey = "test-hydapi-key-value";
    const contactEmail = "developer@example.no";
    const fetch = vi.fn(async () =>
      jsonResponse({
        ...nveStations,
        // A secret echoed as a nested string, inside an array, and under a
        // sensitive property name must all be removed before the caller sees it.
        debug: {
          note: `key ${apiKey} and ${contactEmail}`,
          trail: [{ "X-API-Key": apiKey }, apiKey],
          authorization: `Bearer ${apiKey}`,
        },
      }),
    ) as typeof globalThis.fetch;
    const response = await new NorwayOpenData({
      applicationName: publicName,
      contactEmail,
      rateLimit: { enabled: false },
      credentials: { nve: { apiKey } },
      fetch,
      retries: 0,
    }).hazards.getHydrologyStations({}, { includeRaw: true });

    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(apiKey);
    expect(serialized).not.toContain(contactEmail);
    // The public identifier is still not a redaction target.
    expect(serialized).not.toContain("[REDACTED]vesen");
  });

  it("still strips properties named after identification headers", async () => {
    // Excluding these header *values* from redaction must not stop their *keys*
    // being dropped: a response echoing request headers back is still removed.
    const fetch = vi.fn(async () =>
      jsonResponse({
        ...nveStations,
        echoed: {
          "X-Client": publicName,
          "ET-Client-Name": publicName,
          "User-Agent": `NorwayOpenDataSDK/1.0 ${publicName}`,
          kept: publicName,
        },
      }),
    ) as typeof globalThis.fetch;
    const response = await new NorwayOpenData({
      applicationName: publicName,
      rateLimit: { enabled: false },
      credentials: { nve: { apiKey: "test-hydapi-key-value" } },
      fetch,
      retries: 0,
    }).hazards.getHydrologyStations({}, { includeRaw: true });

    const echoed = (response.raw as { echoed: Record<string, unknown> }).echoed;
    expect(Object.keys(echoed)).toEqual(["kept"]);
    // The surviving value is untouched, not redacted.
    expect(echoed["kept"]).toBe(publicName);
  });

  it("keeps real credentials out of error metadata while leaving the public name alone", async () => {
    const apiKey = "test-hydapi-key-value";
    const fetch = vi.fn(async () =>
      jsonResponse({ itemCount: "invalid", echoed: `token ${apiKey}` }),
    ) as typeof globalThis.fetch;
    let caught: unknown;
    try {
      await new NorwayOpenData({
        applicationName: publicName,
        rateLimit: { enabled: false },
        credentials: { nve: { apiKey } },
        fetch,
        retries: 0,
      }).hazards.getHydrologyStations();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ResponseValidationError);
    expect(JSON.stringify(caught)).not.toContain(apiKey);
  });
});
