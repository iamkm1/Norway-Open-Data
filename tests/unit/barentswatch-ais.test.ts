import { describe, expect, it, vi } from "vitest";

import {
  aisAtonMessageFixture,
  aisCoverageAreaFixture,
  aisPositionMessageFixture,
  aisSafetyMessageFixture,
  aisSnapshotFixture,
  aisStaticMessageFixture,
  aisTrackFixture,
  aisVesselSearchFixture,
  aisWeatherMessageFixture,
  tokenResponseFixture,
} from "../fixtures/ais.js";
import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  ProviderError,
  ResponseValidationError,
} from "../../src/index.js";
import { draughtMetres } from "../../src/providers/barentswatch-ais/client.js";
import { collect, jsonResponse, ndjsonResponse } from "./helpers.js";

const credentials = {
  "barentswatch-ais": {
    clientId: "developer@example.test:ais-client",
    clientSecret: "test-ais-client-secret",
  },
} as const;

type Handler = (url: URL, init: RequestInit | undefined) => Response | Promise<Response>;

/**
 * Builds an SDK whose AIS host is answered by `handler` and whose token endpoint
 * always succeeds, plus the recorded requests.
 */
function aisSdk(
  handler: Handler,
  options: { withCredentials?: boolean } = {},
): {
  sdk: NorwayOpenData;
  requests: { url: URL; init: RequestInit | undefined }[];
} {
  const requests: { url: URL; init: RequestInit | undefined }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    requests.push({ url, init });
    if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
    return handler(url, init);
  }) as typeof globalThis.fetch;
  const sdk = new NorwayOpenData({
    fetch,
    retries: 0,
    rateLimit: { enabled: false },
    ...(options.withCredentials === false ? {} : { credentials }),
  });
  return { sdk, requests };
}

describe("AisClient authentication", () => {
  it("fails before any network access without credentials", async () => {
    const fetch = vi.fn(() => {
      throw new Error("Network access must not be attempted.");
    }) as unknown as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    await expect(sdk.ais.getTrackLast24Hours("257111020")).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(sdk.ais.getTrackLast24Hours("257111020")).rejects.toThrow(
      /credentials\['barentswatch-ais'\]\.clientId and clientSecret/,
    );
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("says an API-client secret will not work for AIS", async () => {
    const sdk = new NorwayOpenData({ fetch: async () => jsonResponse({}), retries: 0 });
    await expect(sdk.ais.getCoverageArea()).rejects.toThrow(/AIS-client/);
  });

  it("acquires one token with the ais scope and reuses it across requests", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse(aisTrackFixture));
    await sdk.ais.getTrackLast24Hours("257111020");
    await sdk.ais.getTrackLast24Hours("257111021");

    const tokenRequests = requests.filter(
      (request) => request.url.hostname === "id.barentswatch.no",
    );
    expect(tokenRequests).toHaveLength(1);
    expect(new URLSearchParams(String(tokenRequests[0]?.init?.body)).get("scope")).toBe("ais");

    for (const request of requests.filter(
      (candidate) => candidate.url.hostname !== "id.barentswatch.no",
    )) {
      expect(new Headers(request.init?.headers).get("Authorization")).toBe(
        `Bearer ${tokenResponseFixture.access_token}`,
      );
    }
  });

  it("sends the AIS bearer token only to AIS hosts", async () => {
    const requests: URL[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      requests.push(url);
      if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
      if (url.hostname === "api.fiskeridir.no") {
        expect(new Headers(init?.headers).get("Authorization")).toBeNull();
        return jsonResponse([]);
      }
      return jsonResponse(aisTrackFixture);
    }) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, retries: 0, credentials });
    await sdk.ais.getTrackLast24Hours("257111020");
    await sdk.fisheries.searchVessels({ municipalityCode: "1106" });
    expect(requests.some((url) => url.hostname === "api.fiskeridir.no")).toBe(true);
  });

  it("keeps the client secret and id out of a validation failure", async () => {
    const { sdk } = aisSdk(() => jsonResponse([{ mmsi: "not-a-number" }]));
    let caught: unknown;
    try {
      await sdk.ais.getTrackLast24Hours("257111020");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ResponseValidationError);
    const serialized = `${String(caught)}|${JSON.stringify(caught)}`;
    expect(serialized).not.toContain(credentials["barentswatch-ais"].clientSecret);
    expect(serialized).not.toContain(credentials["barentswatch-ais"].clientId);
    expect(serialized).not.toContain(tokenResponseFixture.access_token);
  });

  it("keeps the bearer token out of a payload that echoes it", async () => {
    const { sdk } = aisSdk(() =>
      jsonResponse({
        type: "MultiPolygon",
        coordinates: aisCoverageAreaFixture.coordinates,
        echoed: `Bearer ${tokenResponseFixture.access_token}`,
      }),
    );
    const response = await sdk.ais.getCoverageArea({ includeRaw: true });
    expect(JSON.stringify(response)).not.toContain(tokenResponseFixture.access_token);
  });
});

describe("AisClient tracks", () => {
  it("requests the JSON model and normalizes a 24-hour track", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse(aisTrackFixture));
    const response = await sdk.ais.getTrackLast24Hours("257111020");

    const url = requests.find((request) => request.url.hostname.startsWith("historic"))?.url;
    expect(url?.pathname).toBe("/open/v1/historic/trackslast24hours/257111020");
    expect(url?.searchParams.get("modelFormat")).toBe("Json");

    expect(response.data.mmsi).toBe("257111020");
    expect(response.data.points).toHaveLength(3);
    expect(response.data.points[0]).toEqual({
      mmsi: "257111020",
      messageTime: "2026-07-24T08:15:00+00:00",
      latitude: 59.4231,
      longitude: 5.2688,
      name: "TESTBÅT",
      courseOverGround: 182.4,
      speedOverGround: 9.1,
      trueHeading: 181,
      rateOfTurn: 0,
      navigationalStatus: 0,
      shipType: 30,
      // Reception networks differ in coverage and update rate, so the provider's
      // own label is kept verbatim; `terra` is one of the values it really sends.
      stream: "terra",
    });
    // Absent optional fields are omitted rather than set to undefined.
    expect(Object.keys(response.data.points[1] ?? {})).not.toContain("rateOfTurn");
    // The window is derived from the points the provider actually returned, which
    // arrive in the provider's order rather than sorted.
    expect(response.data.from).toBe("2026-07-24T08:15:00+00:00");
    expect(response.data.to).toBe("2026-07-24T10:45:00+00:00");
  });

  it("reports an empty track without claiming the vessel does not exist", async () => {
    const { sdk } = aisSdk(() => jsonResponse([]));
    const response = await sdk.ais.getTrackLast24Hours("257111020");
    expect(response.data.points).toEqual([]);
    expect(response.data.from).toBeUndefined();
    expect(response.data.to).toBeUndefined();
  });

  it("requests an explicit window and passes the satellite filter through", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse(aisTrackFixture));
    await sdk.ais.getTrack({
      mmsi: "257111020",
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-21T00:00:00Z",
      filterSatellitePositions: false,
    });
    const url = requests.find((request) => request.url.hostname.startsWith("historic"))?.url;
    expect(url?.pathname).toBe(
      "/open/v1/historic/tracks/257111020/2026-07-20T00%3A00%3A00Z/2026-07-21T00%3A00%3A00Z",
    );
    expect(url?.searchParams.get("filterSatellitePositions")).toBe("false");
  });

  it.each(["", "abc", "1234567890", "25711102x", "-1"])(
    "rejects the invalid MMSI %o before requesting",
    async (mmsi) => {
      const { sdk, requests } = aisSdk(() => jsonResponse(aisTrackFixture));
      await expect(sdk.ais.getTrackLast24Hours(mmsi)).rejects.toBeInstanceOf(InputValidationError);
      expect(
        requests.filter((request) => request.url.hostname.startsWith("historic")),
      ).toHaveLength(0);
    },
  );

  it("rejects a reversed or unparsable time window before requesting", async () => {
    const { sdk } = aisSdk(() => jsonResponse(aisTrackFixture));
    await expect(
      sdk.ais.getTrack({
        mmsi: "257111020",
        from: "2026-07-21T00:00:00Z",
        to: "2026-07-20T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      sdk.ais.getTrack({ mmsi: "257111020", from: "not-a-date", to: "2026-07-20T00:00:00Z" }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });
});

describe("AisClient area and vessel search", () => {
  it("posts a closed polygon derived from the bounding box", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse([257111020, 257111021]));
    const response = await sdk.ais.getMmsiInArea({
      boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
      from: "2026-07-20T00:00:00Z",
      to: "2026-07-22T00:00:00Z",
    });
    const body = JSON.parse(
      String(requests.find((request) => request.url.pathname.endsWith("mmsiinarea"))?.init?.body),
    );
    expect(body.polygon).toEqual({
      type: "Polygon",
      coordinates: [
        [
          [4.5, 58.8],
          [6.5, 58.8],
          [6.5, 60],
          [4.5, 60],
          [4.5, 58.8],
        ],
      ],
    });
    expect(body.msgTimeFrom).toBe("2026-07-20T00:00:00Z");
    // MMSIs are returned as strings so a leading zero cannot be lost.
    expect(response.data).toEqual(["257111020", "257111021"]);
  });

  it("rejects an area window longer than the provider's seven-day maximum", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse([]));
    await expect(
      sdk.ais.getMmsiInArea({
        boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
        from: "2026-07-01T00:00:00Z",
        to: "2026-07-20T00:00:00Z",
      }),
    ).rejects.toThrow(/seven days/);
    expect(requests.filter((request) => request.url.hostname.startsWith("historic"))).toHaveLength(
      0,
    );
  });

  it("rejects an invalid bounding box before requesting", async () => {
    const { sdk } = aisSdk(() => jsonResponse([]));
    await expect(
      sdk.ais.getMmsiInArea({
        boundingBox: { south: 60, west: 4.5, north: 58.8, east: 6.5 },
        from: "2026-07-20T00:00:00Z",
        to: "2026-07-21T00:00:00Z",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("searches vessels by name and normalizes identifiers to strings", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse(aisVesselSearchFixture));
    const response = await sdk.ais.searchVessels({ query: "TESTBÅT" });
    expect(
      requests
        .find((request) => request.url.pathname.includes("search"))
        ?.url.searchParams.get("q"),
    ).toBe("TESTBÅT");
    expect(response.data[0]).toEqual({
      mmsi: "257111020",
      name: "TESTBÅT",
      callSign: "LF7250",
      imoNumber: "9123456",
      country: "NO",
      shipType: 30,
      courseOverGround: 179.8,
      heading: 180,
      messageTime: "2026-07-24T10:45:00+00:00",
    });
  });

  it("rejects an empty or oversized vessel-search query", async () => {
    const { sdk } = aisSdk(() => jsonResponse([]));
    await expect(sdk.ais.searchVessels({ query: "   " })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(sdk.ais.searchVessels({ query: "x".repeat(101) })).rejects.toBeInstanceOf(
      InputValidationError,
    );
  });

  it("returns the published coverage area", async () => {
    const { sdk } = aisSdk(() => jsonResponse(aisCoverageAreaFixture));
    const response = await sdk.ais.getCoverageArea();
    expect(response.data.type).toBe("MultiPolygon");
    expect(response.data.coordinates[0]?.[0]?.[0]).toEqual([4, 58]);
  });
});

describe("AisClient snapshots", () => {
  it("asks for the full model and merges position with identity", async () => {
    const { sdk, requests } = aisSdk(() => jsonResponse(aisSnapshotFixture));
    const response = await sdk.ais.getVesselSnapshot("257111020");
    const body = JSON.parse(
      String(
        requests.find((request) => request.url.pathname.endsWith("latest/combined"))?.init?.body,
      ),
    );
    expect(body.modelType).toBe("Full");
    expect(body.mmsi).toEqual([257111020]);
    expect(response.data).toMatchObject({
      mmsi: "257111020",
      messageTime: "2026-07-24T10:45:00+00:00",
      staticMessageTime: "2026-07-24T06:02:00+00:00",
      callSign: "LF7250",
      imoNumber: "9123456",
      name: "TESTBÅT",
      draught: 34,
    });
  });

  it("resolves to undefined when the provider holds nothing for the MMSI", async () => {
    const { sdk } = aisSdk(() => jsonResponse([]));
    const response = await sdk.ais.getVesselSnapshot("257111020");
    expect(response.data).toBeUndefined();
  });

  it("ignores a snapshot for a different MMSI", async () => {
    const { sdk } = aisSdk(() => jsonResponse([{ ...aisSnapshotFixture[0], mmsi: 257111099 }]));
    const response = await sdk.ais.getVesselSnapshot("257111020");
    expect(response.data).toBeUndefined();
  });

  it("filters latest positions to position reports and applies a bounding box", async () => {
    const { sdk, requests } = aisSdk(() =>
      jsonResponse([aisPositionMessageFixture, aisStaticMessageFixture]),
    );
    const response = await sdk.ais.getLatestPositions({
      boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
      shipTypes: [30],
      countryCodes: ["NO"],
      since: "2026-07-24T00:00:00Z",
    });
    const body = JSON.parse(
      String(requests.find((request) => request.url.pathname.endsWith("latest/ais"))?.init?.body),
    );
    expect(body.geometry.type).toBe("Polygon");
    expect(body.shipTypes).toEqual([30]);
    expect(body.countryCodes).toEqual(["NO"]);
    expect(body.since).toBe("2026-07-24T00:00:00Z");
    expect(body.includePosition).toBe(true);
    expect(body.includeStatic).toBe(false);
    // `downsample` applies only to the streaming filter upstream.
    expect(body).not.toHaveProperty("downsample");

    expect(response.data).toHaveLength(1);
    expect(response.data[0]?.kind).toBe("position");
  });

  it("converts the transmitted draught to metres on request", () => {
    expect(draughtMetres(34)).toBe(3.4);
    expect(draughtMetres(255)).toBe(25.5);
    expect(draughtMetres(undefined)).toBeUndefined();
  });
});

describe("AisClient streaming", () => {
  function streamSdk(chunks: readonly string[], status = 200): NorwayOpenData {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
      return ndjsonResponse(chunks, status);
    }) as typeof globalThis.fetch;
    return new NorwayOpenData({ fetch, retries: 0, rateLimit: { enabled: false }, credentials });
  }

  it("makes no request until the stream is iterated", async () => {
    const fetch = vi.fn(async () => jsonResponse(tokenResponseFixture)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, retries: 0, credentials });
    const stream = sdk.ais.streamPositions({
      boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
    });
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    // Releasing an un-iterated stream must not send anything either.
    await stream.return(undefined);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("yields only position reports from a mixed stream", async () => {
    const sdk = streamSdk([
      `${JSON.stringify(aisPositionMessageFixture)}\n`,
      `${JSON.stringify(aisStaticMessageFixture)}\n`,
      `${JSON.stringify({ ...aisPositionMessageFixture, mmsi: 257111021 })}\n`,
    ]);
    const positions = await collect(
      sdk.ais.streamPositions({ boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 } }),
    );
    expect(positions.map((position) => position.mmsi)).toEqual(["257111020", "257111021"]);
    expect(positions.every((position) => position.kind === "position")).toBe(true);
  });

  it("discriminates every documented message kind", async () => {
    const sdk = streamSdk([
      `${JSON.stringify(aisPositionMessageFixture)}\n`,
      `${JSON.stringify(aisStaticMessageFixture)}\n`,
      `${JSON.stringify(aisAtonMessageFixture)}\n`,
      `${JSON.stringify(aisWeatherMessageFixture)}\n`,
      `${JSON.stringify(aisSafetyMessageFixture)}\n`,
    ]);
    const messages = await collect(
      sdk.ais.streamMessages({
        includeStatic: true,
        includeAidToNavigation: true,
        includeWeather: true,
        includeSafety: true,
      }),
    );
    expect(messages.map((message) => message.kind)).toEqual([
      "position",
      "static",
      "aid-to-navigation",
      "weather",
      "safety",
    ]);
    const staticData = messages[1];
    expect(staticData).toMatchObject({ kind: "static", callSign: "LF7250", imoNumber: "9123456" });
    // A static message must keep the fields a position-only shape would strip.
    expect(staticData).toHaveProperty("name", "TESTBÅT");
    expect(messages[3]).toMatchObject({ kind: "weather", significantWaveHeight: 1.4 });
    expect(messages[4]).toMatchObject({ kind: "safety", text: "TEST TRANSMISSION" });
  });

  it("carries every published met/hydro field through to the streamed message", async () => {
    // The met/hydro broadcast is the widest AIS payload the provider publishes, and
    // a streamed message has no accompanying raw payload, so anything dropped in
    // normalization is unrecoverable for the caller.
    const sdk = streamSdk([`${JSON.stringify(aisWeatherMessageFixture)}\n`]);
    const [weather] = await collect(sdk.ais.streamMessages({ includeWeather: true }));
    expect(weather).toEqual({
      kind: "weather",
      mmsi: "2570001",
      messageTime: "2026-07-24T10:00:00+00:00",
      messageType: 8,
      providerType: "BinaryBroadcastMessageMetHyd",
      stream: "terra",
      latitude: 59.2,
      longitude: 5.1,
      functionalId: 31,
      designatedAreaCode: 1,
      day: 24,
      hour: 10,
      minute: 0,
      averageWindSpeed: 14,
      windGust: 22,
      windDirection: 240,
      windGustDirection: 245,
      airTemperature: 16.1,
      relativeHumidity: 78,
      dewPoint: 12.4,
      airPressure: 1013,
      airPressureTendency: "Steady",
      horizontalVisibility: 12.5,
      waterLevel: 1.2,
      waterLevelTrend: "Increasing",
      surfaceCurrentSpeed: 0.8,
      surfaceCurrentDirection: 190,
      currentSpeed2: 0.6,
      currentDirection2: 185,
      currentMeasuringLevel2: 10,
      currentSpeed3: 0.4,
      currentDirection3: 180,
      currentMeasuringLevel3: 20,
      significantWaveHeight: 1.4,
      wavePeriod: 7,
      waveDirection: 245,
      swellHeight: 0.9,
      swellPeriod: 11,
      swellDirection: 250,
      seaState: "SmallWaves",
      waterTemperature: 14.2,
      precipitationType: "Rain",
      salinity: 34.5,
      ice: "No",
    });
  });

  it("keeps an addressed safety message's sequence number and destination", async () => {
    const sdk = streamSdk([
      `${JSON.stringify({
        type: "SafetyRelated",
        messageType: 12,
        mmsi: 257111020,
        msgtime: "2026-07-24T10:50:00+00:00",
        safetyRelatedText: "PLEASE RESPOND",
        sequenceNumber: 2,
        destinationMmsi: 257111021,
        stream: "TERRESTRIAL",
      })}\n`,
    ]);
    const [safety] = await collect(sdk.ais.streamMessages({ includeSafety: true }));
    expect(safety).toMatchObject({
      kind: "safety",
      sequenceNumber: 2,
      // Kept as a string for the same reason as every other MMSI in the SDK.
      destinationMmsi: "257111021",
    });
  });

  it.each(["Staticdata", "StaticData", "STATICDATA"])(
    "classifies a static message labelled %s, whatever the casing",
    async (label) => {
      // The live service sends `Staticdata`; the provider's prose documentation
      // writes `StaticData`. Matching case-sensitively would push every static
      // message onto the numeric fallback, and would misclassify one whose
      // messageType is not 5 or 24 as `unknown`.
      const sdk = streamSdk([`${JSON.stringify({ ...aisStaticMessageFixture, type: label })}\n`]);
      const [message] = await collect(sdk.ais.streamMessages({ includeStatic: true }));
      expect(message).toMatchObject({ kind: "static", name: "TESTBÅT", providerType: label });
    },
  );

  it("surfaces an unmodelled message kind instead of dropping or rejecting it", async () => {
    const sdk = streamSdk([
      `${JSON.stringify({ type: "SomethingNew", messageType: 99, mmsi: 257111020, msgtime: "2026-07-24T11:00:00+00:00" })}\n`,
    ]);
    const messages = await collect(sdk.ais.streamMessages());
    expect(messages).toEqual([
      {
        kind: "unknown",
        mmsi: "257111020",
        messageTime: "2026-07-24T11:00:00+00:00",
        messageType: 99,
        providerType: "SomethingNew",
      },
    ]);
  });

  it("falls back to the numeric AIS type when the provider omits its label", async () => {
    const unlabelled = { ...aisPositionMessageFixture };
    delete (unlabelled as { type?: string }).type;
    const sdk = streamSdk([`${JSON.stringify(unlabelled)}\n`]);
    const positions = await collect(sdk.ais.streamPositions());
    // Without the fallback this position report would arrive as `unknown` and be
    // filtered out of the position stream entirely.
    expect(positions).toHaveLength(1);
    expect(positions[0]?.latitude).toBe(59.3902);
  });

  it("sends the requested filter and selectors in the stream body", async () => {
    const bodies: string[] = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
      bodies.push(String(init?.body));
      return ndjsonResponse([`${JSON.stringify(aisPositionMessageFixture)}\n`]);
    }) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({
      fetch,
      retries: 0,
      rateLimit: { enabled: false },
      credentials,
    });
    await collect(
      sdk.ais.streamPositions({
        boundingBox: { south: 58.8, west: 4.5, north: 60, east: 6.5 },
        mmsi: ["257111020"],
        downsample: true,
      }),
    );
    const body = JSON.parse(bodies[0] ?? "{}");
    expect(body.mmsi).toEqual([257111020]);
    expect(body.downsample).toBe(true);
    expect(body.includePosition).toBe(true);
  });

  it("stops cleanly when the consumer leaves the loop early", async () => {
    const sdk = streamSdk([
      `${JSON.stringify(aisPositionMessageFixture)}\n`,
      `${JSON.stringify({ ...aisPositionMessageFixture, mmsi: 257111021 })}\n`,
      `${JSON.stringify({ ...aisPositionMessageFixture, mmsi: 257111022 })}\n`,
    ]);
    const positions = await collect(sdk.ais.streamPositions(), 1);
    expect(positions).toHaveLength(1);
  });

  it("stops with a cancellation error when the caller aborts", async () => {
    const sdk = streamSdk([
      `${JSON.stringify(aisPositionMessageFixture)}\n`,
      `${JSON.stringify({ ...aisPositionMessageFixture, mmsi: 257111021 })}\n`,
    ]);
    const controller = new AbortController();
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const position of sdk.ais.streamPositions({ signal: controller.signal })) {
          seen.push(position.mmsi);
          controller.abort();
        }
      })(),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(seen).toEqual(["257111020"]);
  });

  it("rejects before opening when the signal is already aborted", async () => {
    const fetch = vi.fn(async () => jsonResponse(tokenResponseFixture)) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch, retries: 0, credentials });
    const controller = new AbortController();
    controller.abort();
    await expect(
      collect(sdk.ais.streamPositions({ signal: controller.signal })),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("maps a failed stream open onto the usual provider errors", async () => {
    await expect(collect(streamSdk([], 503).ais.streamPositions())).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(collect(streamSdk([], 404).ais.streamPositions())).rejects.toThrow(/not found/);
  });

  it("rejects a stream record that does not match the schema", async () => {
    const sdk = streamSdk([
      `${JSON.stringify(aisPositionMessageFixture)}\n`,
      '{"mmsi":"not-a-number","messageType":1,"msgtime":"2026-07-24T11:00:00+00:00"}\n',
    ]);
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const position of sdk.ais.streamPositions()) seen.push(position.mmsi);
      })(),
    ).rejects.toBeInstanceOf(ResponseValidationError);
    expect(seen).toEqual(["257111020"]);
  });

  it("does not reopen the stream after the provider closes it", async () => {
    let opens = 0;
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
      opens += 1;
      return ndjsonResponse([`${JSON.stringify(aisPositionMessageFixture)}\n`]);
    }) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({
      fetch,
      retries: 2,
      rateLimit: { enabled: false },
      credentials,
    });
    const positions = await collect(sdk.ais.streamPositions());
    expect(positions).toHaveLength(1);
    // Even with retries configured, a closed stream ends the iteration.
    expect(opens).toBe(1);
  });
});

/**
 * Guards the whole path from provider payload to normalized value.
 *
 * The runtime schemas are checked against the provider's OpenAPI documents
 * separately, but a schema can validate a field that normalization then discards.
 * On a stream that loss is permanent, since there is no raw payload alongside it.
 * These fixtures carry every field their upstream shape declares, so a field
 * dropped in normalization fails here.
 */
describe("AIS normalization loses no validated field", () => {
  /** Upstream field name to the SDK name, where the SDK renames one. */
  const RENAMED: Record<string, string> = {
    type: "providerType",
    msgtime: "messageTime",
    msgtimeStatic: "staticMessageTime",
    timeStamp: "messageTime",
    avgWindSpeed: "averageWindSpeed",
    typeOfAidsToNavigation: "aidType",
    typeOfElectronicFixingDevice: "electronicFixingDeviceType",
    safetyRelatedText: "text",
  };

  function assertNoFieldLost(upstream: Record<string, unknown>, normalized: object): void {
    const present = new Set(Object.keys(normalized));
    for (const [key, value] of Object.entries(upstream)) {
      // A null upstream value is absence, and the SDK omits absent fields rather
      // than setting them to undefined.
      if (value === null) continue;
      expect({ field: key, kept: present.has(RENAMED[key] ?? key) }).toEqual({
        field: key,
        kept: true,
      });
    }
  }

  it.each([
    { label: "position", fixture: aisPositionMessageFixture, selection: {} },
    { label: "static", fixture: aisStaticMessageFixture, selection: { includeStatic: true } },
    { label: "aid-to-navigation", fixture: aisAtonMessageFixture, selection: {} },
    { label: "weather", fixture: aisWeatherMessageFixture, selection: { includeWeather: true } },
    { label: "safety", fixture: aisSafetyMessageFixture, selection: { includeSafety: true } },
  ])("keeps every field of a $label message", async ({ fixture, selection }) => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.hostname === "id.barentswatch.no") return jsonResponse(tokenResponseFixture);
      return ndjsonResponse([`${JSON.stringify(fixture)}\n`]);
    }) as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({
      fetch,
      retries: 0,
      rateLimit: { enabled: false },
      credentials,
    });
    const [message] = await collect(sdk.ais.streamMessages(selection));
    assertNoFieldLost(fixture, message as object);
  });

  it("keeps every field of a combined vessel snapshot", async () => {
    const { sdk } = aisSdk(() => jsonResponse(aisSnapshotFixture));
    const response = await sdk.ais.getVesselSnapshot("257111020");
    assertNoFieldLost(aisSnapshotFixture[0] as Record<string, unknown>, response.data as object);
  });

  it("keeps every field of a track point", async () => {
    const { sdk } = aisSdk(() => jsonResponse(aisTrackFixture));
    const response = await sdk.ais.getTrackLast24Hours("257111020");
    const point = response.data.points.find((candidate) => candidate.stream !== undefined);
    assertNoFieldLost(aisTrackFixture[0] as Record<string, unknown>, point as object);
  });

  it("keeps every field of a vessel search match", async () => {
    const { sdk } = aisSdk(() => jsonResponse(aisVesselSearchFixture));
    const response = await sdk.ais.searchVessels({ query: "TESTBÅT" });
    assertNoFieldLost(
      aisVesselSearchFixture[0] as Record<string, unknown>,
      response.data[0] as object,
    );
  });
});
