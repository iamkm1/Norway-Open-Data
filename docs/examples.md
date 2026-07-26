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
feed. A profile's top-level `source` is a synthetic descriptor for the SDK composition; inspect
`sources` for the distinct real provider descriptors derived from successful components and
`components` for operation-level provenance. Separate descriptors are retained when feeds from one
provider have different licence or mandatory attribution text.

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

The profile has no historical date context and therefore never guesses a successor for an inactive
code. Resolve it first with `klass.resolveMunicipalityCode()`. An application may automatically
continue only for an `unchanged`, `renamed` or one-to-one `replaced` result with exactly one match.
Merge, split and ambiguous results require an explicit policy, and successor statistics are never
combined by the SDK.

The experimental nature profile asks Naturbase, NIBIO and Kartverket about one WGS84 point. Each
dataset is bounded independently and a provider failure removes only its own section:

```ts
const nature = await norway.profiles.natureAtLocation({
  latitude: 61.494,
  longitude: 8.349,
  limit: 25,
});

console.log(nature.data.municipality); // inferred from the nearest official place, when available
console.log(nature.data.protectedAreas);
console.log(nature.data.proposedProtectedAreas);
console.log(nature.data.natureTypes);
console.log(nature.data.interventionFreeAreas);
console.log(nature.data.landResources);
console.log(nature.data.pagination);
console.log(nature.data.warnings); // provider failures and truncation notices

for (const component of nature.data.components) {
  console.log(component.operation, component.status, component.source.attribution);
}
```

An omitted section and an empty array are different: omission means the component failed; an empty
array means the provider successfully returned no feature from that selected layer. The profile's
`sources` are derived from successful profile components and preserve the real Kartverket,
Miljødirektoratet and NIBIO attribution. Its top-level `source` remains a synthetic descriptor for
the multi-provider composition. The municipality is place-name context, not a point-in-polygon
administrative-boundary result.

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

## SSB Klass

`statistics` reads statistical values and tables from SSB PxWeb. `klass` reads the separate SSB
Klass service: official classifications, dated versions, codes and mappings.

Browse classifications and inspect their versions:

```ts
import { klassClassificationIds, NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ cache: { enabled: true } });

const classifications = await norway.klass.listClassifications({
  language: "en",
  page: 0,
  pageSize: 10,
});

const municipalityVersions = await norway.klass.listVersions({
  classificationId: klassClassificationIds.municipalities, // 131
  language: "en",
  pageSize: 20,
});
console.log(classifications.data.items, municipalityVersions.data.items);
```

List a dated industry version, match occupation code patterns, and retrieve one exact code:

```ts
const industries = await norway.klass.listCodes({
  versionId: 3218, // SIC 2025, discovered from classification 6
  language: "en",
  page: 0,
  pageSize: 25,
});

const occupations = await norway.klass.searchCodes({
  classificationId: klassClassificationIds.occupations, // 7
  codePattern: "25*",
  date: "2026-01-01",
  language: "en",
  pageSize: 10,
});

const oslo = await norway.klass.getCode({
  classificationId: klassClassificationIds.municipalities,
  code: "0301",
  date: "2026-01-01",
  language: "en",
});
console.log(industries.data.items, occupations.data.items, oslo.data);
```

`searchCodes()` uses Klass' official exact, wildcard and range code syntax. Klass provides no
server-side name search, so the SDK does not label a full local download as upstream search.
`getCode()` can alternatively take `{ versionId, code }` for an exact classification snapshot.
Translations are available as `nb`, `nn` or `en` only where the selected resource publishes them.

Resolve a historical municipality without losing merge or split branches:

```ts
const resolution = await norway.klass.resolveMunicipalityCode({
  code: "0101",
  sourceDate: "2019-01-01",
  targetDate: "2020-01-01",
  language: "en",
});

console.log(resolution.data.status); // "replaced"
console.log(resolution.data.matches); // 3001 Halden
console.log(resolution.data.predecessors, resolution.data.successors);
console.log(resolution.data.changes); // dated official evidence
console.log(resolution.source.attribution);
```

A missing `sourceDate` is accepted only when the input code itself is valid on `targetDate`;
otherwise the status is `context_required`. Results may be `merged`, `split` or `ambiguous`, and
every candidate is retained. A missing mapping is inconclusive. Administrative correspondence is
not evidence that statistics remain comparable across changing boundaries.

Inspect a fixed correspondence table:

```ts
const table = await norway.klass.getCorrespondenceTable({
  correspondenceTableId: 2774, // Municipalities 2026 → Municipalities 2024
  language: "en",
  page: 0,
  pageSize: 20,
});

console.log(table.data.sourceVersionId, table.data.targetVersionId);
console.table(table.data.items);
```

Only classification list/search responses are actually paged by Klass. Version, code, change and
correspondence payloads are downloaded and validated as provider units, then exposed as bounded SDK
pages with `pagination.upstreamPaged === false`. The service supplies no correspondence weights.
When caching is enabled, Klass metadata and tables use a 24-hour in-process default.

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

## Geonorge geospatial catalogue

`geodata` searches Geonorge's focused dataset and service catalogue separately from the broader
Data.norge catalogue. Results are metadata; a discovered URL is never requested by the SDK:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const results = await norway.geodata.searchDatasets({
  query: "verneområder",
  limit: 5,
});

const first = results.data.items[0];
if (first !== undefined) {
  const dataset = await norway.geodata.getDataset(first.id);
  console.log(dataset.data.publisher);
  console.log(dataset.data.geographicExtent);
  console.log(dataset.data.license);

  for (const distribution of dataset.data.distributions) {
    console.log(distribution.kind, distribution.protocol, distribution.url);
    // Discovery only: validate the resource's licence and access terms yourself.
  }
}

const services = await norway.geodata.searchServices({ query: "natur", limit: 5 });
console.log(services.data.items.map((service) => service.endpoint?.kind));
```

`getMetadata(id)` accepts any supported record; `getDataset(id)` and `getService(id)` additionally
verify the record's catalogue type. Detail identifies WFS, WMS, OGC API Features, ArcGIS REST and
download links while retaining the raw protocol label. It does not fetch a capability document,
render an image, download a file or turn the SDK into a proxy. Catalogue metadata does not grant
access and does not replace the underlying publisher's licence and attribution.

## Naturbase and NIBIO vector data

Caller inputs are WGS84 objects; returned GeoJSON positions are `[longitude, latitude]`. Naturbase
and NIBIO perform server-side WGS84 conversion, while `sourceCrs` retains the layer's advertised
source CRS. Unsupported CRS metadata is rejected instead of silently reinterpreted.

```ts
const point = { latitude: 61.494, longitude: 8.349 };
const box = {
  south: 61.45,
  west: 8.25,
  north: 61.55,
  east: 8.45,
};

const protectedAtPoint = await norway.environment.getProtectedAreasAt({
  ...point,
  limit: 25,
});
const protectedInBox = await norway.environment.searchProtectedAreas({
  boundingBox: box,
  limit: 100,
  pageSize: 50,
  maxPages: 3,
});
const land = await norway.land.getLandResourcesAt({ ...point, limit: 25 });

console.log(protectedAtPoint.data.features);
console.log(protectedInBox.data.pagination.truncated);
console.log(protectedInBox.data.crs, protectedInBox.data.sourceCrs);
console.log(land.data.features);
console.log(land.source.attribution);
```

The same point/search/iterator pattern is available for proposed protected areas, modern selected
NiN nature localities and the January 2023 intervention-free nature layer. Every feature result
contains paging metadata. The default `limit` is 100; set an explicit smaller limit for interactive
queries and inspect `pagination.truncated` before claiming completeness. `AbortSignal` is accepted
through the normal request options.

`land` intentionally exposes generalized AR50 only. It is not parcel-precision AR5, and restricted
Geovekst data, soil/cultivation suitability and forest inventory are not included. These geospatial
methods are experimental in 0.8.0 because upstream catalogue and ArcGIS/WFS contracts can change.

## Auto-paginating iterators

Fourteen list APIs provide async iterators. They fetch the next numbered page, spatial offset or opaque
continuation marker only when iteration advances:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ applicationName: "acme-bounded-export" });
const bounds = { maxItems: 50, maxPages: 5 };

const companies = norway.companies.searchAll({ municipalityCode: "1106" }, bounds);
const datasets = norway.catalog.searchAll({ query: "transport", type: ["dataset"] }, bounds);
const cases = norway.parliament.searchCasesAll({ sessionId: "2025-2026" }, bounds);
const roadObjects = norway.roads.searchRoadObjectsAll({ typeId: 105 }, bounds);
const roadSegments = norway.roads.getRoadNetworkAll({}, bounds);
const geonorgeDatasets = norway.geodata.searchDatasetsAll({ query: "natur" }, bounds);
const protectedAreas = norway.environment.iterateProtectedAreas({
  boundingBox: { south: 61.45, west: 8.25, north: 61.55, east: 8.45 },
  limit: 25,
  pageSize: 10,
  maxPages: 3,
});
const landResources = norway.land.iterateLandResources({
  latitude: 61.494,
  longitude: 8.349,
  limit: 25,
});

for await (const company of companies) {
  console.log(company.organizationNumber, company.name);
}

void datasets;
void cases;
void roadObjects;
void roadSegments;
void geonorgeDatasets;
void protectedAreas;
void landResources;
```

The nine ordinary search iterators accept normal request options together with `maxItems` and
`maxPages`.
`maxItems` must be a non-negative integer. `maxPages` must be an integer from 1 to 100 and defaults
to 100; set explicit bounds for batch jobs. Data.norge multi-type searches keep their 100-position
combined-window limit, and NVDB continuation markers remain opaque. If a cursor-based provider
repeats a marker or returns a cycle, the iterator raises `ResponseValidationError` before requesting
the already-seen page again. The five spatial iterators instead use their query's `limit`,
`pageSize`, `maxPages` and `offset`; they also reject repeated page contents so an offset service
that ignores pagination cannot loop forever.

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

## Shared cache and request budgets

```ts
import { NorwayOpenData, providers, type CacheStore } from "norway-open-data-sdk";

const store: CacheStore = {
  async get(key) {
    const raw = await redis.get(key);
    return raw === null ? undefined : JSON.parse(raw);
  },
  async set(key, value, ttlMs) {
    await redis.set(key, JSON.stringify(value), { PX: ttlMs });
  },
  async clear() {
    await redis.flushDb();
  },
};

const norway = new NorwayOpenData({ cache: { enabled: true, store } });

const first = await norway.companies.get("923609016");
console.log(first.cached); // false

// A different instance, process or worker sharing the same store:
const second = await new NorwayOpenData({ cache: { enabled: true, store } }).companies.get(
  "923609016",
);
console.log(second.cached); // true

await norway.clearCache();
```

The default cache is private to one `NorwayOpenData` instance, so a second instance starts cold.
A `CacheStore` shares validated responses across instances and then owns expiry and eviction, which
makes `cache.maxEntries` inapplicable. Store methods may be synchronous or asynchronous.

Each provider also declares how often the SDK may call it, enforced by default across every client
sharing an instance:

```ts
console.log(providers.ssb.rateLimit?.default);
// { requests: 30, intervalMs: 60_000, basis: "provider-documented", note: "..." }

console.log(providers["ssb-klass"].rateLimit?.default);
// { requests: 30, intervalMs: 60_000, basis: "sdk-courtesy", note: "..." }
```

A request that would exceed a budget waits its turn instead of failing, and that wait never counts
against `timeoutMs`. Cached responses cost no budget, retries do, and cancelling a caller's `signal`
rejects a queued request immediately. Budgets are named per operation class where a provider
publishes different limits per service, so Data.norge's 10 searches/minute and 5 resource
lookups/second do not throttle each other. `basis` records whether the number is the provider's own
or a conservative budget the SDK chose. Disable enforcement with `rateLimit: { enabled: false }`
only when your traffic is already bounded elsewhere.

SSB publishes the PxWeb number, but no Klass-specific numeric limit. The Klass value is a
conservative SDK courtesy budget, not official SSB guidance.
