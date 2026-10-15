import addressFixture from "../fixtures/kartverket-address.json" with { type: "json" };
import placeFixture from "../fixtures/kartverket-place.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { InputValidationError, NorwayOpenData, ResponseValidationError } from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("Kartverket clients", () => {
  it("constructs and normalizes address searches", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(addressFixture));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).addresses.search({
      query: "Haraldsgata 100",
      municipalityCode: "1106",
      postalCode: "5528",
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/adresser/v1/sok");
    expect(url.searchParams.get("sok")).toBe("Haraldsgata 100");
    expect(response.data.items[0]).toEqual({
      addressText: "Haraldsgata 100",
      streetName: "Haraldsgata",
      houseNumber: 100,
      postalCode: "5528",
      postalPlace: "HAUGESUND",
      municipalityCode: "1106",
      municipalityName: "HAUGESUND",
      countyCode: "11",
      latitude: 59.4111516,
      longitude: 5.2711408,
    });
  });

  it("filters addresses by county where the API has no direct county parameter", async () => {
    const firstAddress = addressFixture.adresser[0];
    if (firstAddress === undefined) throw new Error("Address fixture must contain one result.");
    const payload = {
      metadata: { totaltAntallTreff: 2 },
      adresser: [firstAddress, { ...firstAddress, adressetekst: "Haraldsgata 102", nummer: 102 }],
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).addresses.search({
      query: "Haraldsgata",
      countyCode: "11",
      limit: 1,
    });
    expect(response.data.items).toHaveLength(1);
    expect(response.data.total).toBe(2);
    expect(new URL(String(mock.mock.calls[0]?.[0])).searchParams.get("treffPerSide")).toBe("1000");
  });

  it("omits a county-filtered total when the fetched provider window is incomplete", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        ...addressFixture,
        metadata: { totaltAntallTreff: 1_001 },
      }),
    );
    const response = await new NorwayOpenData({ fetch, retries: 0 }).addresses.search({
      query: "Haraldsgata",
      countyCode: "11",
    });
    expect(response.data.total).toBeUndefined();
  });

  it("normalizes place search and nearby query fields", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(placeFixture),
      jsonResponse({
        ...placeFixture,
        navn: [
          {
            navneobjekttype: "Adressenavn",
            representasjonspunkt: { nord: 59.91, øst: 10.75 },
            stedsnavn: [{ skrivemåte: "Prinsens gate" }],
          },
        ],
      }),
    );
    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    const search = await sdk.places.search({ query: "Oslo", countyCode: "03", limit: 900 });
    expect(search.data.items[0]).toMatchObject({
      name: "Oslo",
      municipalityCode: "0301",
      longitude: 10.73353,
    });
    expect(new URL(String(mock.mock.calls[0]?.[0])).searchParams.get("treffPerSide")).toBe("500");
    const nearby = await sdk.places.nearby({
      latitude: 59.91,
      longitude: 10.75,
      radiusMeters: 10_000,
    });
    expect(nearby.data.items[0]?.name).toBe("Prinsens gate");
    const nearbyUrl = new URL(String(mock.mock.calls[1]?.[0]));
    expect(nearbyUrl.pathname).toBe("/stedsnavn/v1/punkt");
    expect(nearbyUrl.searchParams.get("radius")).toBe("5000");
    expect(nearbyUrl.searchParams.get("koordsys")).toBe("4258");
  });

  it.each([
    () => ({ query: "", municipalityCode: "11" }),
    () => ({ query: "Oslo", countyCode: "3" }),
  ])("validates search inputs", async (parameters) => {
    const sdk = new NorwayOpenData({ fetch: async () => jsonResponse({}) });
    await expect(sdk.places.search(parameters())).rejects.toBeInstanceOf(InputValidationError);
  });

  it.each([
    { latitude: 91, longitude: 10 },
    { latitude: 60, longitude: 181 },
  ])("validates coordinate ranges: %o", async (coordinates) => {
    const sdk = new NorwayOpenData({ fetch: async () => jsonResponse({}) });
    await expect(sdk.places.nearby(coordinates)).rejects.toBeInstanceOf(InputValidationError);
  });

  it.each([
    { metadata: { totaltAntallTreff: 1 }, adresser: [{}] },
    { metadata: { totaltAntallTreff: 1 }, navn: [{}] },
  ])("rejects provider list entries without usable data", async (payload) => {
    const { fetch } = sequenceFetch(jsonResponse(payload));
    const sdk = new NorwayOpenData({ fetch, retries: 0 });
    const request =
      "adresser" in payload
        ? sdk.addresses.search({ query: "x" })
        : sdk.places.search({ query: "x" });
    await expect(request).rejects.toBeInstanceOf(ResponseValidationError);
  });
});

describe("places.getMunicipalityAt", () => {
  const oslo = {
    fylkesnavn: "Oslo",
    fylkesnummer: "03",
    kommunenavn: "Oslo",
    kommunenummer: "0301",
  };
  const noMatch = (): Response =>
    new Response(
      "<!doctype html>\n<html lang=en>\n<title>404 Not Found</title>\n<h1>Not Found</h1>\n<p>Ingen treff, sjekk parameterene.</p>\n",
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } },
    );

  it("resolves a point to the municipality whose boundary contains it", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(oslo));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).places.getMunicipalityAt({
      latitude: 59.9139,
      longitude: 10.7522,
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.kartverket.no/kommuneinfo/v1/punkt");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      koordsys: "4258",
      nord: "59.9139",
      ost: "10.7522",
    });
    expect(response.data).toEqual({
      municipalityCode: "0301",
      municipalityName: "Oslo",
      countyCode: "03",
      countyName: "Oslo",
    });
    expect(response.source.id).toBe("kartverket");
  });

  it("resolves to undefined for a point outside every municipality", async () => {
    const { fetch } = sequenceFetch(noMatch());
    const response = await new NorwayOpenData({ fetch, retries: 0 }).places.getMunicipalityAt({
      latitude: 60.1,
      longitude: 4,
    });
    expect(response.data).toBeUndefined();
  });

  it("still reports an unrelated 404 as not found", async () => {
    const { fetch } = sequenceFetch(new Response("<h1>Not Found</h1>", { status: 404 }));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).places.getMunicipalityAt({
        latitude: 60,
        longitude: 5,
      }),
    ).rejects.toMatchObject({ name: "NotFoundError", statusCode: 404 });
  });

  it("validates coordinates before any request", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(oslo));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).places.getMunicipalityAt({
        latitude: 59.9,
        longitude: 181,
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(mock).not.toHaveBeenCalled();
  });

  it("rejects a malformed municipality number", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ ...oslo, kommunenummer: "301" }));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).places.getMunicipalityAt({
        latitude: 59.9,
        longitude: 10.7,
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
