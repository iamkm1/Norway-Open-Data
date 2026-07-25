import metForecast from "../fixtures/met-forecast.json" with { type: "json" };
import kartverketPlace from "../fixtures/kartverket-place.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { aisSnapshotFixture, aisTrackFixture, tokenResponseFixture } from "../fixtures/ais.js";
import { fishingVesselsFixture } from "../fixtures/fiskeridir.js";
import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  type ProfileComponent,
  type VesselProfile,
} from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

const aisCredentials = {
  "barentswatch-ais": {
    clientId: "developer@example.test:ais-client",
    clientSecret: "test-ais-client-secret",
  },
} as const;

type Overrides = {
  snapshot?: () => Response;
  track?: () => Response;
  vessels?: () => Response;
  weather?: () => Response;
  places?: () => Response;
};

/** Builds an SDK answering each provider the vessel profile consults. */
function profileSdk(
  overrides: Overrides = {},
  config: { identifyToMet?: boolean; aisCredentials?: boolean } = {},
): { sdk: NorwayOpenData; urls: URL[] } {
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    urls.push(url);
    if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
    if (url.pathname.endsWith("/latest/combined")) {
      return (overrides.snapshot ?? (() => jsonResponse(aisSnapshotFixture)))();
    }
    if (url.pathname.includes("trackslast24hours")) {
      return (overrides.track ?? (() => jsonResponse(aisTrackFixture)))();
    }
    if (url.hostname === "api.fiskeridir.no") {
      return (overrides.vessels ?? (() => jsonResponse([fishingVesselsFixture[0]])))();
    }
    if (url.hostname === "api.met.no") {
      return (overrides.weather ?? (() => jsonResponse(metForecast)))();
    }
    if (url.hostname === "ws.geonorge.no") {
      return (overrides.places ?? (() => jsonResponse(kartverketPlace)))();
    }
    throw new Error(`Unexpected request to ${url.href}`);
  }) as typeof globalThis.fetch;
  const sdk = new NorwayOpenData({
    fetch,
    retries: 0,
    rateLimit: { enabled: false },
    ...(config.aisCredentials === false ? {} : { credentials: aisCredentials }),
    ...(config.identifyToMet === false
      ? {}
      : { applicationName: "vessel-profile-tests", contactEmail: "developer@example.no" }),
  });
  return { sdk, urls };
}

function component(profile: VesselProfile, operation: string): ProfileComponent | undefined {
  return profile.components?.find((entry) => entry.operation === operation);
}

describe("vessel profile", () => {
  it("composes AIS, the vessel register, weather and the nearest place", async () => {
    const { sdk } = profileSdk();
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    const profile = response.data;

    expect(profile.mmsi).toBe("257111020");
    expect(profile.ais.status).toBe("available");
    expect(profile.ais.identity).toMatchObject({
      name: "TESTBÅT",
      callSign: "LF7250",
      imoNumber: "9123456",
      shipType: 30,
    });
    // The latest point is chosen by message time, not by array position: the
    // fixture deliberately returns them out of order.
    expect(profile.ais.latestPosition?.messageTime).toBe("2026-07-24T10:45:00+00:00");
    expect(profile.ais.track?.points).toHaveLength(3);
    expect(profile.registration?.name).toBe("CONVOY JR");
    expect(profile.weather?.temperature).toBe(17.2);
    expect(profile.nearestPlace?.name).toBeTruthy();

    expect(profile.components).toHaveLength(5);
    expect(profile.components?.every((entry) => entry.status === "available")).toBe(true);
    expect(response.source.id).toBe("barentswatch-ais+fiskeridir-vessels+met+kartverket");
  });

  it("joins to the vessel register on the AIS call sign", async () => {
    const { sdk, urls } = profileSdk();
    await sdk.profiles.vessel({ mmsi: "257111020" });
    const registerUrl = urls.find((url) => url.hostname === "api.fiskeridir.no");
    expect(registerUrl?.searchParams.get("radio_call_sign")).toBe("LF7250");
  });

  it("never claims a vessel does not exist when AIS has no recent data", async () => {
    const { sdk } = profileSdk({
      snapshot: () => jsonResponse([]),
      track: () => jsonResponse([]),
    });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });

    expect(response.data.ais.status).toBe("no-recent-data");
    expect(response.data.ais.latestPosition).toBeUndefined();
    // "not-covered" says the provider answered and publishes nothing here. It is
    // deliberately not "not-found", which would imply the MMSI is unassigned.
    expect(component(response.data, "ais.getVesselSnapshot")).toMatchObject({
      status: "omitted",
      reason: "not-covered",
    });
    expect(component(response.data, "ais.getTrackLast24Hours")).toMatchObject({
      status: "omitted",
      reason: "not-covered",
    });
  });

  it("skips the register lookup as not-applicable when AIS reports no call sign", async () => {
    const withoutCallSign = { ...aisSnapshotFixture[0] };
    delete (withoutCallSign as { callSign?: string }).callSign;
    const { sdk, urls } = profileSdk({ snapshot: () => jsonResponse([withoutCallSign]) });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });

    expect(response.data.registration).toBeUndefined();
    expect(component(response.data, "fisheries.searchVessels")).toMatchObject({
      status: "omitted",
      reason: "not-applicable",
    });
    // Matching by name instead would produce confident wrong answers, so the
    // register is not consulted at all.
    expect(urls.some((url) => url.hostname === "api.fiskeridir.no")).toBe(false);
  });

  it("reports not-found when the register holds no matching vessel", async () => {
    const { sdk } = profileSdk({ vessels: () => jsonResponse([]) });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    expect(response.data.registration).toBeUndefined();
    expect(component(response.data, "fisheries.searchVessels")).toMatchObject({
      status: "omitted",
      reason: "not-found",
    });
  });

  it("declines to choose when the register matches several vessels", async () => {
    const { sdk } = profileSdk({ vessels: () => jsonResponse(fishingVesselsFixture) });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    expect(response.data.registration).toBeUndefined();
    expect(component(response.data, "fisheries.searchVessels")).toMatchObject({
      status: "omitted",
      reason: "not-found",
    });
  });

  it("keeps successful sections when one provider fails", async () => {
    const { sdk } = profileSdk({
      vessels: () => jsonResponse({}, 500),
      weather: () => jsonResponse({}, 503),
    });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });

    // The AIS sections survive a failure in two other providers.
    expect(response.data.ais.status).toBe("available");
    expect(response.data.nearestPlace).toBeDefined();
    expect(component(response.data, "fisheries.searchVessels")).toMatchObject({
      status: "omitted",
      reason: "provider-error",
      error: { name: "ProviderError" },
    });
    expect(component(response.data, "weather.current")).toMatchObject({
      status: "omitted",
      reason: "provider-error",
    });
  });

  it("keeps the rest of the profile when the AIS snapshot fails but the track succeeds", async () => {
    const { sdk } = profileSdk({ snapshot: () => jsonResponse({}, 500) });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });

    expect(response.data.ais.status).toBe("available");
    expect(response.data.ais.latestPosition?.messageTime).toBe("2026-07-24T10:45:00+00:00");
    // The track carries a name even though the snapshot that would have carried
    // the call sign failed.
    expect(response.data.ais.identity?.name).toBe("TESTBÅT");
    expect(component(response.data, "ais.getVesselSnapshot")).toMatchObject({
      status: "omitted",
      reason: "provider-error",
    });
    // With no call sign available the register is skipped rather than guessed.
    expect(component(response.data, "fisheries.searchVessels")).toMatchObject({
      reason: "not-applicable",
    });
    // The track still supplies a coordinate, so location-based sections run.
    expect(response.data.nearestPlace).toBeDefined();
  });

  it("omits weather as not-configured without MET identification", async () => {
    const { sdk, urls } = profileSdk({}, { identifyToMet: false });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    expect(response.data.weather).toBeUndefined();
    expect(component(response.data, "weather.current")).toMatchObject({
      status: "omitted",
      reason: "not-configured",
    });
    expect(urls.some((url) => url.hostname === "api.met.no")).toBe(false);
  });

  it("omits position-based sections as missing-coordinate when AIS has no position", async () => {
    const { sdk, urls } = profileSdk({
      snapshot: () => jsonResponse([]),
      track: () => jsonResponse([]),
    });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    for (const operation of ["weather.current", "places.nearby"]) {
      expect(component(response.data, operation)).toMatchObject({
        status: "omitted",
        reason: "missing-coordinate",
      });
    }
    expect(urls.some((url) => url.hostname === "ws.geonorge.no")).toBe(false);
  });

  it("reports not-found when no place name is near the position", async () => {
    const { sdk } = profileSdk({
      places: () => jsonResponse({ metadata: { totaltAntallTreff: 0 }, navn: [] }),
    });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    expect(response.data.nearestPlace).toBeUndefined();
    expect(component(response.data, "places.nearby")).toMatchObject({
      status: "omitted",
      reason: "not-found",
    });
  });

  it("refuses to compose a profile without AIS credentials", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Network access must not be attempted.");
    }) as unknown as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    // AIS is the only source that can resolve an MMSI, so there is nothing to
    // degrade to. The caller gets the provider's own instructions.
    await expect(sdk.profiles.vessel({ mmsi: "257111020" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(sdk.profiles.vessel({ mmsi: "257111020" })).rejects.toThrow(
      /credentials\['barentswatch-ais'\]/,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it.each(["", "  ", "abc", "1234567890"])(
    "rejects the invalid MMSI %o before requesting",
    async (mmsi) => {
      const { sdk, urls } = profileSdk();
      await expect(sdk.profiles.vessel({ mmsi })).rejects.toBeInstanceOf(InputValidationError);
      expect(urls).toHaveLength(0);
    },
  );

  it("rethrows a caller cancellation instead of degrading every section", async () => {
    const controller = new AbortController();
    const { sdk } = profileSdk({
      vessels: () => {
        controller.abort();
        return jsonResponse({}, 500);
      },
    });
    await expect(
      sdk.profiles.vessel({ mmsi: "257111020" }, { signal: controller.signal }),
    ).rejects.toThrow();
  });

  it("does not carry a natural person's owner details into the profile", async () => {
    const personVessel = fishingVesselsFixture[1];
    const owner = personVessel?.owners?.[0];
    const { sdk } = profileSdk({
      vessels: () => jsonResponse([{ ...personVessel, radioCallSign: "LF7250" }]),
    });
    const response = await sdk.profiles.vessel({ mmsi: "257111020" }, { includeRaw: true });
    expect(response.data.registration?.owners).toEqual([{ entityType: "person" }]);
    const serialized = JSON.stringify(response);
    for (const value of [owner?.name, owner?.postalCode, owner?.city, owner?.id]) {
      expect(serialized).not.toContain(String(value));
    }
  });

  it("keeps AIS credentials and the bearer token out of the profile", async () => {
    const { sdk } = profileSdk();
    const response = await sdk.profiles.vessel({ mmsi: "257111020" }, { includeRaw: true });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toContain(aisCredentials["barentswatch-ais"].clientSecret);
    expect(serialized).not.toContain(aisCredentials["barentswatch-ais"].clientId);
    expect(serialized).not.toContain(tokenResponseFixture.access_token);
    expect(serialized).not.toContain("developer@example.no");
  });

  it("attributes every source it used", async () => {
    const { sdk } = profileSdk();
    const response = await sdk.profiles.vessel({ mmsi: "257111020" });
    for (const entry of response.data.components ?? []) {
      expect(entry.source.id).toBeTruthy();
      expect(entry.source.homepage).toMatch(/^https:\/\//);
    }
    const aisComponent = component(response.data, "ais.getVesselSnapshot");
    // Kystverket supplies the AIS data through BarentsWatch; both are credited.
    expect(aisComponent?.source.attribution).toMatch(/Kystverket/);
  });
});
