import { describe, expect, it, vi } from "vitest";

import packageMetadata from "../../package.json" with { type: "json" };
import { ConfigurationError, NorwayOpenData, version } from "../../src/index.js";

describe("configuration", () => {
  it("constructs every public provider client", () => {
    const sdk = new NorwayOpenData({ fetch: async () => new Response("{}") });
    expect(sdk.companies).toBeDefined();
    expect(sdk.statistics).toBeDefined();
    expect(sdk.addresses).toBeDefined();
    expect(sdk.places).toBeDefined();
    expect(sdk.transport).toBeDefined();
    expect(sdk.weather).toBeDefined();
    expect(sdk.profiles).toBeDefined();
    expect(sdk.catalog).toBeDefined();
    expect(sdk.currency).toBeDefined();
    expect(sdk.parliament).toBeDefined();
    expect(sdk.roads).toBeDefined();
    expect(sdk.energy).toBeDefined();
    expect(sdk.hazards).toBeDefined();
    expect(sdk.electricity).toBeDefined();
    expect(typeof sdk.clearCache).toBe("function");
    expect(version).toBe(packageMetadata.version);
  });

  it.each([
    { timeoutMs: 0 },
    { retries: -1 },
    { contactEmail: "not-an-email" },
    { applicationName: "" },
    { applicationName: "valid\r\nInjected: header" },
    { cache: { maxEntries: 0 } },
    { credentials: { nve: { apiKey: "" } } },
    { credentials: { nve: { apiKey: "valid\r\nInjected: header" } } },
  ])("rejects invalid configuration: %o", (config) => {
    expect(() => new NorwayOpenData(config)).toThrow(ConfigurationError);
  });

  it("defers provider-specific identification requirements", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const sdk = new NorwayOpenData({ fetch });
    await expect(
      sdk.transport.departures({ stopPlaceId: "NSR:StopPlace:1" }),
    ).rejects.toMatchObject({ name: "ConfigurationError", provider: "entur" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects NVDB requests without an application identity before fetch", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    const sdk = new NorwayOpenData({ fetch });
    await expect(sdk.roads.getRoadObjectType(105)).rejects.toMatchObject({
      name: "ConfigurationError",
      provider: "vegvesen",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "application name",
      config: { contactEmail: "developer@example.no" },
    },
    {
      label: "contact email",
      config: { applicationName: "company-weather-test" },
    },
  ])("rejects MET requests missing $label before fetch", async ({ config }) => {
    const fetch = vi.fn(async () => new Response("{}"));
    const sdk = new NorwayOpenData({ ...config, fetch });
    await expect(sdk.weather.forecast({ latitude: 60, longitude: 10 })).rejects.toMatchObject({
      name: "ConfigurationError",
      provider: "met",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
