import { describe, expect, it } from "vitest";

import {
  bergenReferenceLevelsXml,
  bergenTideTableXml,
  bergenWaterLevelsXml,
  farSeaNoDataXml,
  illegalReferenceErrorXml,
  inlandNoDataXml,
  inlandReferenceLevelsXml,
  kaupangerWaterLevelsXml,
  reversedWindowErrorXml,
  tideStationListXml,
} from "../fixtures/kartverket-tides.js";
import {
  InputValidationError,
  NorwayOpenData,
  ProviderError,
  ResponseValidationError,
} from "../../src/index.js";
import { sequenceFetch } from "./helpers.js";

function xmlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

type TidesHarness = {
  tides: NorwayOpenData["tides"];
  mock: ReturnType<typeof sequenceFetch>["mock"];
  url: (call?: number) => URL;
  headers: (call?: number) => Headers;
};

function tides(...bodies: string[]): TidesHarness {
  const { fetch, mock } = sequenceFetch(...bodies.map(xmlResponse));
  const sdk = new NorwayOpenData({ fetch, retries: 0 });
  return {
    tides: sdk.tides,
    mock,
    url: (call = 0) => new URL(String(mock.mock.calls[call]?.[0])),
    headers: (call = 0) => new Headers((mock.mock.calls[call]?.[1] as RequestInit).headers),
  };
}

const bergenWindow = {
  latitude: 60.398046,
  longitude: 5.320487,
  from: "2026-10-15T14:00:00+02:00",
  to: "2026-10-17T12:00:30Z",
};

describe("tides.listStations", () => {
  it("lists permanent gauges from the station XML", async () => {
    const client = tides(tideStationListXml);
    const response = await client.tides.listStations();

    expect(Object.fromEntries(client.url().searchParams)).toEqual({
      tide_request: "stationlist",
      type: "perm",
    });
    expect(client.headers().get("Accept")).toBe("application/xml, text/xml");
    expect(response.data).toHaveLength(4);
    expect(response.data[2]).toEqual({
      code: "BOO",
      name: "Bodø",
      latitude: 67.29233,
      longitude: 14.39977,
      type: "PERM",
    });
    expect(response.source).toMatchObject({
      id: "kartverket-tides",
      license: expect.stringContaining("CC BY 4.0"),
      attribution: expect.stringContaining("Hydrographic Service"),
    });
  });

  it("accepts the <station> element spelled in the protocol document", async () => {
    const client = tides(
      '<tide><stationinfo><station name="Bergen" code="BGO" latitude="60.398046" longitude="5.320487"/></stationinfo></tide>',
    );
    const response = await client.tides.listStations();
    expect(response.data).toEqual([
      { code: "BGO", name: "Bergen", latitude: 60.398046, longitude: 5.320487 },
    ]);
  });

  it("returns the provider XML as the raw payload when asked", async () => {
    const client = tides(tideStationListXml);
    const response = await client.tides.listStations({ includeRaw: true });
    expect(response.raw).toBe(tideStationListXml);
  });
});

describe("tides.getWaterLevels", () => {
  it("requests every series in UTC and explains how values were derived", async () => {
    const client = tides(bergenWaterLevelsXml);
    const response = await client.tides.getWaterLevels(bergenWindow);

    expect(Object.fromEntries(client.url().searchParams)).toEqual({
      tide_request: "locationdata",
      lat: "60.398",
      lon: "5.3205",
      refcode: "cd",
      lang: "nb",
      fromtime: "2026-10-15T12:00",
      totime: "2026-10-17T12:01",
      datatype: "all",
      interval: "60",
      dst: "0",
      tzone: "0",
      uncertainty: "1",
    });
    expect(response.data?.location).toEqual({
      name: "Bergen",
      code: "BGO",
      latitude: 60.398,
      longitude: 5.32,
      factor: 1,
      delayMinutes: 0,
      surgeStationName: "Bergen",
      surgeStationCode: "BGO",
      description: "Tides and observed water level from Bergen",
    });
    expect(response.data?.referenceLevel).toBe("CD");
    expect(response.data?.serviceMessages).toEqual([]);
    expect(response.data?.series.map((series) => series.type)).toEqual([
      "observation",
      "prediction",
      "weathereffect",
      "forecast",
    ]);
    const [observation, , surge, forecast] = response.data?.series ?? [];
    expect(observation).toMatchObject({
      unit: "cm",
      quality: { flag: 1, class: "Quality High" },
    });
    expect(observation?.values[0]).toEqual({
      time: "2026-10-15T12:00:00+00:00",
      value: 162.9,
      flag: "obs",
    });
    expect(surge?.values[0]).toEqual({ time: "2026-10-15T12:00:00+00:00", value: 8.1 });
    expect(forecast?.values[0]).toEqual({
      time: "2026-10-15T12:00:00+00:00",
      value: 157.8,
      flag: "forecast",
      uncertainty: {
        lowerPercentile: 152.8,
        lowPercentile: 155.8,
        highPercentile: 156.8,
        higherPercentile: 163.8,
      },
    });
  });

  it("forwards the reference level, interval and language and keeps service notices", async () => {
    const client = tides(kaupangerWaterLevelsXml);
    const response = await client.tides.getWaterLevels({
      latitude: 61.2,
      longitude: 7.1,
      from: "2026-10-15T00:00:00Z",
      to: "2026-10-15T06:00:00Z",
      interval: 10,
      referenceLevel: "mean-sea-level",
      language: "en",
    });

    expect(client.url().searchParams.get("refcode")).toBe("msl");
    expect(client.url().searchParams.get("interval")).toBe("10");
    expect(client.url().searchParams.get("lang")).toBe("en");
    expect(response.data?.referenceLevel).toBe("MSL");
    expect(response.data?.serviceMessages).toEqual([
      "Real time data from Kaupanger may be delayed compared to the other permanent tide gauges",
    ]);
    expect(response.data?.series[0]?.quality).toMatchObject({ flag: 0, class: "Quality Not Set" });
  });

  it.each([
    ["inland", inlandNoDataXml],
    ["far offshore", farSeaNoDataXml],
  ])("resolves to undefined %s", async (_label, body) => {
    const client = tides(body);
    const response = await client.tides.getWaterLevels({
      ...bergenWindow,
      latitude: 61.5,
      longitude: 9,
    });
    expect(response.data).toBeUndefined();
    expect(response.source.id).toBe("kartverket-tides");
  });

  it.each([
    [{ ...bergenWindow, from: "2026-10-01T00:00:00Z", to: "2026-11-02T00:00:00Z" }, "31 days"],
    [
      { ...bergenWindow, from: "2026-10-01T00:00:00Z", to: "2026-10-09T00:00:00Z", interval: 10 },
      "7 days",
    ],
    [{ ...bergenWindow, from: "2026-10-16T00:00:00Z", to: "2026-10-15T00:00:00Z" }, "later than"],
    [{ ...bergenWindow, from: "2026-10-15T00:00" }, "explicit offset"],
    [{ ...bergenWindow, interval: 30 }, "water-level parameters"],
    [{ ...bergenWindow, referenceLevel: "lat" }, "water-level parameters"],
    [{ ...bergenWindow, latitude: 95 }, "water-level parameters"],
  ])("rejects %j before any request", async (parameters, reason) => {
    const client = tides();
    const request = client.tides.getWaterLevels(parameters as never);
    await expect(request).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.tides.getWaterLevels(parameters as never)).rejects.toThrow(reason);
    expect(client.mock).not.toHaveBeenCalled();
  });

  it("raises the provider's own explanation when it rejects a request", async () => {
    const client = tides(illegalReferenceErrorXml, reversedWindowErrorXml);
    const rejection = client.tides.getWaterLevels(bergenWindow);
    await expect(rejection).rejects.toBeInstanceOf(ProviderError);
    await expect(rejection).rejects.toThrow(
      "Kartverket's tide API rejected the request: Illegal reference level code.",
    );
    await expect(client.tides.getWaterLevels(bergenWindow)).rejects.toMatchObject({
      name: "ProviderError",
      provider: "kartverket-tides",
      message: expect.stringContaining("FROM time must be less than TO time"),
    });
  });

  it("explains an <error> with no text", async () => {
    const client = tides("<error></error>");
    await expect(client.tides.getWaterLevels(bergenWindow)).rejects.toThrow("no reason given");
  });

  it.each([
    ["<tide><locationdata>", "not well-formed"],
    ["<html><body>maintenance</body></html>", "returned <html> instead of <tide>"],
    ["<tide/>", "omitted <locationdata>"],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32"/></locationdata></tide>',
      "omitted <reflevelcode>",
    ],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32"/><reflevelcode> </reflevelcode></locationdata></tide>',
      "empty reference level code",
    ],
    [
      '<tide><locationdata><location code="BGO" latitude="60.398" longitude="5.32"/><reflevelcode>CD</reflevelcode></locationdata></tide>',
      'omitted "name"',
    ],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="north" longitude="5.32"/><reflevelcode>CD</reflevelcode></locationdata></tide>',
      'non-numeric "latitude"',
    ],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32"/><reflevelcode>CD</reflevelcode><data type="observation" unit="cm"><waterlevel value="1.0" time="2026-10-15T12:00"/></data></locationdata></tide>',
      'invalid "time" timestamp',
    ],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32"/><reflevelcode>CD</reflevelcode><data type="observation" unit="cm"><waterlevel value="1.0" time="2026-10-15T12:00:00+00:00" lowpercentile="n/a"/></data></locationdata></tide>',
      'non-numeric "lowpercentile"',
    ],
  ])("rejects a malformed response %#", async (body, reason) => {
    const client = tides(body);
    const request = client.tides.getWaterLevels(bergenWindow);
    await expect(request).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(request).rejects.toThrow(reason);
  });

  it("accepts the alternative desc spelling the provider is harmonizing", async () => {
    const client = tides(
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32" desc="Tides from Bergen"/><reflevelcode>CD</reflevelcode></locationdata></tide>',
    );
    const response = await client.tides.getWaterLevels(bergenWindow);
    expect(response.data?.location.description).toBe("Tides from Bergen");
    expect(response.data?.series).toEqual([]);
  });
});

describe("tides.getTideTable", () => {
  it("returns predicted high and low waters", async () => {
    const client = tides(bergenTideTableXml);
    const response = await client.tides.getTideTable({
      latitude: 60.398,
      longitude: 5.32,
      from: "2026-10-15T00:00:00Z",
      to: "2026-10-17T00:00:00Z",
    });

    const query = Object.fromEntries(client.url().searchParams);
    expect(query).toMatchObject({ datatype: "tab", tide_request: "locationdata", tzone: "0" });
    expect(query).not.toHaveProperty("interval");
    expect(response.data).toMatchObject({ referenceLevel: "CD", unit: "cm", serviceMessages: [] });
    expect(response.data?.events.slice(0, 2)).toEqual([
      { time: "2026-10-15T00:10:00+00:00", value: 156.5, kind: "high" },
      { time: "2026-10-15T05:55:00+00:00", value: 60.7, kind: "low" },
    ]);
    expect(response.data?.events).toHaveLength(8);
  });

  it("accepts a full year and refuses anything longer", async () => {
    const client = tides(bergenTideTableXml);
    await expect(
      client.tides.getTideTable({
        latitude: 60.398,
        longitude: 5.32,
        from: "2026-01-01T00:00:00Z",
        to: "2027-01-02T00:00:00Z",
      }),
    ).resolves.toBeDefined();
    await expect(
      client.tides.getTideTable({
        latitude: 60.398,
        longitude: 5.32,
        from: "2026-01-01T00:00:00Z",
        to: "2027-01-03T00:00:00Z",
      }),
    ).rejects.toThrow("366 days");
  });

  it("resolves to undefined where Kartverket has no sea-level data", async () => {
    const client = tides(inlandNoDataXml);
    const response = await client.tides.getTideTable({
      latitude: 61.5,
      longitude: 9,
      from: "2026-10-15T00:00:00Z",
      to: "2026-10-16T00:00:00Z",
    });
    expect(response.data).toBeUndefined();
  });

  it.each([
    [bergenTideTableXml.replace('flag="high"', 'flag="pre"'), 'marked a tide-table entry "pre"'],
    [bergenWaterLevelsXml, "returned 4 series for a tide table"],
    [
      '<tide><locationdata><location name="Bergen" code="BGO" latitude="60.398" longitude="5.32"/><reflevelcode>CD</reflevelcode></locationdata></tide>',
      "returned 0 series for a tide table",
    ],
  ])("rejects a table that is not one series of highs and lows %#", async (body, reason) => {
    const client = tides(body);
    await expect(
      client.tides.getTideTable({
        latitude: 60.398,
        longitude: 5.32,
        from: "2026-10-15T00:00:00Z",
        to: "2026-10-16T00:00:00Z",
      }),
    ).rejects.toThrow(reason);
  });
});

describe("tides.getReferenceLevels", () => {
  it("returns datums, tide levels, observed extremes and return levels", async () => {
    const client = tides(bergenReferenceLevelsXml);
    const response = await client.tides.getReferenceLevels({
      latitude: 60.398,
      longitude: 5.32,
      referenceLevel: "nn2000",
    });

    expect(Object.fromEntries(client.url().searchParams)).toEqual({
      tide_request: "locationlevels",
      lat: "60.398",
      lon: "5.32",
      refcode: "nn2000",
      lang: "nb",
    });
    expect(response.data).toMatchObject({ referenceLevel: "CD", unit: "cm", serviceMessages: [] });
    expect(response.data?.location.code).toBe("BGO");
    const levels = response.data?.levels ?? [];
    const byCode = Object.fromEntries(levels.map((level) => [level.code, level]));
    // Provider order is preserved: highest level first.
    expect(levels.map((level) => level.code)).toEqual([
      "HOWL",
      "200YMAX",
      "HAT",
      "NN2000",
      "MSL",
      "LAT",
      "CD",
    ]);
    expect(byCode["HOWL"]).toMatchObject({ value: 244.9, type: "OBS", info: "27.2.1990" });
    expect(byCode["MSL"]).toMatchObject({ value: 95.2, type: "REF", epoch: "1996-2014" });
    expect(byCode["HAT"]?.description).toContain("highest tidal level");
  });

  it("resolves to undefined inland", async () => {
    const client = tides(inlandReferenceLevelsXml);
    await expect(
      client.tides.getReferenceLevels({ latitude: 61.5, longitude: 9 }),
    ).resolves.toMatchObject({ data: undefined });
  });

  it("rejects a response without a level container", async () => {
    const client = tides("<tide><meta/></tide>");
    await expect(
      client.tides.getReferenceLevels({ latitude: 60.398, longitude: 5.32 }),
    ).rejects.toThrow("omitted <locationlevel>");
  });
});
