# Norway Open Data SDK

[![CI](https://github.com/iamkm1/Norway-Open-Data/actions/workflows/ci.yml/badge.svg)](https://github.com/iamkm1/Norway-Open-Data/actions/workflows/ci.yml)
![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22-339933)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
[![Licence: MIT](https://img.shields.io/badge/Licence-MIT-blue.svg)](LICENSE)

One typed TypeScript interface for Norwegian public data.

Norway Open Data SDK provides a consistent, runtime-validated client for official Norwegian APIs
from Brønnøysundregistrene, SSB, FHI, Kartverket, Entur, MET Norway, Data.norge, Norges Bank,
Stortinget, Statens vegvesen and NVE. It also wraps the documented third-party public electricity
API from Hva koster strømmen?.

- 11 public-sector data sources plus 1 third-party derived API
- 15 service namespaces
- 55+ public methods
- Runtime-validated responses
- Cross-provider profiles that answer one question from several agencies
- Auto-paginating async iterators for list endpoints
- ESM, CommonJS and TypeScript support
- Runs on Node.js, Deno, Bun and edge runtimes from one web-standard build
- Deterministic offline tests plus representative opt-in live contract probes
- Enforced statement, branch, function and line coverage gates

Requests go directly from your Node.js application to the source API. The SDK has no hosted
backend, database, account system or scraping layer.

## Installation

Runs on Node.js 22+, Deno, Bun and edge runtimes such as Cloudflare Workers. TypeScript
declarations are included. See [Runtime support](#runtime-support) for what a host runtime must
provide.

Version `0.5.1` is the current release. Install it with:

```bash
npm install norway-open-data-sdk
```

Contributors can also build and test a local tarball:

```bash
git clone https://github.com/iamkm1/Norway-Open-Data.git
cd Norway-Open-Data

corepack pnpm install
corepack pnpm build
corepack pnpm pack
```

Install the generated tarball from another project:

```bash
npm install /path/to/Norway-Open-Data/norway-open-data-sdk-0.5.1.tgz
```

## Quick start

```ts
import { NorwayOpenData, type Company, type NorwegianAddress } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "my-application",
  contactEmail: "developer@example.no",
});

const company = await norway.companies.get("923609016"); // OpenDataResponse<Company>
console.log(company.data.name);

const addresses = await norway.addresses.search({
  query: "Haraldsgata 100, Haugesund",
  limit: 1,
});
console.log(addresses.data.items[0]); // NorwegianAddress

const profile = await norway.profiles.company("923609016");
console.log(profile.data.location);
```

Result types follow each provider's own domain language rather than one shared prefix: companies
return `Company`, Kartverket lookups return `NorwegianAddress`, and every entity type is exported
from the package root, so editor auto-import finds the exact name.

Anonymous methods work without configuration. Entur and NVDB require `applicationName`; MET
requires `applicationName` and `contactEmail`; NVE HydAPI requires the caller's own API key.

## Supported providers

| Source                  | Namespace             | Capabilities                                                   | Access                         |
| ----------------------- | --------------------- | -------------------------------------------------------------- | ------------------------------ |
| Brønnøysundregistrene   | `companies`           | Organizations, search and sub-entities                         | Anonymous                      |
| Statistics Norway / SSB | `statistics`          | PxWeb metadata and JSON-stat2 data                             | Anonymous                      |
| FHI                     | `health`              | Health-register statistics with preserved suppression flags    | Anonymous                      |
| Kartverket              | `addresses`, `places` | Addresses, place names and nearby search                       | Anonymous                      |
| Entur                   | `transport`           | Autocomplete, departures and journeys                          | Identification required        |
| MET Norway              | `weather`             | Locationforecast data and current entry                        | Identification + contact email |
| Data.norge              | `catalog`             | Datasets, data services and publishers                         | Anonymous                      |
| Norges Bank             | `currency`            | Exchange rates, policy rate and NOWA                           | Anonymous                      |
| Stortinget              | `parliament`          | Representatives, parties, cases, votes, questions and meetings | Anonymous                      |
| Statens vegvesen / NVDB | `roads`               | Road metadata, objects and network segments                    | Identification required        |
| NVE                     | `energy`, `hazards`   | Energy data, warnings and hydrology                            | Anonymous; API key for HydAPI  |
| Hva koster strømmen?    | `electricity`         | Hourly spot prices for all five bidding zones                  | Anonymous third-party API      |

`profiles` composes several providers into one answer: `company` combines Brønnøysundregistrene
with a Kartverket address match, `address` combines Kartverket, MET Norway, NVE and NVDB, and
`municipality` combines SSB, FHI, Brønnøysundregistrene and NVE.

Hva koster strømmen? is an independent third-party service, not a government or official data
provider. Its documentation says the API derives EUR electricity prices from ENTSO-E and converts
them to NOK using the latest Norges Bank exchange rate.

See the [complete capability matrix](docs/capabilities.md) for every namespace, method, access
requirement and known limitation.

## Common examples

The following examples use the configured `norway` client from the quick start.

### Company lookup

```ts
const company = await norway.companies.get("923609016");
console.log(company.data.name);
```

### Catalogue search

```ts
const results = await norway.catalog.search({
  query: "public transport",
  type: ["dataset"],
  size: 5,
});
console.log(results.data.items);
```

### Cross-provider company profile

```ts
const profile = await norway.profiles.company("923609016");
console.log(profile.data.location);
```

### Cross-provider address profile

One call answers a location from four providers at once:

```ts
const place = await norway.profiles.address("Haraldsgata 100, Haugesund");

console.log(place.data.address.municipalityName); // Kartverket
console.log(place.data.weather?.temperature); // MET Norway
console.log(place.data.hazards); // Exact administrative-area matches from NVE
console.log(place.data.hazardMatches); // Code/name evidence for each match
console.log(place.data.roads); // First-page NVDB bounding-box candidates
console.log(place.data.roadSearch); // Bounds, page size and truncation state

// components is an array with one entry per SDK operation:
for (const component of place.data.components) {
  console.log(component.operation, component.status);
  // "addresses.search" "available"
  // "hazards.getFloodWarnings" "available"
  // "weather.current" "omitted"  (reason: "not-configured")
}
```

Enrichment degrades gracefully: `weather` and `roads` are omitted when the client has no
`applicationName`/`contactEmail`, rather than failing the whole call. Optional provider _failures_
degrade the same way: if MET, NVDB or one Varsom warning feed errors at request time, the profile
still returns with every surviving section, and the failing operation is reported as `omitted` with
reason `provider-error` and a sanitized `error` name and message. Caller cancellation is never
degraded — aborting the request still rejects the whole call. `components` reports each operation
as `available`, with its source, `retrievedAt` and `cached` values, or `omitted`, with a
`not-configured`, `missing-coordinate`, `not-applicable` or `provider-error` reason. A component's `retrievedAt` is
when that SDK operation resolved, including cache hits, not when its payload was originally fetched
upstream. Sources include provider attribution text, with service-specific wording for each Varsom
warning feed.

`roads` contains only the first provider page intersecting the WGS84 box in `roadSearch`; it is not
a geometry-distance result. The default box extends approximately 250 metres from the address to
each side. Check `roadSearch.truncated` before assuming that all candidates were returned.

> **Safety:** automatic warning discovery checks an explicit municipality by exact code, then exact
> case-insensitive, Unicode-normalized name. It considers a county only when the warning publishes
> no municipalities, because a county can be parent context. Forecast-region names are not matched
> automatically. An empty match is never an all-clear. For any safety decision, consult the current,
> complete official warnings directly from Varsom/NVE and follow their guidance.

### Cross-provider municipality profile

One call answers a municipality from four agencies at once:

```ts
const kommune = await norway.profiles.municipality("Haugesund"); // code "1106" also works

console.log(kommune.data.municipality); // { code, name, countyCode } — SSB region register
console.log(kommune.data.population); // SSB-aggregated residents for the two newest years
console.log(kommune.data.lifeExpectancy); // FHI life expectancy, suppression flags preserved
console.log(kommune.data.companies?.registered); // Brønnøysundregistrene organization count
console.log(kommune.data.hazards); // Exact NVE warning matches for the municipality
console.log(kommune.data.components); // Status and source for every operation
```

The lookup accepts a four-digit municipality code or an exact municipality name; counties and the
whole-country region never resolve, and a duplicated municipality name (Herøy exists twice) requires
SSB's county-qualified label. Population totals are summed by the SDK from SSB's per-sex, per-age
rows — the aggregation is the SDK's, not an SSB-published figure. Life expectancy keeps FHI's
suppression flag with `years: null` for the smallest municipalities. Every optional section degrades
to a `provider-error` component if its provider fails, and the `hazards` safety boundary above
applies here too.

### Health statistics with suppression flags

FHI publishes statistics from Norwegian health registers — cause-of-death rates, abortion
statistics, drug sales and municipal public-health indicators — through one open API:

```ts
const sources = await norway.health.getSources(); // daar, abr, nokkel, ...

const result = await norway.health.query({
  source: "daar",
  tableId: 754,
  selections: {
    DAAR: ["2020"],
    KJONN: ["Total"],
    HJERTEKAR: ["Total"],
    MEASURE_TYPE: ["RATE_NO"],
  },
});
console.log(result.data.rows[0]?.value); // age-standardized cardiovascular death rate
```

Discover what a table accepts with `health.getTables(source)`, `health.getTableMetadata(source,
tableId)` and `health.getTableDimensions(source, tableId)`; a selection of `["*"]` selects every
category of a dimension, including nested child categories.

Small-count health cells are **suppressed at the source** — anonymized or not computable. The SDK
preserves FHI's markers instead of hiding them: a suppressed row is `{ value: null, flag: ":" }`,
and `result.data.flags` maps every symbol to the provider's own explanation. A `flag` is
information, not absence: keep flagged observations suppressed in anything you build on top.

### Electricity spot prices

This namespace uses the third-party Hva koster strømmen? API. The provider documents the values as
ENTSO-E electricity prices in EUR converted to NOK with a Norges Bank exchange rate.

```ts
const prices = await norway.electricity.getPrices({ area: "NO1" });
console.log(prices.data[0]);

const now = await norway.electricity.getCurrentPrice({ area: "NO5" });
console.log(now.data?.nokPerKwh);
```

`getPrices()` returns one entry per elapsed hour in the requested Europe/Oslo calendar day: normally
24, but 23 or 25 across daylight-saving transitions. Normalized `endsAt` values follow the next
chronological `startsAt` (or the following local midnight). Use `{ includeRaw: true }` when you also
need the provider-native timestamps.

### Paging through large result sets

List endpoints expose auto-paginating async iterators that request each page on demand:

```ts
for await (const company of norway.companies.searchAll({ municipalityCode: "1106" })) {
  console.log(company.name);
}
```

Bound the walk with `maxItems` or `maxPages`:

```ts
const iterator = norway.catalog.searchAll({ query: "transport" }, { maxItems: 50 });
```

`maxItems` must be a non-negative integer. `maxPages` must be an integer from 1 to 100 and defaults
to 100. NVDB iterators treat continuation markers as opaque and throw `ResponseValidationError`
before requesting an already-seen marker when a provider repeats a cursor or returns a cycle.

Available on `companies.searchAll`, `catalog.searchAll`, `parliament.searchCasesAll`,
`roads.searchRoadObjectsAll` and `roads.getRoadNetworkAll`.

### Request cancellation

```ts
const controller = new AbortController();

await norway.weather.forecast(
  {
    latitude: 59.4138,
    longitude: 5.268,
  },
  {
    signal: controller.signal,
  },
);
```

### Raw response access

```ts
const rate = await norway.currency.getExchangeRate(
  {
    from: "EUR",
    to: "NOK",
  },
  {
    includeRaw: true,
  },
);
console.log(rate.raw);
```

Note that the normalized result names the pair with SDMX terminology: the `from` currency is
`data.baseCurrency` and the `to` currency is `data.quoteCurrency`, alongside `date`, `value` and
an optional `unit` multiplier for currencies quoted per 100 units.

## Configuration

```ts
import { NorwayOpenData } from "norway-open-data-sdk";

const nveApiKey = process.env.NVE_HYDAPI_KEY;

const norway = new NorwayOpenData({
  applicationName: "my-company-my-application",
  contactEmail: "developer@example.no",
  timeoutMs: 10_000,
  retries: 2,
  cache: { enabled: true, maxEntries: 250 },
  fetch: globalThis.fetch,
  ...(nveApiKey === undefined ? {} : { credentials: { nve: { apiKey: nveApiKey } } }),
});
```

| Option                   | Default            | Purpose                                              |
| ------------------------ | ------------------ | ---------------------------------------------------- |
| `applicationName`        | None               | Caller identity required by Entur, MET and NVDB      |
| `contactEmail`           | None               | Contact address required by MET                      |
| `timeoutMs`              | `10_000`           | Per-attempt timeout in milliseconds                  |
| `retries`                | `2`                | Retry attempts after the initial request; range 0–10 |
| `fetch`                  | `globalThis.fetch` | Custom Fetch-compatible implementation               |
| `cache.enabled`          | `false`            | Enables the response cache                           |
| `cache.ttlMs`            | Provider default   | Overrides provider-specific TTLs                     |
| `cache.maxEntries`       | `100`              | Maximum entries for the built-in in-memory cache     |
| `cache.store`            | In-memory          | Custom `CacheStore` for sharing across instances     |
| `rateLimit.enabled`      | `true`             | Enforces each provider's declared request budget     |
| `credentials.nve.apiKey` | None               | Free NVE HydAPI key for stations and observations    |

When required by the selected service, each application must provide its own identity, contact
address and credentials. The SDK contains no shared email, API key or fallback identity. Missing
required values raise `ConfigurationError` before a request is made.

Every provider method accepts optional `signal`, `includeRaw` and `bypassCache` request options.

## Runtime support

The SDK uses only web-standard APIs, so one build runs everywhere. CI executes the built package on
Node.js 22 and 24, Deno and Bun on every change.

| Runtime                                 | Status                                                     |
| --------------------------------------- | ---------------------------------------------------------- |
| Node.js 22+                             | Verified in CI                                             |
| Deno 2                                  | Verified in CI                                             |
| Bun                                     | Verified in CI                                             |
| Cloudflare Workers and other edge hosts | Supported; the same ESM build is used                      |
| Browsers                                | Supported where the provider sends permissive CORS headers |

A host runtime must provide:

- a spec-compliant `fetch`, `Response`, `Headers` and `AbortController`
- `structuredClone`, used by the response cache
- a full-ICU `Intl`, used for Europe/Oslo dates and Norwegian locale casing

The package imports no Node built-in and reads no `process`, `Buffer`, `__dirname` or `__filename`;
`pnpm check:portability` enforces that against the built output on every verify run. Pass your own
`fetch` through the `fetch` option when a runtime needs a custom implementation.

Browser use is bounded by each provider's CORS policy rather than by the SDK. Providers requiring
identification also expect it in a `User-Agent`, which browsers do not allow applications to set, so
server-side or edge use remains the better fit for those namespaces.

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
    attribution?: string;
  };
  retrievedAt: string;
  cached: boolean;
  raw?: unknown;
};
```

`data` is the typed result; `source` identifies the provider and includes its licence or attribution
when declared; `retrievedAt` is an ISO 8601 timestamp; `cached` reports a memory-cache hit; and
`raw` is included only when requested. Raw payloads remain runtime-validated and may be allowlisted
or sanitized.

## Error handling

```ts
import {
  NorwayOpenData,
  NotFoundError,
  OpenDataError,
  ProviderError,
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
  } else if (error instanceof OpenDataError) {
    console.error(error.provider, error.statusCode, error.message);
  } else {
    throw error;
  }
}
```

Exported errors are `OpenDataError`, `ConfigurationError`, `InputValidationError`,
`NotFoundError`, `RateLimitError`, `ProviderError`, `RequestTimeoutError` and
`ResponseValidationError`. Retryable provider responses, timeouts and temporary network failures
use bounded retries and honor `Retry-After`; validation and other client errors are not retried.

Caller cancellation also surfaces as `ProviderError`, with the abort reason attached as `cause`.
When retry or reporting logic must distinguish a deliberate abort from a provider failure, check
the caller's own signal rather than the error:

```ts
try {
  await norway.companies.get("923609016", { signal: controller.signal });
} catch (error) {
  if (controller.signal.aborted) {
    // Cancelled by this application — do not retry or alert.
  } else if (error instanceof ProviderError) {
    // Genuine provider failure.
  }
}
```

## Caching

```ts
const norway = new NorwayOpenData({
  cache: { enabled: true, maxEntries: 250 },
});

const first = await norway.companies.get("923609016");
console.log(first.cached); // false

const second = await norway.companies.get("923609016");
console.log(second.cached); // true

await norway.clearCache();
const afterClear = await norway.companies.get("923609016");
console.log(afterClear.cached); // false
```

Caching is disabled by default. When enabled, the SDK uses a bounded in-memory TTL/LRU cache with
provider-specific TTLs. Failures are never cached, and `{ bypassCache: true }` skips both reads and
writes.

### Sharing a cache between instances

The default cache lives inside one `NorwayOpenData` instance, so a second instance — another
worker, another process — starts cold. Supply a `CacheStore` to share responses. Every method may
be synchronous or asynchronous.

```ts
import type { CacheStore } from "norway-open-data-sdk";

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
```

The store receives values that have already passed runtime validation and is expected to return
them unchanged. It owns expiry and eviction, so `cache.maxEntries` no longer applies. `clearCache()`
resolves once the store has cleared, and with a shared store it affects every reader.

## Request budgets

Each provider declares how often the SDK may call it, and that budget is enforced by default across
every client sharing one `NorwayOpenData` instance. A request that would exceed the budget waits its
turn rather than being rejected, and waiting never counts against `timeoutMs`. Cached responses cost
no budget, and cancelling a caller's `signal` rejects a queued request immediately.

```ts
import { providers } from "norway-open-data-sdk";

console.log(providers.ssb.rateLimit?.default);
// { requests: 30, intervalMs: 60_000, basis: "provider-documented", note: "..." }
```

`basis` distinguishes a limit the provider publishes from a conservative budget the SDK chose for a
provider that publishes none.

Budgets are named per operation class, because a provider can publish very different limits for
different services. Data.norge allows 10 search requests per minute but 5 resource lookups per
second, so those get separate budgets and neither throttles the other:

```ts
console.log(providers["data-norge"].rateLimit?.default.requests); // 10 per minute (search)
console.log(providers["data-norge"].rateLimit?.resource.requests); // 5 per second (lookups)
```

Set `rateLimit: { enabled: false }` only when your traffic is already bounded elsewhere, such as
behind your own scheduler or a shared gateway.

See [Architecture](docs/architecture.md) for implementation details.

## Documentation

```mermaid
flowchart LR
  App[Developer application]
  Facade[NorwayOpenData facade]
  Adapters[Provider adapters]
  Core[HTTP, validation, retry and cache]
  APIs[Public-sector APIs and documented third-party API]

  App --> Facade
  Facade --> Adapters
  Adapters --> Core
  Core --> APIs
```

- The facade creates all service namespaces with one shared configuration and cache.
- Provider adapters own request construction, runtime schemas and safe normalization.
- The shared core handles timeout, cancellation, retries, errors and caching.
- Provider-specific semantics are preserved instead of forced into one universal model.

- [Hosted API reference](https://iamkm1.github.io/Norway-Open-Data/) — every exported class, method and type
- [Complete API capabilities](docs/capabilities.md)
- [Examples](docs/examples.md)
- [Architecture](docs/architecture.md)
- [Provider access, licences and attribution](PROVIDERS.md)
- [Adding a provider](docs/adding-a-provider.md)
- [API stability](docs/api-stability.md)
- [Testing](docs/testing.md)
- [Contributing](CONTRIBUTING.md)

Generate the TypeDoc API reference locally with:

```bash
pnpm run docs
```

TypeDoc writes to `docs/api`; open `docs/api/index.html`. The same reference is published at
https://iamkm1.github.io/Norway-Open-Data/ and is redeployed on demand through the Pages workflow.

## Testing

```bash
pnpm test
pnpm test:coverage
```

Live tests are opt-in representative contract probes against the supported public-sector APIs and
the third-party electricity endpoint:

```bash
NORWAY_OPEN_DATA_APPLICATION_NAME=my-application \
NORWAY_OPEN_DATA_CONTACT_EMAIL=developer@example.no \
pnpm test:live
```

PowerShell:

```powershell
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "my-application"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "developer@example.no"
pnpm test:live
```

See [Testing](docs/testing.md) for live-test coverage, smoke tests and CI behavior.

## Contributing

Development requires Node.js 22+ and pnpm 10:

```bash
pnpm install
pnpm verify
```

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. User-visible changes require
a Changeset:

```bash
pnpm changeset
```

## Licence

The SDK source code is available under the [MIT Licence](LICENSE). MIT does not automatically apply
to returned data: every provider or dataset retains its own terms, licence, traffic limits and
attribution requirements. Users must follow those terms when using or redistributing data.

Hva koster strømmen? is an independent third-party service. Its API page describes ENTSO-E as the
electricity-data source and Norges Bank as the exchange-rate source; see [PROVIDERS.md](PROVIDERS.md)
for the documented lineage and attribution notes.

**Norway Open Data SDK is an independent open-source project. It is not affiliated with, sponsored
by or endorsed by Norwegian public authorities.**

Personal and restricted data are outside the project scope.

## Known limitations

- The SDK needs a spec-compliant `fetch` and a full-ICU `Intl`; runtimes built without full ICU
  cannot format the Europe/Oslo values the electricity, hazard and profile paths rely on.
- Browser use is limited by each provider's CORS policy, which the SDK cannot change.
- Upstream API contracts and response shapes can change independently of the SDK.
- Some providers require caller identification, a contact email or a free API key.
- Address-profile warning matches use exact structured administrative areas but still never
  constitute an all-clear; use the complete official Varsom/NVE services for safety decisions.
- Address-profile roads are first-page bounding-box candidates, not a circular distance query;
  inspect `roadSearch` for the exact bounds and truncation state.
- The electricity namespace depends on a third-party derived API rather than an official
  government endpoint.
- The optional cache is in-process only and is not shared or persistent.
- Protected endpoints, personal data, write operations and delegated authentication are not
  supported.

See [PROVIDERS.md](PROVIDERS.md) for provider-specific limits, licences and caveats.
