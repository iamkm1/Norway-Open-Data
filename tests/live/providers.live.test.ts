import { describe, expect, it } from "vitest";

import { NorwayOpenData } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe : describe.skip;
const applicationName = process.env["NORWAY_OPEN_DATA_APPLICATION_NAME"];
const contactEmail = process.env["NORWAY_OPEN_DATA_CONTACT_EMAIL"];

live("official provider smoke tests", () => {
  const sdk = new NorwayOpenData({
    applicationName,
    contactEmail,
    retries: 1,
    cache: { enabled: true },
  });

  it("reads one Brreg entity", async () => {
    const response = await sdk.companies.get("923609016");
    expect(response.data.organizationNumber).toBe("923609016");
  });

  it("reads one address and place-name page", async () => {
    const address = await sdk.addresses.search({
      query: "Haraldsgata 100",
      municipalityCode: "1106",
      limit: 1,
    });
    const place = await sdk.places.search({ query: "Oslo", limit: 1 });
    expect(address.data.items.length).toBeGreaterThan(0);
    expect(place.data.items.length).toBeGreaterThan(0);
  });

  it("reads SSB metadata without extracting a large table", async () => {
    const response = await sdk.statistics.getTableMetadata("07459");
    expect(response.data.dimensions.length).toBeGreaterThan(0);
  });

  it("uses the identified Entur geocoder", async () => {
    const response = await sdk.transport.autocomplete({ text: "Oslo S", limit: 1 });
    expect(response.data.length).toBeGreaterThan(0);
  });

  it("uses current Entur departure and journey GraphQL contracts", async () => {
    const departures = await sdk.transport.departures({
      stopPlaceId: "NSR:StopPlace:548",
      limit: 1,
    });
    const journeys = await sdk.transport.journeys({
      from: { placeId: "NSR:StopPlace:548" },
      to: { placeId: "NSR:StopPlace:297" },
      limit: 1,
    });
    expect(Array.isArray(departures.data)).toBe(true);
    expect(Array.isArray(journeys.data)).toBe(true);
  });

  it.skipIf(contactEmail === undefined)("uses identified MET Locationforecast", async () => {
    const response = await sdk.weather.current({ latitude: 59.4138, longitude: 5.268 });
    expect(response.data?.time).toBeTruthy();
  });

  it("searches the Data.norge catalogue with a bounded result page", async () => {
    const response = await sdk.catalog.search({
      query: "transport",
      type: ["dataset"],
      page: 0,
      size: 1,
    });
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.data.items.length).toBeLessThanOrEqual(1);
  });

  it("reads the latest official EUR/NOK exchange-rate observation", async () => {
    const response = await sdk.currency.getExchangeRate({ from: "EUR", to: "NOK" });
    expect(response.data.baseCurrency).toBe("EUR");
    expect(response.data.quoteCurrency).toBe("NOK");
    expect(response.data.value).toBeGreaterThan(0);
  });

  it("reads the parties currently represented at Stortinget", async () => {
    const response = await sdk.parliament.getParties();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0]?.id).toBeTruthy();
  });

  it("reads one small public NVDB road-object type", async () => {
    const response = await sdk.roads.getRoadObjectType(105);
    expect(response.data.id).toBe(105);
    expect(response.data.name).toBeTruthy();
  });

  it("reads NVE's latest open reservoir statistics", async () => {
    const response = await sdk.energy.getReservoirStatistics();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0]?.fillLevel).toBeTypeOf("number");
  });
});
