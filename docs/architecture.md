# Architecture

Norway Open Data SDK is a Node.js TypeScript library that calls Norwegian public-sector APIs
directly. It also supports the documented third-party Hva koster strømmen? electricity API, which
derives EUR price data from ENTSO-E and converts it to NOK using a Norges Bank exchange rate. The
SDK has no hosted backend, database, account system, scraper, or data warehouse.

## Public facade

`NorwayOpenData` constructs one client per public namespace. All clients share a single HTTP
client and optional in-memory cache:

```text
NorwayOpenData
├─ companies / statistics / addresses / places
├─ transport / weather / profiles
├─ catalog / currency / parliament / roads
└─ energy / hazards / electricity
        │
        └─ HttpClient → retry, timeout, cancellation, rate limits, cache, Zod validation
```

Provider clients own request construction and normalization. The shared layer deliberately does
not force unrelated provider records into one universal data model. Every successful call uses
`OpenDataResponse<T>` and identifies its source.

`includeRaw` exposes the validated provider representation, not an unfiltered network payload.
Adapters allowlist or sanitize fields where provider responses can contain unsupported personal or
sensitive metadata. In particular, Stortinget representative extras and sensitive NVDB catalogue
types/properties cannot be recovered through `raw`.

## Provider adapters

Each adapter is kept under `src/providers/<provider>/` and normally contains:

- `types.ts` for the public TypeScript contract;
- `schemas.ts` for provider-native Zod runtime validation;
- `client.ts` (or focused clients) for request construction and normalization;
- `index.ts` for provider-local exports.

See [Adding a provider](adding-a-provider.md) for adapter structure, validation, privacy, testing,
documentation and review requirements.

## Cross-provider profiles

`profiles.company()` composes Brønnøysundregistrene and Kartverket when a deterministic address
match is available. `profiles.address()` starts with one Kartverket address and can add MET
conditions, NVE warning summaries and nearby NVDB road segments. Enrichments that require missing
caller identification are omitted instead of failing the base address result.

Address-profile hazard matches are deliberately best-effort discovery. NVE hydrological and
avalanche regions do not map one-to-one to municipalities, so the adapter compares published area
names and can miss relevant warnings. An empty `hazards` array is never an all-clear. Safety users
must query the complete official Varsom/NVE services directly and follow their current guidance.

## Auto-pagination

Five list methods expose bounded async generators: `companies.searchAll()`,
`catalog.searchAll()`, `parliament.searchCasesAll()`, `roads.searchRoadObjectsAll()` and
`roads.getRoadNetworkAll()`. Shared pagination helpers follow either numbered pages or opaque NVDB
continuation markers and request the next page only when iteration advances. `maxItems` and
`maxPages` stop a walk early. `maxItems` must be a non-negative integer; `maxPages` must be an
integer from 1 to 100 and defaults to 100 so a provider contract change cannot create an unbounded
request loop.

## Formats

The shared HTTP client validates both JSON and text responses. Text support exists for official
formats such as Norges Bank SDMX CSV and Data.norge publisher RDF/Turtle. Provider adapters parse
those formats into explicit intermediate structures before normalization. Dynamic fields, such as
NVDB road-object properties, use `unknown` and are never accepted through `any`.

The `electricity` adapter validates the third-party JSON response independently and keeps that
source classification and attribution separate from the official public-sector providers.

## Caching

Caching is disabled by default. When enabled, provider methods supply TTLs appropriate to their
update cadence. `cache.ttlMs` can override those recommendations globally. Cache bypass skips both
reads and writes, and unsuccessful responses are never cached. Cache keys include the expected
response representation and `Accept` value so JSON and text variants of one URL cannot collide.

## Identification and credentials

- Entur and NVDB require a meaningful application identifier.
- MET Norway requires an application identifier and monitored contact email.
- NVE energy and warning feeds are anonymous.
- NVE HydAPI station and observation methods require `credentials.nve.apiKey` from free
  registration.

Credentials remain instance configuration. They are never embedded in source, fixtures, examples,
generated documentation, or package artifacts.

## Compatibility

`tsup` produces ESM, CommonJS, TypeScript declarations, and source maps from the same public entry
point. Consumer code imports only `norway-open-data-sdk`; internal source paths are unsupported.
