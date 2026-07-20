# Architecture

Norway Open Data SDK is a Node.js TypeScript library that calls official Norwegian public-data
APIs directly. It has no hosted backend, database, account system, scraper, or data warehouse.

## Public facade

`NorwayOpenData` constructs one client per public namespace. All clients share a single HTTP
client and optional in-memory cache:

```text
NorwayOpenData
├─ companies / statistics / addresses / places
├─ transport / weather / profiles
├─ catalog / currency / parliament / roads
└─ energy / hazards
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

Provider additions require mocked fixtures, unit tests, an opt-in low-volume live check, public
exports, examples, metadata, attribution notes, and smoke-test coverage.

## Formats

The shared HTTP client validates both JSON and text responses. Text support exists for official
formats such as Norges Bank SDMX CSV and Data.norge publisher RDF/Turtle. Provider adapters parse
those formats into explicit intermediate structures before normalization. Dynamic fields, such as
NVDB road-object properties, use `unknown` and are never accepted through `any`.

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
