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
MET conditions, exact NVE administrative-area warning matches and first-page NVDB bounding-box
candidates:

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
console.log(address.data.hazardMatches);
console.log(address.data.roads);
console.log(address.data.roadSearch);

for (const component of address.data.components ?? []) {
  if (component.status === "available") {
    console.log(component.operation, component.source.name, component.cached);
  } else {
    console.log(component.operation, component.reason);
  }
}
```

`components` distinguishes a successful (possibly empty) operation from an omitted one. Available
entries carry `source`, `retrievedAt` and `cached`; `retrievedAt` is when the SDK operation resolved,
including cache hits, rather than the original upstream fetch time. Omitted entries carry
`not-configured`, `missing-coordinate`, `not-applicable` or `provider-error`; the last means the
operation was attempted but its provider failed, and the component then carries a sanitized `error`.
Sources include provider attribution text, with service-specific wording for each Varsom warning
feed.

Municipality profiles answer one kommune from SSB, FHI, Brønnøysundregistrene and NVE at once:

```ts
const kommune = await norway.profiles.municipality("Haugesund"); // or the code "1106"

console.log(kommune.data.municipality); // { code, name, countyCode }
console.log(kommune.data.population); // SDK-summed residents for the two newest years
console.log(kommune.data.lifeExpectancy); // FHI value, or years: null with a suppression flag
console.log(kommune.data.companies?.registered); // Brønnøysundregistrene organization count
console.log(kommune.data.hazards); // Exact NVE warning matches for the municipality
```

The lookup accepts a four-digit municipality code or an exact municipality name. Counties and the
whole-country region never resolve, and duplicated municipality names (Herøy) require SSB's
county-qualified label, so a profile never silently resolves to the wrong kommune. Population totals
are aggregated by the SDK from SSB's per-sex, per-age rows rather than published directly, and life
expectancy preserves FHI's suppression flag for small municipalities. Each optional section degrades
to a `provider-error` component when its provider fails.

Automatic hazard matching checks an explicit municipality by official code, then exact
case-insensitive, Unicode-normalized name. It checks a county only when the warning has no
municipality list, because a county can be parent context. It never substring-matches a
forecast-region name. `hazardMatches` reports the exact basis and area values. An empty
`address.data.hazards` array is never an all-clear; query the complete official Varsom/NVE warnings
directly for safety decisions.

`roads` is not a radius-filtered result. It contains the first NVDB page intersecting the WGS84
box in `roadSearch`, whose `halfSizeMetres` is approximately 250 by default. Use its exact
`boundingBox`, `requestedPageSize` and `truncated` flag when interpreting completeness.

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

## Health statistics

FHI table and dimension codes are source-specific. Discover them first, then query:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const sources = await norway.health.getSources();
console.log(sources.data.map((source) => source.id)); // ["abr", "daar", "nokkel", ...]

const tables = await norway.health.getTables("daar");
const dimensions = await norway.health.getTableDimensions("daar", 754);

const rates = await norway.health.query({
  source: "daar",
  tableId: 754,
  selections: {
    DAAR: ["2020", "2021"],
    KJONN: ["Total"],
    HJERTEKAR: ["Total"],
    MEASURE_TYPE: ["RATE_NO"],
  },
});
console.table(rates.data.rows);
```

A selection of `["*"]` selects every category of that dimension, including nested child
categories. Suppressed cells are preserved, not hidden: a flagged row has `value: null` and a
`flag` symbol, and `rates.data.flags` maps each symbol to FHI's own explanation (for example `":"`
is "Anonymisert eller skjult av andre årsaker"). Keep flagged observations suppressed downstream.

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
combined-window limit, and NVDB continuation markers remain opaque. If a cursor-based provider
repeats a marker or returns a cycle, the iterator raises `ResponseValidationError` before requesting
the already-seen page again.

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
const day = await norway.electricity.getPrices(
  { area: "NO1", date: "2026-07-21" },
  { includeRaw: true },
);
const current = await norway.electricity.getCurrentPrice({ area: "NO5" });

console.table(day.data);
console.log(current.data?.nokPerKwh);
```

Values exclude grid rent, taxes and supplier surcharges. The provider warns that its converted NOK
values can differ from official NOK market publications and asks public users to cite
hvakosterstrommen.no. Next-day data normally appears in the early afternoon; requesting an
unpublished date raises `NotFoundError`.

The SDK validates the ordered elapsed-hour starts for the requested Europe/Oslo calendar day. The
result therefore contains 24 entries normally, 23 when the spring clock skips an hour, and 25 when
the autumn hour repeats. Each normalized `endsAt` is the next chronological `startsAt`, or the
following local midnight for the final entry. `day.raw` retains provider-native timestamps.

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
console.log(flood.data[0]?.forecastRegion); // Context only
console.log(flood.data[0]?.counties); // Structured administrative areas
console.log(flood.data[0]?.municipalities);

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
full safety context and attribution. `forecastRegion`, `counties`, and `municipalities` stay
separate; the flattened `regions` list remains for backwards compatibility, not administrative
matching. Pass `{ includeRaw: true }` as the second argument and use the complete provider payload
when building a public warning display.

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
