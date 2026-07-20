# Norway Open Data SDK

One typed TypeScript interface for Norwegian public data.

- 10 public-data providers
- 13 service namespaces
- 45 public methods
- Runtime-validated responses
- ESM, CommonJS and TypeScript support
- 111 automated tests
- 95% statement and line coverage

![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
[![Licence: MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)](LICENSE)

Norway Open Data SDK gives Node.js developers one consistent client for official Norwegian public
data. It handles provider-specific URLs, request formats, caller identification, retries, runtime
validation and response metadata while preserving each provider's own data model.

Requests go directly from your application to the official APIs. The SDK has no hosted backend,
database, account system or scraping layer.

## Installation

Requires Node.js 20 or newer. TypeScript declarations are included; no `@types` package is needed.

The npm package has not been published yet. After the first npm release, install it with:

```bash
npm install norway-open-data-sdk
```

To work from the repository today:

```bash
git clone https://github.com/iamkm1/Norway-Open-Data.git
cd Norway-Open-Data
corepack pnpm install
corepack pnpm build
```

## Minimal quick start

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const { data: company } = await norway.companies.get("923609016");

console.log(company.name);
```

CommonJS is also supported:

```js
const { NorwayOpenData } = require("norway-open-data-sdk");
```

Import from the package root. Internal source paths are not part of the public API.

## Supported providers

| Provider                | Namespace             | What it provides                                    | Access                             |
| ----------------------- | --------------------- | --------------------------------------------------- | ---------------------------------- |
| Brønnøysundregistrene   | `companies`           | Organizations, search and sub-entities              | Open                               |
| Statistics Norway / SSB | `statistics`          | PxWeb metadata and JSON-stat2 data                  | Open                               |
| Kartverket              | `addresses`, `places` | Addresses, place names and nearby search            | Open                               |
| Entur                   | `transport`           | Autocomplete, departures and journeys               | App identification                 |
| MET Norway              | `weather`             | Locationforecast data and current entry             | App identification + contact email |
| Data.norge              | `catalog`             | Datasets, data services and publishers              | Open                               |
| Norges Bank             | `currency`            | Exchange rates, policy rate and Nowa                | Open                               |
| Stortinget              | `parliament`          | Representatives, parties, cases, votes and meetings | Open                               |
| Statens vegvesen / NVDB | `roads`               | Road metadata, objects and network segments         | App identification                 |
| NVE                     | `energy`, `hazards`   | Energy data, warnings and hydrology                 | Open; API key for HydAPI           |

`profiles` is a composite namespace that combines Brønnøysundregistrene company data with a
Kartverket address match. The full provider registry is exported as `providers`. See
[PROVIDERS.md](PROVIDERS.md) for official documentation, access rules, limits and attribution.

## Namespace overview

| Namespace    | Public methods                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `companies`  | `get`, `search`, `getSubEntity`                                                                                              |
| `statistics` | `getTableMetadata`, `query`, `queryRaw`                                                                                      |
| `addresses`  | `search`                                                                                                                     |
| `places`     | `search`, `nearby`                                                                                                           |
| `transport`  | `autocomplete`, `departures`, `journeys`                                                                                     |
| `weather`    | `forecast`, `current`                                                                                                        |
| `profiles`   | `company`                                                                                                                    |
| `catalog`    | `search`, `getDataset`, `getDataService`, `getPublisher`                                                                     |
| `currency`   | `getExchangeRate`, `getExchangeRates`, `getPolicyRate`, `getNowa`                                                            |
| `parliament` | `getRepresentatives`, `getRepresentative`, `getParties`, `searchCases`, `getCase`, `getVotes`, `getQuestions`, `getMeetings` |
| `roads`      | `getRoadObjectTypes`, `getRoadObjectType`, `searchRoadObjects`, `getRoadObject`, `getRoadNetwork`                            |
| `energy`     | `getReservoirStatistics`, `getHydropowerPlants`, `getWindPowerPlants`, `getPowerPlants`                                      |
| `hazards`    | `getFloodWarnings`, `getAvalancheWarnings`, `getLandslideWarnings`, `getHydrologyStations`, `getHydrologyObservations`       |

## Configuration

Create one client and share it for the lifetime of your application:

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "my-company-my-application",
  contactEmail: "developer@example.no",
  timeoutMs: 10_000,
  retries: 2,
  cache: {
    enabled: true,
    maxEntries: 250,
  },
  credentials: {
    nve: {
      apiKey: process.env.NVE_HYDAPI_KEY,
    },
  },
});
```

| Option                   | Default            | Purpose                                                         |
| ------------------------ | ------------------ | --------------------------------------------------------------- |
| `applicationName`        | None               | Meaningful caller identity required by Entur, MET and NVDB      |
| `contactEmail`           | None               | Monitored contact address required by MET                       |
| `timeoutMs`              | `10_000`           | Per-attempt request timeout in milliseconds                     |
| `retries`                | `2`                | Retry attempts after the initial request; allowed range is 0–10 |
| `fetch`                  | `globalThis.fetch` | Fetch-compatible implementation for tests or custom runtimes    |
| `cache.enabled`          | `false`            | Enables the per-client memory cache                             |
| `cache.ttlMs`            | Provider default   | Overrides all provider TTLs                                     |
| `cache.maxEntries`       | `100`              | Maximum in-memory cache entries                                 |
| `credentials.nve.apiKey` | None               | Free NVE HydAPI key for station and observation calls           |

Every provider method also accepts request options as its final argument:

```ts
const controller = new AbortController();

await norway.catalog.search(
  { query: "transport", type: ["dataset"], size: 5 },
  {
    signal: controller.signal,
    includeRaw: true,
    bypassCache: true,
  },
);
```

## Provider identification and credentials

Most supported methods are anonymous. Identification is not authentication: Entur, MET and NVDB
ask clients to say which application is making requests.

| Service                              | Required configuration               | Sent as                  |
| ------------------------------------ | ------------------------------------ | ------------------------ |
| Entur                                | `applicationName`                    | `ET-Client-Name`         |
| MET Norway                           | `applicationName` and `contactEmail` | Identifying `User-Agent` |
| Statens vegvesen / NVDB              | `applicationName`                    | `X-Client`               |
| NVE HydAPI stations and observations | `credentials.nve.apiKey`             | `X-API-Key`              |

Each developer or deployed application must provide its own identity and contact address. The SDK
does not contain a shared owner email, API key or fallback identity. The NVE key is sent only to
`hydapi.nve.no`; NVE energy and warning methods remain anonymous.

Missing required values produce a `ConfigurationError` before a network request is made. Keep API
keys in environment variables or a secret manager, never in source control.

## Response format

Every successful operation returns `OpenDataResponse<T>`:

```ts
type OpenDataResponse<T> = {
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

- `data` is the typed result used by application code.
- `source` identifies the official provider and its documentation.
- `retrievedAt` is the SDK retrieval time in ISO 8601 format.
- `cached` tells you whether the response came from the in-memory cache.
- `raw` is present only with `{ includeRaw: true }`.

`raw` is still runtime-validated and may be allowlisted or sanitized. It is not a way to recover
restricted, sensitive or intentionally unsupported fields.

## Error handling

```ts
import {
  ConfigurationError,
  InputValidationError,
  NorwayOpenData,
  NotFoundError,
  OpenDataError,
  RateLimitError,
} from "norway-open-data-sdk";

const norway = new NorwayOpenData();

try {
  await norway.companies.get("000000000");
} catch (error) {
  if (error instanceof NotFoundError) {
    console.error("Organization not found");
  } else if (error instanceof RateLimitError) {
    console.error("Retry after seconds:", error.retryAfter);
  } else if (error instanceof ConfigurationError || error instanceof InputValidationError) {
    console.error(error.message);
  } else if (error instanceof OpenDataError) {
    console.error(error.provider, error.statusCode, error.message);
  }
}
```

The exported error classes are:

- `ConfigurationError`
- `InputValidationError`
- `NotFoundError`
- `RateLimitError`
- `ProviderError`
- `RequestTimeoutError`
- `ResponseValidationError`

All extend `OpenDataError`. Applicable errors include `provider`, `statusCode`, `retryAfter` and
`cause`. The SDK never logs automatically.

Only HTTP 429, 502, 503, 504 and temporary network failures are retried. Retries use exponential
jitter capped at five seconds and honor `Retry-After`. Validation errors and HTTP 400, 401, 403 and
404 are not retried.

## Caching

Caching is disabled by default and is local to one `NorwayOpenData` instance:

```ts
const norway = new NorwayOpenData({
  cache: { enabled: true, maxEntries: 250 },
});

const first = await norway.companies.get("923609016");
const second = await norway.companies.get("923609016");

console.log(first.cached); // false
console.log(second.cached); // true
```

The cache is an in-memory, TTL-aware LRU with stable request keys. Provider defaults range from 20
seconds for real-time transport to 24 hours for slower-changing metadata. Set `cache.ttlMs` to
override those defaults globally. Failed or invalid responses are never cached, and
`bypassCache: true` skips both cache reads and writes.

## Live-test instructions

The default test suite is deterministic, offline and contains 111 tests:

```bash
pnpm test
pnpm test:coverage
```

The opt-in live suite makes low-volume requests to all 10 official providers. Use your own caller
identity so Entur, MET and NVDB accept the requests.

macOS or Linux:

```bash
NORWAY_OPEN_DATA_APPLICATION_NAME=my-company-local-test \
NORWAY_OPEN_DATA_CONTACT_EMAIL=developer@example.no \
pnpm test:live
```

PowerShell:

```powershell
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "my-company-local-test"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "developer@example.no"
pnpm test:live
```

`pnpm test:live` sets `RUN_LIVE_TESTS=true` for you. Supplying both identity variables runs all 11
live checks; the MET check is skipped when the contact email is absent. The current live suite uses
only anonymous NVE energy data, so it does not require an NVE HydAPI key.

For the larger built-package smoke run:

```bash
pnpm build
pnpm smoke
```

Live tests depend on network availability and current provider contracts. They are intentionally
excluded from ordinary unit tests and CI.

## Examples

Complete runnable examples are available for:

- [Company lookup](examples/company.ts) and [company profile](examples/company-profile.ts)
- [SSB statistics](examples/statistics.ts)
- [Addresses and places](examples/address.ts)
- [Entur transport](examples/transport.ts)
- [MET weather](examples/weather.ts)
- [Data.norge catalogue](examples/catalog.ts)
- [Norges Bank currency](examples/currency.ts)
- [Stortinget parliament data](examples/parliament.ts)
- [NVDB roads](examples/roads.ts)
- [NVE energy](examples/energy.ts) and [hazards](examples/hazards.ts)

See [docs/examples.md](docs/examples.md) for explanations, required configuration and provider
notes.

## Architecture

```text
Your application
  └─ NorwayOpenData facade
       └─ Provider namespace adapter
            └─ Shared HTTP client
                 └─ Official provider API
```

- The facade creates all 13 namespaces with one shared configuration and cache.
- Provider adapters own request construction, Zod schemas and safe normalization.
- The shared HTTP layer handles timeout, cancellation, retry, rate-limit errors and caching.
- Responses keep provider-specific semantics instead of forcing unrelated records into one model.
- `tsup` builds ESM, CommonJS, declarations and source maps from one public entry point.

The SDK supports REST, HAL+JSON, GraphQL, GeoJSON, PxWeb/JSON-stat2, SDMX CSV and RDF/Turtle behind
the same response envelope. See [docs/architecture.md](docs/architecture.md) for the full design.

## Contribution instructions

Development requires Node.js 20+ and pnpm 10:

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

Provider changes should link to current official documentation, include a small offline fixture,
validate external responses at runtime, add deterministic tests and update `PROVIDERS.md` when
access rules, limits or attribution change. User-visible changes also need a Changeset:

```bash
pnpm changeset
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) before opening a
pull request.

## Licence and attribution

The SDK source code is available under the [MIT Licence](LICENSE).

The MIT licence does not automatically apply to data returned by public providers. Each provider
or dataset keeps its own licence, terms, traffic limits and attribution requirements. Data.norge is
a catalogue, so every listed resource may have different reuse terms. Review [PROVIDERS.md](PROVIDERS.md)
and the linked official documentation before redistributing data.

Norway Open Data SDK is an independent open-source project. It is not affiliated with, sponsored
by or endorsed by Norwegian public authorities. Restricted and personal data are intentionally
outside the project scope.

## Known limitations

- The package currently targets Node.js 20+. Browser use is not guaranteed because provider CORS
  and identification rules differ.
- Public provider contracts, limits and response shapes can change independently of the SDK.
- Data.norge multi-type search is merged locally and limited to the first 100 combined positions;
  its search API is documented as an internal service that may change.
- Stortinget case search and pagination are applied locally after one official session export.
- Norges Bank values are never interpolated. Weekends, holidays and missing observations remain
  missing, and latest cross-currency matching checks a bounded recent window.
- NVDB road-object properties are type-specific and remain `unknown`; continuation tokens are
  opaque and must be passed back unchanged.
- NVE HydAPI station and observation calls require a free API key and remain subject to provider
  response-size and rate limits.
- Hazard warnings are regional planning data, not a guarantee of local safety. Follow the complete
  official Varsom guidance and attribution before displaying them to end users.
- The optional cache is in-process only. It is not persistent or shared across application
  instances.
- Protected endpoints, personal data, write operations and delegated government authentication
  flows are intentionally unsupported.

For provider-specific caveats and current official links, read [PROVIDERS.md](PROVIDERS.md).
