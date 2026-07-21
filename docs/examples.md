# Examples

The files in [`examples/`](../examples/) use the package exactly as an installed consumer would.
After building locally, run one with a TypeScript runner such as `tsx`, or copy one of the
self-contained snippets below into your own Node.js 22+ project.

## Company and sub-entity

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const company = await norway.companies.get("923 609 016");
const subEntity = await norway.companies.getSubEntity("973861883");
const matches = await norway.companies.search({
  name: "Eksempel",
  municipalityCode: "1106",
  page: 0,
  size: 20,
});

console.log(company.data.name);
console.log(subEntity.data.name);
console.log(matches.data.items.length);
```

## Addresses and place names

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const addresses = await norway.addresses.search({
  query: "Haraldsgata 100",
  municipalityCode: "1106",
});

const places = await norway.places.search({ query: "Preikestolen", limit: 5 });
const nearby = await norway.places.nearby({
  latitude: 58.9865,
  longitude: 6.1904,
  radiusMeters: 1_000,
});

console.log(addresses.data.items.length);
console.log(places.data.items.length);
console.log(nearby.data.items.length);
```

## Cross-provider profiles

Profiles compose already validated source responses. Company profiles combine Brønnøysundregistrene
with a deterministic Kartverket address match. Address profiles begin with Kartverket and can add
MET conditions, NVE warning discovery and nearby NVDB road segments:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "acme-location-dashboard",
  contactEmail: "open-data@acme.example",
});

const company = await norway.profiles.company("923609016");
const address = await norway.profiles.address("Haraldsgata 100, Haugesund");

console.log(company.data.location);
console.log(address.data.address);
console.log(address.data.weather);
console.log(address.data.hazards);
console.log(address.data.roads);
```

Weather and roads are omitted when their required caller identification is unavailable. Hazard
matching is also intentionally best-effort: NVE warning regions do not map one-to-one to address
municipalities or counties. An empty `address.data.hazards` array is never an all-clear. For any
safety decision, query the complete official Varsom/NVE warnings directly and follow their current
guidance.

## Statistics

SSB value codes are table-specific. Fetch metadata before constructing a dynamic query:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const metadata = await norway.statistics.getTableMetadata("07459");
console.log(metadata.data.dimensions);

const population = await norway.statistics.query({
  tableId: "07459",
  language: "en",
  selections: {
    Region: ["1106"],
    Kjonn: ["1"],
    Alder: ["000"],
    ContentsCode: ["Personer1"],
    Tid: ["top(1)"],
  },
});

console.table(population.data.rows);
```

SSB currently caps one extraction at 800,000 cells and rate-limits to 30 queries per minute. The
SDK validates explicit values but sends provider expressions such as `*`, `top(3)`, and `from(2020)`
through unchanged.

## Transport and weather

Entur requires `applicationName`. MET Norway requires both identity fields:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "acme-mobility-dashboard",
  contactEmail: "open-data@acme.example",
});

const departures = await norway.transport.departures({
  stopPlaceId: "NSR:StopPlace:548",
  limit: 10,
});

const forecast = await norway.weather.forecast({
  latitude: 59.4138,
  longitude: 5.268,
});

console.log(departures.data.length);
console.log(forecast.data.timeseries.length);
```

## Data.norge catalogue

Catalogue search is anonymous. Search results describe resources; they do not make every result
openly reusable, so inspect `accessRights` and `license` before using the underlying data:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const results = await norway.catalog.search({
  query: "befolkning",
  type: ["dataset"],
  publisher: "971526920",
  accessRights: "PUBLIC",
  page: 0,
  size: 5,
});

const first = results.data.items[0];
if (first !== undefined) {
  const dataset = await norway.catalog.getDataset(first.id);
  console.log(dataset.data.title, dataset.data.license);
}

const publisher = await norway.catalog.getPublisher("971526920");
console.log(publisher.data.name);
```

Use `catalog.getDataService(id)` for a `data-service` search hit. Data.norge labels its Search API
as internal and changeable; direct dataset and data-service lookups use the stable Resource Service.
A multi-type search makes one provider request per requested type and combines those results
locally. Combined paging is bounded to the first 100 positions of the type-ordered combined result;
request one type when deeper provider paging is needed.

## Auto-paginating iterators

Five list APIs provide async iterators. They fetch the next numbered page or opaque continuation
marker only when iteration advances:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ applicationName: "acme-bounded-export" });
const bounds = { maxItems: 50, maxPages: 5 };

const companies = norway.companies.searchAll({ municipalityCode: "1106" }, bounds);
const datasets = norway.catalog.searchAll({ query: "transport", type: ["dataset"] }, bounds);
const cases = norway.parliament.searchCasesAll({ sessionId: "2025-2026" }, bounds);
const roadObjects = norway.roads.searchRoadObjectsAll({ typeId: 105 }, bounds);
const roadSegments = norway.roads.getRoadNetworkAll({}, bounds);

for await (const company of companies) {
  console.log(company.organizationNumber, company.name);
}

void datasets;
void cases;
void roadObjects;
void roadSegments;
```

All five iterators accept the normal request options together with `maxItems` and `maxPages`.
`maxItems` must be a non-negative integer. `maxPages` must be an integer from 1 to 100 and defaults
to 100; set explicit bounds for batch jobs. Data.norge multi-type searches keep their 100-position
combined-window limit, and NVDB continuation markers remain opaque.

## Currency and interest rates

Norges Bank access is anonymous. With no date or range, `getExchangeRate()` returns the latest
published business-day observation:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const latestEur = await norway.currency.getExchangeRate({
  from: "EUR",
  to: "NOK",
});
const eurHistory = await norway.currency.getExchangeRates({
  from: "EUR",
  to: "NOK",
  startDate: "2025-01-06",
  endDate: "2025-01-10",
});
const policyRate = await norway.currency.getPolicyRate({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
});
const nowa = await norway.currency.getNowa({
  startDate: "2025-01-01",
  endDate: "2025-01-31",
});

console.log(latestEur.data.value, latestEur.data.seriesId);
console.table(eurHistory.data);
console.log(policyRate.data.at(-1), nowa.data.at(-1));
```

An exact `date` with no published observation raises `NotFoundError`. Historical arrays omit
weekends, holidays, and other missing dates; the SDK never moves or interpolates a rate. For a
non-NOK currency pair, it cross-calculates only dates shared by both official NOK series and retains
their identifiers in `sourceSeriesIds`. An unbounded latest cross request examines the last 10
observations per series; provide a range when an older common date may be required.

## Third-party electricity spot prices

The `electricity` namespace uses Hva koster strømmen?, an independent third-party public API rather
than a government endpoint. Its API page says it fetches electricity prices from ENTSO-E in EUR and
converts them to NOK with the latest Norges Bank exchange rate:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const day = await norway.electricity.getPrices({ area: "NO1", date: "2026-07-21" });
const current = await norway.electricity.getCurrentPrice({ area: "NO5" });

console.table(day.data);
console.log(current.data?.nokPerKwh);
```

Values exclude grid rent, taxes and supplier surcharges. The provider warns that its converted NOK
values can differ from official NOK market publications and asks public users to cite
hvakosterstrommen.no. Next-day data normally appears in the early afternoon; requesting an
unpublished date raises `NotFoundError`.

## Parliament

Stortinget's exports are anonymous. Omitting a period or session asks the provider for its current
export:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const representatives = await norway.parliament.getRepresentatives({
  periodId: "2025-2029",
  includeDeputies: false,
});
const parties = await norway.parliament.getParties({ sessionId: "2025-2026" });
const cases = await norway.parliament.searchCases({
  sessionId: "2025-2026",
  query: "jernbane",
  page: 0,
  size: 10,
});
const questions = await norway.parliament.getQuestions({
  sessionId: "2025-2026",
  category: "written",
  status: "alle",
});
const meetings = await norway.parliament.getMeetings({ sessionId: "2025-2026" });

const firstRepresentative = representatives.data[0];
if (firstRepresentative !== undefined) {
  const representative = await norway.parliament.getRepresentative(firstRepresentative.id);
  console.log(representative.data.fullName);
}

const firstCase = cases.data.items[0];
if (firstCase !== undefined) {
  const [caseDetails, votes] = await Promise.all([
    norway.parliament.getCase(firstCase.id),
    norway.parliament.getVotes(firstCase.id),
  ]);
  console.log(caseDetails.data.title, votes.data.length);
}

console.log(parties.data.length, questions.data.length, meetings.data.length);
```

`searchCases()` fetches one complete official session export and applies text/status/type filters
and bounded pagination locally because Stortinget provides no server-side case pagination. The
returned pagination describes that locally filtered result.

## Roads and NVDB

Public NVDB reads do not need an API key, but Statens vegvesen requires a meaningful `X-Client`
identifier. The SDK takes it from `applicationName`:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ applicationName: "acme-road-map" });
const types = await norway.roads.getRoadObjectTypes();
const speedLimitType = await norway.roads.getRoadObjectType(105);
const firstPage = await norway.roads.searchRoadObjects({
  typeId: 105,
  municipalityCode: "1103",
  boundingBox: [5.55, 58.85, 5.85, 59.05],
  pageSize: 10,
});
const roadNetwork = await norway.roads.getRoadNetwork({
  municipalityCode: "1103",
  roadCategory: ["E", "R", "F"],
  pageSize: 10,
});

const firstObject = firstPage.data.items[0];
if (firstObject !== undefined) {
  const object = await norway.roads.getRoadObject(firstObject.typeId, firstObject.id);
  console.log(object.data.properties);
}

const nextStart = firstPage.data.pagination.nextStart;
if (nextStart !== undefined) {
  const nextPage = await norway.roads.searchRoadObjects({
    typeId: 105,
    municipalityCode: "1103",
    boundingBox: [5.55, 58.85, 5.85, 59.05],
    pageSize: 10,
    start: nextStart,
  });
  console.log(nextPage.data.items.length);
}

console.log(types.data.length, speedLimitType.data.name, roadNetwork.data.items.length);
```

Continuation markers are opaque and belong to the original query. Dynamic property values remain
`unknown`; use the corresponding type metadata before narrowing them. Sensitive types and
properties that require authentication or special rights are outside the SDK.

## NVE energy

Reservoir and operational power-plant methods are anonymous:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const [reservoirs, powerPlants] = await Promise.all([
  norway.energy.getReservoirStatistics(),
  norway.energy.getPowerPlants(),
]);

console.log(reservoirs.data[0]);
console.log(powerPlants.data.filter((plant) => plant.type === "hydropower").length);
```

Use `energy.getHydropowerPlants()` or `energy.getWindPowerPlants()` when only one plant category is
needed. Reservoir statistics represent NVE's latest published week, while plant methods return
records currently marked as operational.

## NVE hazards and hydrology

Flood, avalanche, and landslide warnings are anonymous. Hydrology stations and observations are a
separate boundary and require a free HydAPI key:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const apiKey = process.env.NVE_HYDAPI_KEY;
const norway = new NorwayOpenData({
  credentials: {
    nve: apiKey === undefined ? {} : { apiKey },
  },
});

const [flood, avalanche, landslide] = await Promise.all([
  norway.hazards.getFloodWarnings({ language: "en" }),
  norway.hazards.getAvalancheWarnings({ language: "en" }),
  norway.hazards.getLandslideWarnings({ language: "en" }),
]);
console.log(flood.data.length, avalanche.data.length, landslide.data.length);

if (apiKey !== undefined) {
  const stations = await norway.hazards.getHydrologyStations({
    stationId: "6.10.0",
    active: true,
  });
  const observations = await norway.hazards.getHydrologyObservations({
    stationId: "6.10.0",
    parameter: "1000",
    resolutionTime: "1440",
    startDate: "2025-01-01",
    endDate: "2025-01-07",
  });
  console.log(stations.data[0], observations.data.at(-1));
}
```

Without `credentials.nve.apiKey`, only the two HydAPI methods throw `ConfigurationError`; open NVE
methods still work. Warnings are regional planning aids and must be presented with the provider's
full safety context and attribution. Pass `{ includeRaw: true }` as the second argument and use the
complete provider payload when building a public warning display.

## Raw provider data

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const response = await norway.companies.get("923609016", { includeRaw: true });
console.log(response.raw);
```

`raw` is omitted by default so applications do not accidentally depend on an undocumented
provider field. It is still privacy-filtered where a provider response contains unsupported
personal or sensitive metadata.
