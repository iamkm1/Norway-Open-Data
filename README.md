# Norway Open Data SDK

[![npm](https://img.shields.io/npm/v/norway-open-data-sdk)](https://www.npmjs.com/package/norway-open-data-sdk)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
[![Licence: MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)](LICENSE)

> One TypeScript interface for Norway’s open public APIs.

Norway Open Data SDK is an open-source TypeScript library that provides one typed and consistent
interface to Norwegian public data.

It calls official APIs directly from a developer's Node.js application—there is no hosted backend,
database, account, scraping layer, or restricted-data integration.

## Why this exists

Norwegian public bodies publish valuable open data through mature but different APIs: REST,
HAL+JSON, PxWeb/JSON-stat2, GraphQL, GeoJSON, and provider-specific identification rules. This SDK
puts the repetitive engineering in one reusable library:

- strict public TypeScript types and runtime Zod validation;
- one response envelope without forcing unrelated data into an inaccurate universal schema;
- timeout, cancellation, retry, rate-limit, and error behavior shared across providers;
- injected native `fetch` for testing and custom runtimes;
- opt-in, bounded memory caching with provider-aware TTLs;
- explicit source, licence, attribution, and raw-payload escape hatches.

## Supported providers

| Provider                | Client                | Capabilities                                        | Access                   |
| ----------------------- | --------------------- | --------------------------------------------------- | ------------------------ |
| Brønnøysundregistrene   | `companies`           | Organization lookup/search and sub-entities         | Open                     |
| Statistics Norway / SSB | `statistics`          | PxWeb v2 metadata, normalized query, raw JSON-stat2 | Open                     |
| Kartverket              | `addresses`, `places` | Address, place-name, and nearby search              | Open                     |
| Entur                   | `transport`           | Autocomplete, departures, journeys                  | Identification required  |
| MET Norway              | `weather`             | Compact forecast and current entry                  | Identification required  |
| Data.norge              | `catalog`             | Search, datasets, data services, publishers         | Open                     |
| Norges Bank             | `currency`            | Exchange rates, policy rate, Nowa                   | Open                     |
| Stortinget              | `parliament`          | People, parties, cases, votes, questions, meetings  | Open                     |
| Statens vegvesen        | `roads`               | NVDB metadata, road objects, segmented road network | Identification required  |
| NVE                     | `energy`, `hazards`   | Energy, warnings, hydrology stations/observations   | Open / free registration |

The provider registry is exported as `providers`. Detailed legal and operational notes are in
[PROVIDERS.md](PROVIDERS.md).

## Installation

```bash
pnpm add norway-open-data-sdk
```

The package supports ESM and CommonJS, includes declarations and source maps, requires Node.js 20
or newer, and has no runtime dependency other than Zod.

## Quick start

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "my-company-my-application",
  contactEmail: "developer@example.no",
});

const company = await norway.companies.get("923609016");
console.log(company.data.name);

const forecast = await norway.weather.forecast({
  latitude: 59.4138,
  longitude: 5.268,
});
console.log(forecast.data.timeseries[0]);
```

Every successful method returns this shape:

```ts
export type ResponseShape<T> = {
  data: T;
  source: {
    id: string;
    name: string;
    homepage: string;
    documentation: string;
    license?: string;
  };
  retrievedAt: string;
  cached: boolean;
  raw?: unknown;
};
```

Pass `{ includeRaw: true }` as the final method argument to include the validated provider payload
under `raw`. `raw` is never an access-control bypass: adapters may strip unsupported personal or
sensitive fields before returning it.

## Provider examples

### Brønnøysundregistrene

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const company = await norway.companies.get("923 609 016");

const matches = await norway.companies.search({
  name: "Eksempel",
  municipalityCode: "1106",
  industryCode: "62.010",
  page: 0,
  size: 20,
});

const subEntity = await norway.companies.getSubEntity("973861883");

console.log(company.data.name);
console.log(matches.data.items.length);
console.log(subEntity.data.name);
```

Organization numbers are normalized by removing whitespace and then validated as exactly nine
digits.

### Statistics Norway / SSB

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

const jsonStat2 = await norway.statistics.queryRaw({
  tableId: "07459",
  selections: {
    Region: ["1106"],
    Kjonn: ["1"],
    Alder: ["000"],
    ContentsCode: ["Personer1"],
    Tid: ["top(1)"],
  },
});

console.log(jsonStat2.data.version);
```

The SDK uses the current PxWeb API v2. Value codes are table-specific; fetch metadata rather than
copying codes from another table or older examples. SSB limits a request to 800,000 cells and
currently permits 30 queries per minute per IP. The SDK does not split or evade those limits.

### Kartverket

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const addresses = await norway.addresses.search({
  query: "Haraldsgata 100",
  municipalityCode: "1106",
  limit: 5,
});

const places = await norway.places.search({
  query: "Preikestolen",
  countyCode: "11",
  limit: 5,
});

const nearby = await norway.places.nearby({
  latitude: 58.9865,
  longitude: 6.1904,
  radiusMeters: 1_000,
  limit: 10,
});

console.log(addresses.data.items.length);
console.log(places.data.items.length);
console.log(nearby.data.items.length);
```

### Entur

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "acme-mobility-app",
});

const suggestions = await norway.transport.autocomplete({
  text: "Oslo S",
  language: "no",
  latitude: 59.91,
  longitude: 10.75,
  limit: 5,
});

const departures = await norway.transport.departures({
  stopPlaceId: "NSR:StopPlace:548",
  limit: 10,
});

const journeys = await norway.transport.journeys({
  from: { placeId: "NSR:StopPlace:548" }, // Bergen stasjon
  to: { placeId: "NSR:StopPlace:30859" }, // Byparken
  arriveBy: false,
  limit: 3,
});

console.log(suggestions.data.length);
console.log(departures.data.length);
console.log(journeys.data.length);
```

`applicationName` is required before every Entur request and is sent as `ET-Client-Name`.

### MET Norway

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "acme-weather-dashboard",
  contactEmail: "weather@acme.example",
});

const forecast = await norway.weather.forecast({
  latitude: 59.413812, // rounded to 59.4138 for MET cache friendliness
  longitude: 5.267988,
  altitude: 15,
});

const current = await norway.weather.current({
  latitude: 59.4138,
  longitude: 5.268,
});

console.log(forecast.data.timeseries.length);
console.log(current.data);
```

MET requires both identity fields. The SDK generates
`NorwayOpenDataSDK/<package-version> <applicationName> <contactEmail>` as the User-Agent and rounds
coordinates to the provider's required four decimals.

### Data.norge catalogue

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const results = await norway.catalog.search({
  query: "befolkning",
  type: ["dataset"],
  accessRights: "PUBLIC",
  page: 0,
  size: 5,
});

const first = results.data.items[0];
if (first !== undefined) {
  const dataset = await norway.catalog.getDataset(first.id);
  console.log(dataset.data.title, dataset.data.license);
}
```

Search is isolated behind one adapter because Data.norge explicitly labels its search API as an
internal service that may change. Direct dataset and data-service lookup uses the stable Resource
Service API. Catalogue access rights and resource-specific licences are exposed rather than
assuming that every entry is freely reusable. Combined multi-type paging is bounded to the first
100 positions of the type-ordered combined result; request one type for deeper provider paging.

### Norges Bank

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const eur = await norway.currency.getExchangeRate({ from: "EUR", to: "NOK" });
const history = await norway.currency.getExchangeRates({
  from: "EUR",
  startDate: "2026-07-01",
  endDate: "2026-07-10",
});
const policyRate = await norway.currency.getPolicyRate();
const nowa = await norway.currency.getNowa();

console.log(eur.data.value, history.data.length);
console.log(policyRate.data.at(-1), nowa.data.at(-1));
```

The client uses official SDMX series. Missing weekend and holiday observations remain missing;
values are never interpolated or moved to another date. An unbounded latest cross-currency request
intersects the last 10 observations from each series; provide a date range for sparse or
discontinued pairs that need an older common observation.

### Stortinget

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const representatives = await norway.parliament.getRepresentatives();
const parties = await norway.parliament.getParties();
const cases = await norway.parliament.searchCases({
  sessionId: "2025-2026",
  query: "jernbane",
  page: 0,
  size: 10,
});

console.log(representatives.data[0]?.fullName);
console.log(parties.data.length, cases.data.pagination.totalItems);
```

Stortinget provides no server pagination for these exports. Case filtering and bounded pagination
are therefore applied locally after fetching one official session export and are marked as such in
the public types.

### Statens vegvesen / NVDB

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ applicationName: "acme-road-analysis" });
const speedLimitType = await norway.roads.getRoadObjectType(105);
const speedLimits = await norway.roads.searchRoadObjects({
  typeId: 105,
  municipalityCode: "1103",
  pageSize: 5,
});

console.log(speedLimitType.data.name);
console.log(speedLimits.data.pagination.nextStart);
```

NVDB requires a meaningful `X-Client` identity. Road-object properties remain `unknown` because
their value schemas belong to the selected NVDB type. Sensitive object types and sensitive
property definitions are intentionally excluded from both normalized and optional raw metadata.

### NVE energy and hazards

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  credentials: { nve: { apiKey: process.env.NVE_HYDAPI_KEY } },
});

const reservoirs = await norway.energy.getReservoirStatistics();
const warnings = await norway.hazards.getAvalancheWarnings();
console.log(reservoirs.data[0], warnings.data.length);

if (process.env.NVE_HYDAPI_KEY !== undefined) {
  const stations = await norway.hazards.getHydrologyStations({ active: true });
  console.log(stations.data[0]);
}
```

Reservoir, power-plant, and warning methods are open and anonymous. HydAPI station and observation
methods require a free NVE API key and throw `ConfigurationError` before network access when it is
missing. Warning records are a normalized discovery summary. Varsom requires complete warning data
and service-specific attribution for public presentation, so request `{ includeRaw: true }` and
follow the current NVE/Varsom terms before displaying warnings to end users.

## Company profiles

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const profile = await norway.profiles.company("923609016");

console.log(profile.data.company);
console.log(profile.data.location?.address.latitude);
console.log(profile.data.location?.matchConfidence); // exact | high | possible
```

The profile first reads Brønnøysundregistrene, skips Kartverket when no usable Norwegian business
address exists, and otherwise selects the strongest official address match. Confidence is
deterministic: `exact` requires address, postal code, and municipality agreement; `high` requires
the address plus one locality signal; a weaker candidate is only `possible`.

## Configuration

```ts
export type NorwayOpenDataConfig = {
  applicationName?: string;
  contactEmail?: string;
  timeoutMs?: number; // default 10_000
  retries?: number; // default 2
  fetch?: typeof globalThis.fetch;
  cache?: {
    enabled?: boolean; // default false
    ttlMs?: number; // optional global override
    maxEntries?: number; // default 100
  };
  credentials?: {
    nve?: {
      apiKey?: string; // free HydAPI registration; never required by open NVE methods
    };
  };
};
```

An injected fetch implementation makes requests straightforward to mock:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const myFetch: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init);
const norway = new NorwayOpenData({ fetch: myFetch });
const company = await norway.companies.get("923609016");

console.log(company.data.name);
```

All methods also accept `{ signal, includeRaw, bypassCache }`.

## Error handling

```ts
import {
  InputValidationError,
  NorwayOpenData,
  NotFoundError,
  RateLimitError,
} from "norway-open-data-sdk";

const norway = new NorwayOpenData();

try {
  await norway.companies.get("000000000");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error("Unknown organization");
  } else if (error instanceof RateLimitError) {
    console.error("Retry after seconds:", error.retryAfter);
  } else if (error instanceof InputValidationError) {
    console.error(error.message);
  }
}
```

Exported errors are `OpenDataError`, `ConfigurationError`, `InputValidationError`,
`NotFoundError`, `RateLimitError`, `ProviderError`, `RequestTimeoutError`, and
`ResponseValidationError`. Applicable errors expose `provider`, `statusCode`, `retryAfter`, and
`cause`. Messages never include complete request headers, and the library never logs automatically.

Only 429, 502, 503, 504, and temporary network failures are retried. Retry delay is exponential
with jitter, bounded at five seconds, and honors `Retry-After`. Input and response validation
failures and 400/401/403/404 responses are never retried.

## Caching

Caching is disabled by default:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  cache: { enabled: true, maxEntries: 250 },
});

const company = await norway.companies.get("923609016", { bypassCache: true });
console.log(company.cached); // false
```

The in-memory cache is TTL-aware and LRU-style, uses stable keys, never caches failures, and marks
hits with `cached: true`.

| Data                          | Recommended default TTL |
| ----------------------------- | ----------------------: |
| Companies                     |              15 minutes |
| Addresses and places          |                24 hours |
| SSB metadata                  |                24 hours |
| SSB query results             |                  1 hour |
| Entur departures and journeys |              20 seconds |
| Entur autocomplete            |               5 minutes |
| Weather                       |              10 minutes |
| Data.norge search             |              10 minutes |
| Data.norge resources          |                  1 hour |
| Currency and interest rates   |                  1 hour |
| Parliament people and parties |                 6 hours |
| Parliament cases and votes    |              15 minutes |
| NVDB type metadata            |                24 hours |
| NVDB road data                |               5 minutes |
| NVE power plants              |                24 hours |
| NVE reservoir statistics      |                  1 hour |
| NVE warnings                  |               5 minutes |
| NVE hydrology observations    |              10 minutes |

Setting `cache.ttlMs` safely overrides these defaults globally.

## Provider identification, licences, and attribution

Entur and NVDB need a meaningful `applicationName`. MET Norway needs both `applicationName` and
`contactEmail`. NVE HydAPI needs `credentials.nve.apiKey`; open NVE methods do not. Missing required
identification or credentials raises `ConfigurationError` before network access.

The MIT licence applies to the SDK source code, not automatically to provider data. Brreg, SSB,
Kartverket, Entur, MET, Data.norge, Norges Bank, Stortinget, Statens vegvesen, and NVE publish under
different or dataset-specific terms. Read
[PROVIDERS.md](PROVIDERS.md), verify the current official terms for your use, and provide required
attribution.

> **Norway Open Data SDK is an independent open-source project and is not affiliated with,
> sponsored by, or endorsed by Norwegian public authorities. Data remains subject to each
> provider’s terms and licence.**

Restricted and personal data are intentionally excluded.

## Development

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm run docs
```

Offline unit tests are the default. Low-volume live smoke tests are explicitly opt-in:

```bash
NORWAY_OPEN_DATA_APPLICATION_NAME=my-company-local-test \
NORWAY_OPEN_DATA_CONTACT_EMAIL=developer@example.no \
RUN_LIVE_TESTS=true pnpm test:live
```

On PowerShell:

```shell
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "my-company-local-test"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "developer@example.no"
$env:RUN_LIVE_TESTS = "true"
pnpm test:live
```

Run the complete local smoke script with the same identification variables after building:

```shell
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "my-company-local-test"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "developer@example.no"
pnpm build
pnpm smoke
```

See [docs/examples.md](docs/examples.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Publishing

Configure the GitHub repository as an npm trusted publisher, then:

```bash
pnpm changeset
git add .
git commit -m "chore: add release changeset"
git push
```

The release workflow runs checks, lets Changesets create/update the version PR, builds, and
publishes with npm provenance using OIDC. For a permitted local/manual release:

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm changeset version
pnpm release
```

## Roadmap

Future candidates include:

- Udir
- Fiskeridirektoratet
- Artsdatabanken
- Patentstyret
- Kystverket

Future additions must have an official open API, clear licensing, no personal/restricted-data
requirement, runtime schemas, offline fixtures, tests, and provider documentation.

## Contributing

Issues and focused pull requests are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md), link
official documentation for provider changes, add offline tests, and include a Changeset for
user-visible behavior.

## Licence

The SDK source is available under the [MIT Licence](LICENSE). Provider data is not relicensed by
this project.
