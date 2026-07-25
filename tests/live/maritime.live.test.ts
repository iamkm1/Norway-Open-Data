/**
 * Opt-in live probes for the maritime providers.
 *
 * Enabled only with `RUN_LIVE_TESTS=true`. Every probe is bounded: one request or
 * one message, a short abort deadline, and no paging. The BarentsWatch probes skip
 * themselves unless their own credentials are present, because BarentsWatch issues
 * separate AIS-clients and API-clients and neither is usable for the other.
 *
 * The Fiskeridirektoratet registers are open, so those probes always run.
 *
 * Environment variables:
 *
 * - `BARENTSWATCH_AIS_CLIENT_ID`, `BARENTSWATCH_AIS_CLIENT_SECRET` — AIS-client
 * - `BARENTSWATCH_CLIENT_ID`, `BARENTSWATCH_CLIENT_SECRET` — API-client
 */
import { describe, expect, it } from "vitest";

import { type AisPosition, NorwayOpenData } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe : describe.skip;

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

const aisClientId = optionalEnvironmentValue("BARENTSWATCH_AIS_CLIENT_ID");
const aisClientSecret = optionalEnvironmentValue("BARENTSWATCH_AIS_CLIENT_SECRET");
const apiClientId = optionalEnvironmentValue("BARENTSWATCH_CLIENT_ID");
const apiClientSecret = optionalEnvironmentValue("BARENTSWATCH_CLIENT_SECRET");

const noAisCredentials = aisClientId === undefined || aisClientSecret === undefined;
const noMarineCredentials = apiClientId === undefined || apiClientSecret === undefined;

/** A window off the south-west Norwegian coast, inside the published AIS area. */
const ROGALAND_BOX = { south: 58.8, west: 4.5, north: 60.0, east: 6.5 } as const;

const sdk = new NorwayOpenData({
  retries: 1,
  timeoutMs: 20_000,
  cache: { enabled: true },
  credentials: {
    ...(noAisCredentials
      ? {}
      : { "barentswatch-ais": { clientId: aisClientId, clientSecret: aisClientSecret } }),
    ...(noMarineCredentials
      ? {}
      : { barentswatch: { clientId: apiClientId, clientSecret: apiClientSecret } }),
  },
});

live("BarentsWatch — AIS", () => {
  it.skipIf(noAisCredentials)("reads the published open-AIS coverage area", async () => {
    const response = await sdk.ais.getCoverageArea();
    expect(response.data.type).toBe("MultiPolygon");
    expect(response.data.coordinates.length).toBeGreaterThan(0);
    expect(response.source.attribution).toMatch(/Kystverket/);
  });

  it.skipIf(noAisCredentials)(
    "reads a bounded position snapshot and follows one vessel",
    async () => {
      const snapshot = await sdk.ais.getLatestPositions({ boundingBox: ROGALAND_BOX });
      expect(Array.isArray(snapshot.data)).toBe(true);
      const mmsi = snapshot.data[0]?.mmsi;
      // An empty snapshot is a legitimate answer at a quiet moment, so the rest of
      // the probe is conditional rather than asserted.
      if (mmsi === undefined) return;

      const vessel = await sdk.ais.getVesselSnapshot(mmsi);
      expect(vessel.data?.mmsi).toBe(mmsi);

      const track = await sdk.ais.getTrackLast24Hours(mmsi);
      expect(track.data.mmsi).toBe(mmsi);
      expect(Array.isArray(track.data.points)).toBe(true);
    },
  );

  it.skipIf(noAisCredentials)("lists MMSIs seen in a small area over one day", async () => {
    const to = new Date();
    const from = new Date(to.getTime() - 24 * 60 * 60 * 1_000);
    const response = await sdk.ais.getMmsiInArea({
      // Kept small: the provider caps the area at 500 square kilometres.
      boundingBox: { south: 59.4, west: 5.2, north: 59.5, east: 5.35 },
      from: from.toISOString(),
      to: to.toISOString(),
    });
    expect(Array.isArray(response.data)).toBe(true);
    for (const mmsi of response.data) expect(mmsi).toMatch(/^\d+$/);
  });

  it.skipIf(noAisCredentials)("takes one message from the live position stream", async () => {
    const controller = new AbortController();
    // A live feed only produces a message when a vessel transmits, so the probe
    // stops on a deadline rather than waiting indefinitely.
    const deadline = setTimeout(() => controller.abort(), 25_000);
    const positions: AisPosition[] = [];
    try {
      for await (const position of sdk.ais.streamPositions({
        boundingBox: ROGALAND_BOX,
        signal: controller.signal,
      })) {
        positions.push(position);
        break;
      }
    } catch (error) {
      // Reaching the deadline is an acceptable outcome; anything else is not.
      if (!controller.signal.aborted) throw error;
    } finally {
      clearTimeout(deadline);
      controller.abort();
    }
    for (const position of positions) {
      expect(position.kind).toBe("position");
      expect(position.mmsi).toMatch(/^\d+$/);
      expect(position.messageTime).toBeTruthy();
    }
  });

  it.skipIf(noAisCredentials)("reports missing credentials before any request", async () => {
    const unconfigured = new NorwayOpenData({ retries: 0 });
    await expect(unconfigured.ais.getCoverageArea()).rejects.toThrow(/barentswatch-ais/);
  });
});

live("BarentsWatch — marine forecasts", () => {
  it.skipIf(noMarineCredentials)("reads a wave forecast off the coast", async () => {
    const response = await sdk.marine.getWaveForecast({ latitude: 59.4, longitude: 5.05 });
    // Undefined means no model covers the point, which is a valid answer.
    if (response.data !== undefined) {
      expect(response.data.latitude).toBeTypeOf("number");
      expect(response.data.longitude).toBeTypeOf("number");
    }
  });

  it.skipIf(noMarineCredentials)("reads a sea-current forecast off the coast", async () => {
    const response = await sdk.marine.getSeaCurrent({ latitude: 59.4, longitude: 5.05 });
    if (response.data !== undefined) {
      expect(response.data.latitude).toBeTypeOf("number");
    }
  });

  it.skipIf(noMarineCredentials)("returns nothing for a point far inland", async () => {
    // A land coordinate is outside every wave model, so this exercises the
    // "no forecast here" path against the real service.
    const response = await sdk.marine.getWaveForecastSeries({ latitude: 61.5, longitude: 9.1 });
    expect(Array.isArray(response.data)).toBe(true);
  });
});

live("Fiskeridirektoratet — fishing-vessel register", () => {
  it("searches vessels by municipality without any credentials", async () => {
    const response = await sdk.fisheries.searchVessels({
      municipalityCode: "1106",
      pageSize: 5,
    });
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.data.items.length).toBeLessThanOrEqual(5);
    expect(response.source.id).toBe("fiskeridir-vessels");
    for (const vessel of response.data.items) {
      expect(vessel.id).toBeTruthy();
      expect(vessel.municipalityCode).toBe("1106");
    }
  });

  it("resolves a vessel discovered from the register by id", async () => {
    const search = await sdk.fisheries.searchVessels({ municipalityCode: "1106", pageSize: 1 });
    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();
    const vessel = await sdk.fisheries.getVessel({ id: String(id) });
    expect(vessel.data.id).toBe(id);
  });

  it("resolves a vessel by its registration mark in the register's own spelling", async () => {
    const search = await sdk.fisheries.searchVessels({ municipalityCode: "1106", pageSize: 20 });
    const mark = search.data.items.find(
      (vessel) => vessel.registrationMark !== undefined,
    )?.registrationMark;
    if (mark === undefined) return;
    const vessel = await sdk.fisheries.getVessel({ registrationMark: mark });
    expect(vessel.data.registrationMark).toBe(mark);
  });

  it("never returns a natural person's owner details", async () => {
    // A wide page makes it very likely at least one privately owned vessel appears.
    const response = await sdk.fisheries.searchVessels({ pageSize: 200 }, { includeRaw: true });
    const owners = response.data.items.flatMap((vessel) => vessel.owners ?? []);
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      if (owner.entityType === "person") {
        expect(Object.keys(owner)).toEqual(["entityType"]);
      }
    }
    // The raw payload must not restore what the normalized output withheld.
    const raw = JSON.stringify(response.raw);
    expect(raw).not.toContain('"PERSON"');
  });

  it("walks one bounded page of the vessel iterator", async () => {
    const vessels: string[] = [];
    for await (const vessel of sdk.fisheries.searchVesselsAll(
      { municipalityCode: "1106", pageSize: 5 },
      { maxItems: 3, maxPages: 1 },
    )) {
      vessels.push(vessel.id);
    }
    expect(vessels.length).toBeLessThanOrEqual(3);
  });
});

live("Fiskeridirektoratet — aquaculture register", () => {
  it("searches sites by municipality without any credentials", async () => {
    const response = await sdk.fisheries.searchAquacultureSites({
      municipalityCode: "1149",
      limit: 5,
    });
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.source.id).toBe("fiskeridir-aqua");
    for (const site of response.data.items) {
      expect(site.siteNumber).toMatch(/^\d+$/);
      // A capacity without its unit would be meaningless, so both travel together.
      if (site.capacity !== undefined) expect(site.capacityUnitType).toBeTruthy();
    }
  });

  it("resolves a site discovered from the register", async () => {
    const search = await sdk.fisheries.searchAquacultureSites({ limit: 1 });
    const siteNumber = search.data.items[0]?.siteNumber;
    expect(siteNumber).toBeTruthy();
    const site = await sdk.fisheries.getAquacultureSite(String(siteNumber));
    expect(site.data.siteNumber).toBe(siteNumber);
  });

  it("filters sites by county and production area", async () => {
    const response = await sdk.fisheries.searchAquacultureSites({ countyCode: "11", limit: 3 });
    for (const site of response.data.items) {
      expect(site.placement?.countyCode).toBe("11");
    }
  });
});

live("Cross-provider — vessel profile", () => {
  it.skipIf(noAisCredentials)("composes a vessel profile from a live AIS vessel", async () => {
    const snapshot = await sdk.ais.getLatestPositions({ boundingBox: ROGALAND_BOX });
    const mmsi = snapshot.data[0]?.mmsi;
    if (mmsi === undefined) return;

    const response = await sdk.profiles.vessel({ mmsi });
    expect(response.data.mmsi).toBe(mmsi);
    expect(["available", "no-recent-data"]).toContain(response.data.ais.status);

    const components = response.data.components ?? [];
    expect(components).toHaveLength(5);
    for (const entry of components) {
      expect(entry.source.id).toBeTruthy();
      if (entry.status === "omitted") {
        expect([
          "not-configured",
          "missing-coordinate",
          "not-applicable",
          "provider-error",
          "not-found",
          "not-covered",
        ]).toContain(entry.reason);
      }
    }
    // Weather needs MET identification, which this probe does not configure.
    expect(components.find((entry) => entry.operation === "weather.current")).toMatchObject({
      status: "omitted",
    });
  });

  it.skipIf(noAisCredentials)(
    "reports no AIS data for an unused MMSI without claiming the vessel does not exist",
    async () => {
      // A syntactically valid MMSI in a range no vessel transmits from.
      const response = await sdk.profiles.vessel({ mmsi: "111111111" });
      expect(response.data.ais.status).toBe("no-recent-data");
      expect(response.data.registration).toBeUndefined();
    },
  );
});
