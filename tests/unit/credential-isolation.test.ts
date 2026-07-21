import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import metForecast from "../fixtures/met-forecast.json" with { type: "json" };
import nveReservoir from "../fixtures/nve-reservoir.json" with { type: "json" };
import nveStations from "../fixtures/nve-stations.json" with { type: "json" };
import nveWarning from "../fixtures/nve-warning.json" with { type: "json" };
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
