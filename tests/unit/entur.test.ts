import departureFixture from "../fixtures/entur-departures.json" with { type: "json" };
import journeyFixture from "../fixtures/entur-journeys.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  NorwayOpenData,
  ProviderError,
  ResponseValidationError,
} from "../../src/index.js";
import { DEPARTURES_QUERY, JOURNEYS_QUERY } from "../../src/providers/entur/queries.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("EnturClient", () => {
  it("sends the required identification header and normalizes autocomplete", async () => {
    const payload = {
      features: [
        {
          geometry: { coordinates: [10.75, 59.91] },
          properties: {
            id: "NSR:StopPlace:1",
            name: "Oslo S",
            label: "Oslo S, Oslo",
            category: ["onstreetBus", "railStation"],
          },
        },
      ],
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const result = await new NorwayOpenData({
      applicationName: "example-departures",
      fetch,
      retries: 0,
    }).transport.autocomplete({ text: "Oslo", latitude: 59.9, longitude: 10.7 });
    expect(result.data[0]).toMatchObject({
      id: "NSR:StopPlace:1",
      name: "Oslo S",
      category: "onstreetBus,railStation",
      latitude: 59.91,
    });
    const init = mock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("ET-Client-Name")).toBe("example-departures");
  });

  it("stores and sends the departure GraphQL document with variables", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(departureFixture));
    const result = await new NorwayOpenData({
      applicationName: "example-departures",
      fetch,
      retries: 0,
    }).transport.departures({ stopPlaceId: "NSR:StopPlace:548", limit: 10 });
    const body = JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.query).toBe(DEPARTURES_QUERY);
    expect(body.variables).toMatchObject({ id: "NSR:StopPlace:548", limit: 10 });
    expect(result.data[0]).toMatchObject({
      stopName: "Stavanger stadion",
      destinationDisplay: "Sentrum",
      realtime: true,
      cancelled: false,
      transportMode: "bus",
      line: { publicCode: "1" },
    });
  });

  it("normalizes journey patterns, calls, lines, and realtime status", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(journeyFixture));
    const result = await new NorwayOpenData({
      applicationName: "example-journeys",
      fetch,
      retries: 0,
    }).transport.journeys({
      from: { placeId: "NSR:StopPlace:548" },
      to: { latitude: 58.97, longitude: 5.73 },
      arriveBy: false,
      limit: 2,
    });
    expect(result.data[0]).toMatchObject({
      duration: 1800,
      numberOfTransfers: 0,
      origin: { name: "Stavanger stadion" },
      destination: { name: "Stavanger sentrum" },
      transportModes: ["bus"],
      realtime: true,
      legs: [
        {
          scheduledStartTime: "2026-07-20T12:00:00+02:00",
          expectedStartTime: "2026-07-20T12:02:00+02:00",
        },
      ],
    });
    const body = JSON.parse(String((mock.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.query).toBe(JOURNEYS_QUERY);
    expect(body.variables.to).toEqual({
      coordinates: { latitude: 58.97, longitude: 5.73 },
    });
  });

  it("converts HTTP-200 GraphQL errors into ProviderError", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ errors: [{ message: "invalid" }] }));
    await expect(
      new NorwayOpenData({
        applicationName: "example-errors",
        fetch,
        retries: 0,
      }).transport.departures({ stopPlaceId: "NSR:StopPlace:1" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it.each(["departures", "journeys"] as const)(
    "rejects malformed %s GraphQL envelopes",
    async (method) => {
      const { fetch } = sequenceFetch(jsonResponse({}));
      const transport = new NorwayOpenData({
        applicationName: "example-malformed",
        fetch,
        retries: 0,
      }).transport;
      const request =
        method === "departures"
          ? transport.departures({ stopPlaceId: "NSR:StopPlace:548" })
          : transport.journeys({
              from: { placeId: "NSR:StopPlace:548" },
              to: { placeId: "NSR:StopPlace:297" },
            });
      await expect(request).rejects.toBeInstanceOf(ResponseValidationError);
    },
  );

  it("validates paired coordinates and date-times", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const sdk = new NorwayOpenData({
      applicationName: "example-validation",
      fetch,
    });
    await expect(sdk.transport.autocomplete({ text: "x", latitude: 60 })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(
      sdk.transport.journeys({
        from: { latitude: 60 },
        to: { placeId: "NSR:StopPlace:1" },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      sdk.transport.departures({ stopPlaceId: "x", dateTime: "not-a-date" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      sdk.transport.departures({ stopPlaceId: "x", dateTime: "2026" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not cache GraphQL failures and verifies the returned stop identity", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse({ errors: [{ message: "temporary query failure" }] }),
      jsonResponse(departureFixture),
    );
    const transport = new NorwayOpenData({
      applicationName: "example-cache",
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).transport;
    await expect(transport.departures({ stopPlaceId: "NSR:StopPlace:548" })).rejects.toBeInstanceOf(
      ProviderError,
    );
    await expect(transport.departures({ stopPlaceId: "NSR:StopPlace:548" })).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);

    const mismatch = structuredClone(departureFixture);
    if (mismatch.data.stopPlace !== null) mismatch.data.stopPlace.id = "NSR:StopPlace:999";
    const mismatched = sequenceFetch(jsonResponse(mismatch));
    await expect(
      new NorwayOpenData({
        applicationName: "example-mismatch",
        fetch: mismatched.fetch,
        retries: 0,
      }).transport.departures({ stopPlaceId: "NSR:StopPlace:548" }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("rejects malformed autocomplete and journey values", async () => {
    const malformedAutocomplete = sequenceFetch(
      jsonResponse({ features: [{ properties: {}, geometry: { coordinates: [999, -999] } }] }),
    );
    await expect(
      new NorwayOpenData({
        applicationName: "example-malformed",
        fetch: malformedAutocomplete.fetch,
        retries: 0,
      }).transport.autocomplete({ text: "x" }),
    ).rejects.toBeInstanceOf(ResponseValidationError);

    const malformedJourney = structuredClone(journeyFixture);
    const firstPattern = malformedJourney.data.trip?.tripPatterns[0];
    if (firstPattern !== undefined) firstPattern.duration = -1;
    const journey = sequenceFetch(jsonResponse(malformedJourney));
    await expect(
      new NorwayOpenData({
        applicationName: "example-malformed",
        fetch: journey.fetch,
        retries: 0,
      }).transport.journeys({
        from: { placeId: "NSR:StopPlace:548" },
        to: { placeId: "NSR:StopPlace:297" },
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
