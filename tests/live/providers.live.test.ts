import { describe, expect, it } from "vitest";

import { NorwayOpenData } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe : describe.skip;

function optionalEnvironmentValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

const applicationName = optionalEnvironmentValue("NORWAY_OPEN_DATA_APPLICATION_NAME");
const contactEmail = optionalEnvironmentValue("NORWAY_OPEN_DATA_CONTACT_EMAIL");
const nveApiKey = optionalEnvironmentValue("NVE_HYDAPI_KEY");

const noMetIdentity = applicationName === undefined || contactEmail === undefined;
const noRoadIdentity = applicationName === undefined;
const noHydApiKey = nveApiKey === undefined;

const sdk = new NorwayOpenData({
  applicationName,
  contactEmail,
  retries: 1,
  timeoutMs: 20_000,
  cache: { enabled: true },
  ...(nveApiKey === undefined ? {} : { credentials: { nve: { apiKey: nveApiKey } } }),
});

async function takeOne<T>(source: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of source) {
    items.push(item);
    break;
  }
  return items;
}

live("Brønnøysundregistrene — companies", () => {
  it("gets one entity", async () => {
    const response = await sdk.companies.get("923609016");
    expect(response.data.organizationNumber).toBe("923609016");
    expect(response.data.name).toBeTruthy();
  });

  it("searches entities with bounded paging", async () => {
    const response = await sdk.companies.search({ name: "Equinor", size: 5 });
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.data.items.length).toBeLessThanOrEqual(5);
    expect(response.data.pagination.size).toBeLessThanOrEqual(5);
  });

  it("gets one sub-entity discovered from the public register", async () => {
    const listing = await fetch("https://data.brreg.no/enhetsregisteret/api/underenheter?size=1", {
      headers: { Accept: "application/json" },
    });
    const body = (await listing.json()) as {
      _embedded?: { underenheter?: Array<{ organisasjonsnummer?: string }> };
    };
    const number = body._embedded?.underenheter?.[0]?.organisasjonsnummer;
    expect(number).toBeTruthy();
    const response = await sdk.companies.getSubEntity(String(number));
    expect(response.data.organizationNumber).toBe(number);
  });
});

live("Kartverket — addresses and places", () => {
  it("searches addresses", async () => {
    const response = await sdk.addresses.search({
      query: "Haraldsgata 100",
      municipalityCode: "1106",
      limit: 1,
    });
    expect(response.data.items.length).toBeGreaterThan(0);
  });

  it("searches place names", async () => {
    const response = await sdk.places.search({ query: "Oslo", limit: 1 });
    expect(response.data.items.length).toBeGreaterThan(0);
  });

  it("finds place names near a coordinate", async () => {
    const response = await sdk.places.nearby({
      latitude: 59.91,
      longitude: 10.75,
      radiusMeters: 1_000,
    });
    expect(Array.isArray(response.data.items)).toBe(true);
  });
});

live("SSB — statistics", () => {
  it("reads table metadata", async () => {
    const response = await sdk.statistics.getTableMetadata("07459");
    expect(response.data.dimensions.length).toBeGreaterThan(0);
  });

  it("runs a bounded single-cell query and its raw variant", async () => {
    const metadata = await sdk.statistics.getTableMetadata("07459");
    const selections: Record<string, string[]> = {};
    for (const dimension of metadata.data.dimensions) {
      const first = dimension.values[0]?.code;
      if (first !== undefined) selections[dimension.code] = [first];
    }
    const result = await sdk.statistics.query({ tableId: "07459", selections });
    expect(result.data.rows).toHaveLength(1);

    const raw = await sdk.statistics.queryRaw({ tableId: "07459", selections });
    expect(raw.data.version).toBe("2.0");
  });
});

live("FHI — health statistics", () => {
  it("discovers sources and tables, then reads metadata and dimensions", async () => {
    const sources = await sdk.health.getSources();
    expect(sources.data.length).toBeGreaterThan(0);
    expect(sources.data.some((source) => source.id === "daar")).toBe(true);

    const tables = await sdk.health.getTables("daar");
    expect(tables.data.length).toBeGreaterThan(0);
    const tableId = tables.data[0]?.tableId;
    expect(tableId).toBeDefined();
    if (tableId === undefined) return;

    const metadata = await sdk.health.getTableMetadata("daar", tableId);
    expect(metadata.data.name.length).toBeGreaterThan(0);

    const dimensions = await sdk.health.getTableDimensions("daar", tableId);
    expect(dimensions.data.dimensions.length).toBeGreaterThan(0);
  });

  it("runs a bounded query and preserves provider flags with their legend", async () => {
    const dimensions = await sdk.health.getTableDimensions("daar", 754);
    const selections: Record<string, string[]> = {};
    for (const dimension of dimensions.data.dimensions) {
      const first = dimension.values[0]?.code;
      if (first !== undefined) selections[dimension.code] = [first];
    }
    const result = await sdk.health.query({ source: "daar", tableId: 754, selections });
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0]).toHaveProperty("value");

    // Flag preservation: municipality-level reading skills include anonymized
    // cells for the smallest municipalities.
    const flagDimensions = await sdk.health.getTableDimensions("nokkel", 670);
    const flagSelections: Record<string, string[]> = {};
    for (const dimension of flagDimensions.data.dimensions) {
      flagSelections[dimension.code] =
        dimension.code === "GEO" ? ["*"] : [dimension.values[0]?.code ?? ""];
    }
    const flagged = await sdk.health.query({
      source: "nokkel",
      tableId: 670,
      selections: flagSelections,
    });
    expect(flagged.data.rows.length).toBeGreaterThan(300);
    const flaggedRows = flagged.data.rows.filter((row) => row.flag !== undefined);
    expect(flaggedRows.length).toBeGreaterThan(0);
    for (const row of flaggedRows) {
      expect(row.value).toBeNull();
      expect(flagged.data.flags[row.flag ?? ""]).toBeDefined();
    }
  });
});

live("Entur — transport", () => {
  it("uses the identified geocoder", async () => {
    const response = await sdk.transport.autocomplete({ text: "Oslo S", limit: 1 });
    expect(response.data.length).toBeGreaterThan(0);
  });

  it("uses current departure and journey GraphQL contracts", async () => {
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
});

live("MET Norway — weather", () => {
  it.skipIf(noMetIdentity)("reads a full forecast and its current entry", async () => {
    const forecast = await sdk.weather.forecast({ latitude: 59.4138, longitude: 5.268 });
    expect(forecast.data.timeseries.length).toBeGreaterThan(0);

    const current = await sdk.weather.current({ latitude: 59.4138, longitude: 5.268 });
    expect(current.data?.time).toBeTruthy();
  });
});

live("Cross-provider — profiles", () => {
  it("composes an address profile from Kartverket, MET, NVE and NVDB", async () => {
    const response = await sdk.profiles.address("Haraldsgata 100, Haugesund");
    expect(response.data.address.municipalityName).toBeTruthy();
    expect(Array.isArray(response.data.hazards)).toBe(true);
    const components = response.data.components ?? [];
    expect(components).toHaveLength(6);

    if (noMetIdentity) {
      expect(response.data.weather).toBeUndefined();
      expect(components.find(({ operation }) => operation === "weather.current")).toMatchObject({
        status: "omitted",
        reason: "not-configured",
      });
    } else {
      expect(response.data.weather?.time).toBeTruthy();
      expect(components.find(({ operation }) => operation === "weather.current")).toMatchObject({
        status: "available",
      });
    }

    if (noRoadIdentity) {
      expect(response.data.roads).toBeUndefined();
      expect(
        components.find(({ operation }) => operation === "roads.getRoadNetwork"),
      ).toMatchObject({ status: "omitted", reason: "not-configured" });
    } else {
      expect(Array.isArray(response.data.roads)).toBe(true);
      expect(
        components.find(({ operation }) => operation === "roads.getRoadNetwork"),
      ).toMatchObject({ status: "available" });
    }

    for (const [operation, attribution] of [
      ["hazards.getFloodWarnings", "Varsler fra Flomvarslingen i Norge og www.varsom.no"],
      ["hazards.getAvalancheWarnings", "Varsler fra Snøskredvarslingen i Norge og www.varsom.no"],
      ["hazards.getLandslideWarnings", "Varsler fra Jordskredvarslingen i Norge og www.varsom.no"],
    ] as const) {
      expect(components.find((component) => component.operation === operation)).toMatchObject({
        status: "available",
        source: { attribution },
      });
    }
  });

  it("composes a company profile from Brreg and Kartverket", async () => {
    const response = await sdk.profiles.company("923609016");
    expect(response.data.company.organizationNumber).toBe("923609016");
    if (response.data.location !== undefined) {
      expect(response.data.location.address).toBeDefined();
    }
  });

  it("composes a municipality profile from SSB, FHI, Brreg and NVE", async () => {
    const response = await sdk.profiles.municipality("Haugesund");
    expect(response.data.municipality).toMatchObject({
      code: "1106",
      name: "Haugesund",
      countyCode: "11",
    });
    expect(response.data.population?.total).toBeGreaterThan(0);
    expect(typeof response.data.companies?.registered).toBe("number");
    expect(Array.isArray(response.data.hazards)).toBe(true);

    const components = response.data.components ?? [];
    expect(components).toHaveLength(7);
    expect(components.every((component) => component.status === "available")).toBe(true);

    // Life expectancy is present as a value or an explicitly flagged suppression.
    const life = response.data.lifeExpectancy;
    expect(life).toBeDefined();
    if (life?.years === null) {
      expect(life.flag).toBeTruthy();
    } else {
      expect(life?.years).toBeGreaterThan(0);
    }

    // A tiny municipality reliably suppresses its life-expectancy value.
    const utsira = await sdk.profiles.municipality("1151");
    expect(utsira.data.lifeExpectancy?.years).toBeNull();
    expect(utsira.data.lifeExpectancy?.flag).toBeTruthy();
    expect(utsira.data.lifeExpectancy?.flagMeaning).toBeTruthy();
  });
});

live("Data.norge — catalog", () => {
  it("searches the catalogue with a bounded page", async () => {
    const response = await sdk.catalog.search({
      query: "transport",
      type: ["dataset"],
      page: 0,
      size: 1,
    });
    expect(response.data.items.length).toBeGreaterThan(0);
    expect(response.data.items.length).toBeLessThanOrEqual(1);
  });

  it("resolves a dataset discovered from search", async () => {
    const search = await sdk.catalog.search({ query: "data", type: ["dataset"], page: 0, size: 1 });
    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();
    const dataset = await sdk.catalog.getDataset(String(id));
    expect(dataset.data.id).toBe(id);
  });

  it("resolves a data service discovered from search", async () => {
    const search = await sdk.catalog.search({
      query: "api",
      type: ["data-service"],
      page: 0,
      size: 1,
    });
    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();
    const service = await sdk.catalog.getDataService(String(id));
    expect(service.data.id).toBe(id);
  });

  it("resolves a publisher by organization number", async () => {
    const response = await sdk.catalog.getPublisher("991825827");
    expect(response.data.id).toBe("991825827");
  });
});

live("Norges Bank — currency", () => {
  it("reads the latest EUR/NOK observation", async () => {
    const response = await sdk.currency.getExchangeRate({ from: "EUR", to: "NOK" });
    expect(response.data.baseCurrency).toBe("EUR");
    expect(response.data.quoteCurrency).toBe("NOK");
    expect(response.data.value).toBeGreaterThan(0);
  });

  it("reads a bounded exchange-rate series", async () => {
    const response = await sdk.currency.getExchangeRates({ from: "USD", to: "NOK" });
    expect(Array.isArray(response.data)).toBe(true);
  });

  it("reads the policy rate and Nowa series", async () => {
    const policy = await sdk.currency.getPolicyRate();
    const nowa = await sdk.currency.getNowa();
    expect(Array.isArray(policy.data)).toBe(true);
    expect(Array.isArray(nowa.data)).toBe(true);
  });
});

live("Stortinget — parliament", () => {
  it("reads the currently represented parties", async () => {
    const response = await sdk.parliament.getParties();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0]?.id).toBeTruthy();
  });

  it("reads representatives and resolves one by id", async () => {
    const list = await sdk.parliament.getRepresentatives();
    expect(list.data.length).toBeGreaterThan(0);
    const id = list.data[0]?.id;
    expect(id).toBeTruthy();
    const single = await sdk.parliament.getRepresentative(String(id));
    expect(single.data.id).toBe(id);
  });

  it("searches cases and resolves one case with its votes", async () => {
    const search = await sdk.parliament.searchCases({ page: 0, size: 1 });
    expect(search.data.items.length).toBeGreaterThan(0);
    const id = search.data.items[0]?.id;
    expect(id).toBeTruthy();

    const single = await sdk.parliament.getCase(String(id));
    expect(single.data.id).toBe(id);

    const votes = await sdk.parliament.getVotes(String(id));
    expect(Array.isArray(votes.data)).toBe(true);
  });

  it("reads questions and meetings for the current session", async () => {
    const questions = await sdk.parliament.getQuestions();
    const meetings = await sdk.parliament.getMeetings();
    expect(Array.isArray(questions.data)).toBe(true);
    expect(Array.isArray(meetings.data)).toBe(true);
  });
});

live("Statens vegvesen — roads", () => {
  it("lists public road-object types and reads one", async () => {
    const types = await sdk.roads.getRoadObjectTypes();
    expect(types.data.length).toBeGreaterThan(0);

    const single = await sdk.roads.getRoadObjectType(105);
    expect(single.data.id).toBe(105);
    expect(single.data.name).toBeTruthy();
  });

  it("searches road objects and resolves one by id", async () => {
    const search = await sdk.roads.searchRoadObjects({
      typeId: 105,
      municipalityCode: "1103",
      pageSize: 1,
    });
    expect(Array.isArray(search.data.items)).toBe(true);
    const first = search.data.items[0];
    if (first !== undefined) {
      const single = await sdk.roads.getRoadObject(105, first.id);
      expect(single.data.id).toBe(first.id);
    }
  });

  it("reads a bounded road-network page", async () => {
    const response = await sdk.roads.getRoadNetwork({
      municipalityCode: "1103",
      pageSize: 1,
    });
    expect(Array.isArray(response.data.items)).toBe(true);
  });
});

live("Hva koster strømmen? — electricity", () => {
  it("reads today's hourly spot prices and the current hour", async () => {
    const prices = await sdk.electricity.getPrices({ area: "NO1" });
    expect(prices.data.length).toBeGreaterThanOrEqual(23);
    expect(prices.data[0]?.area).toBe("NO1");
    expect(prices.data[0]?.exchangeRate).toBeGreaterThan(0);

    const current = await sdk.electricity.getCurrentPrice({ area: "NO5" });
    expect(current.data?.nokPerKwh).toBeTypeOf("number");
  });
});

live("NVE — energy", () => {
  it("reads the latest open reservoir statistics", async () => {
    const response = await sdk.energy.getReservoirStatistics();
    expect(response.data.length).toBeGreaterThan(0);
    expect(response.data[0]?.fillLevel).toBeTypeOf("number");
  });

  it("reads hydropower, wind-power, and combined plant listings", async () => {
    const hydro = await sdk.energy.getHydropowerPlants();
    const wind = await sdk.energy.getWindPowerPlants();
    const all = await sdk.energy.getPowerPlants();
    expect(hydro.data.length).toBeGreaterThan(0);
    expect(wind.data.length).toBeGreaterThan(0);
    expect(all.data.length).toBeGreaterThanOrEqual(hydro.data.length);
  });
});

live("NVE — hazards", () => {
  it("reads flood, avalanche, and landslide warnings", async () => {
    const flood = await sdk.hazards.getFloodWarnings();
    const avalanche = await sdk.hazards.getAvalancheWarnings();
    const landslide = await sdk.hazards.getLandslideWarnings();
    expect(Array.isArray(flood.data)).toBe(true);
    expect(Array.isArray(avalanche.data)).toBe(true);
    expect(Array.isArray(landslide.data)).toBe(true);
  });

  it.skipIf(noHydApiKey)("reads HydAPI stations and one observation series", async () => {
    const stations = await sdk.hazards.getHydrologyStations({ active: true });
    expect(stations.data.length).toBeGreaterThan(0);
    const stationId = stations.data[0]?.id;
    expect(stationId).toBeTruthy();

    const observations = await sdk.hazards.getHydrologyObservations({
      stationId: String(stationId),
      parameter: "1000",
      resolutionTime: "day",
    });
    expect(Array.isArray(observations.data)).toBe(true);
  });
});

live("Auto-pagination — bounded iterators", () => {
  it("probes all page-number iterators with one item and one page", async () => {
    const companies = await takeOne(
      sdk.companies.searchAll({ name: "Equinor", size: 5 }, { maxItems: 1, maxPages: 1 }),
    );
    const catalog = await takeOne(
      sdk.catalog.searchAll(
        { query: "transport", type: ["dataset"], page: 0, size: 1 },
        { maxItems: 1, maxPages: 1 },
      ),
    );
    const cases = await takeOne(
      sdk.parliament.searchCasesAll({ page: 0, size: 1 }, { maxItems: 1, maxPages: 1 }),
    );

    expect(companies).toHaveLength(1);
    expect(catalog).toHaveLength(1);
    expect(cases).toHaveLength(1);
  });

  it("probes both NVDB cursor iterators with one item and one page", async () => {
    const objects = await takeOne(
      sdk.roads.searchRoadObjectsAll(
        { typeId: 105, municipalityCode: "1103", pageSize: 1 },
        { maxItems: 1, maxPages: 1 },
      ),
    );
    const network = await takeOne(
      sdk.roads.getRoadNetworkAll(
        { municipalityCode: "1103", pageSize: 1 },
        { maxItems: 1, maxPages: 1 },
      ),
    );

    expect(objects.length).toBeLessThanOrEqual(1);
    expect(network.length).toBeLessThanOrEqual(1);
  });
});
