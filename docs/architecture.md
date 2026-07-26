# Architecture

Norway Open Data SDK is a portable TypeScript library that calls Norwegian public-sector APIs
directly. It also supports the documented third-party Hva koster strømmen? electricity API, which
derives EUR price data from ENTSO-E and converts it to NOK using a Norges Bank exchange rate. The
SDK has no hosted backend, database, account system, scraper, or data warehouse.

The 0.8.0 public surface has 118 methods across 22 namespaces, backed by 19 official
service integrations from 15 public-sector organizations plus one third-party integration.
Organization and integration counts are intentionally separate: one organization can operate
independently governed services with different API contracts.

## Public facade

`NorwayOpenData` constructs one client per public namespace. All clients share a single HTTP
client and optional in-memory cache:

```text
NorwayOpenData
├─ companies / statistics / klass / addresses / places
├─ transport / weather / catalog / currency / parliament / roads
├─ energy / hazards / ais / marine / fisheries / electricity
├─ geodata / environment / land
└─ profiles
        │
        └─ HttpClient → retry, timeout, cancellation, rate limits, cache, Zod validation
```

Provider clients own request construction and normalization. The shared layer deliberately does
not force unrelated provider records into one universal data model. Every successful call uses
`OpenDataResponse<T>` and identifies its source, including licence and attribution metadata when
the provider registry declares them.

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

SSB is one organization represented by two service adapters: `ssb` for the PxWeb statistics API
and `ssb-klass` for the Klass classification API. Their independently governed contracts,
endpoints, response schemas, cache policies and request budgets stay separate. Klass validates
every consumed response strictly and reports malformed successful responses as
`ResponseValidationError`.

## Geospatial boundary

The geospatial support is deliberately smaller than a general GIS framework. `src/core/geojson.ts`
defines strict, portable two-dimensional WGS84 shapes for Point, MultiPoint, LineString, Polygon,
MultiPolygon, polygon holes, null geometry, feature ids and feature collections. Non-finite or
out-of-range coordinates, open or degenerate rings, unsupported geometry kinds and unsupported CRS
declarations fail runtime validation. The original accepted CRS declaration is retained alongside a
normalized identifier.

Caller-facing points and boxes reuse the existing `Coordinates` and `BoundingBox` contracts.
GeoJSON positions are `[longitude, latitude]`. Naturbase and NIBIO ask their fixed upstream services
to convert source data to WGS84, then validate that output; their result also carries `sourceCrs`.
The SDK has no reprojection engine and never guesses that projected values are longitude/latitude.

`src/core/feature-page.ts` maps ArcGIS offsets, WFS `startIndex` values and already-validated OGC
continuation markers onto one bounded page contract. An explicit item budget, a maximum 1,000-item
provider page, a maximum 100-page walk and a 10,000-feature hard ceiling prevent accidental bulk
downloads. The walker propagates `AbortSignal`, reports truncation, rejects oversized or empty
endless pages, and detects repeated cursors and repeated page contents.

Protocol details and URL trust stay inside provider adapters. Geonorge may describe a WFS, WMS, OGC
API Features, ArcGIS REST or download URL, but the catalogue client returns it as metadata only.
The feature-page helper never follows a URL, and the public API accepts no arbitrary upstream URL.
WMS rendering, capability traversal and a generic query engine remain out of scope.

## Cross-provider profiles

`profiles.company()` composes Brønnøysundregistrene and Kartverket when a deterministic address
match is available. `profiles.address()` starts with one Kartverket address and can add MET
conditions, NVE warning summaries and NVDB road candidates. `profiles.natureAtLocation()` runs five
bounded Naturbase/NIBIO lookups and one Kartverket place lookup independently. Enrichments that
require missing caller identification are omitted instead of failing the base result.

Every profile carries a `components` entry for each operation it used or deliberately skipped. An
`available` entry records the operation, logical section, provider source, SDK operation-resolution
time and cache state. That timestamp includes cache hits and is not the original upstream fetch
time. Warning components carry the service-specific Varsom attribution for their feed. An
`omitted` entry records its provider source and one of `not-configured`, `missing-coordinate`,
`not-applicable`, `not-found`, `not-covered` or `provider-error`. Provider errors retain only a
sanitized error name and message. The composite response is marked cached only when every provider
call included in it was served from cache.

The response envelope separates composition identity from provider provenance. Its top-level
`source` is a synthetic profile descriptor; established profiles retain their existing descriptor
values for compatibility. `sources` is derived from successful components and contains their real
provider descriptors. Deduplication compares the complete descriptor rather than only its provider
id, so feeds with different licence or mandatory attribution text remain separate. Per-operation
detail remains in `components`; a multi-provider profile is never attributed wholesale to the first
provider.

Address-profile warning discovery uses only structured NVE municipality/county data. An explicit
municipality is matched by official code, then exact case-insensitive, NFC-normalized name. County
matching is used only when the warning has no municipality list, because NVE can include a parent
county as context. Forecast-region names and the backwards-compatible flattened `regions` list are
not automatic match inputs.
`hazardMatches` preserves the matching field and both sides of the administrative evidence.

The optional `roads` array is the first NVDB page intersecting a WGS84 bounding box, not a circular
distance-filtered result. `roadSearch` reports that box, its approximate 250-metre half-size, the
requested page size and whether NVDB advertised another page. An empty warning match is never an
all-clear, and road candidates are not a proximity guarantee. Safety users must query the complete
official Varsom/NVE services directly and follow their current guidance.

`profiles.municipality()` does not automatically rewrite historical municipality codes. Callers
resolve administrative codes explicitly with `klass.resolveMunicipalityCode()` or
`klass.resolveCountyCode()`, inspect every official match and warning, and then decide whether a
profile lookup is appropriate. This avoids silently choosing among merges, splits and ambiguous
correspondences or implying statistical comparability across administrative boundaries.

`profiles.natureAtLocation()` uses a synthetic top-level profile source and retains each successful
component's actual provider descriptor in `sources` and `components`. A failed environmental, land or
place operation becomes a sanitized component warning while successful sections survive; caller
abort remains a rejection. Each feature section also keeps its own paging metadata, and truncation
produces an explicit warning. The optional municipality is context inferred from the nearest official
place name, not a separate administrative-boundary lookup.

## Auto-pagination

Fourteen list methods expose bounded async generators. The existing `companies.searchAll()`,
`catalog.searchAll()`, `parliament.searchCasesAll()`, `roads.searchRoadObjectsAll()` and
`roads.getRoadNetworkAll()`, `fisheries.searchVesselsAll()` and
`fisheries.searchAquacultureSitesAll()` are joined by `geodata.searchDatasetsAll()`,
`geodata.searchServicesAll()`, the four `environment.iterate*()` methods and
`land.iterateLandResources()`.

The ordinary list iterators accept `maxItems` and `maxPages`; the spatial iterators use the feature
query's `limit`, `pageSize`, `maxPages` and `offset`. All request the next page only when iteration
advances, and the 100-page cap prevents a provider contract change from creating an unbounded
request loop. Cursor-based walks retain every requested marker and raise `ResponseValidationError`
before requesting an already-seen marker. Feature walks also fingerprint non-empty pages, protecting
offset-based services that ignore a requested offset.

Klass uses explicit page requests rather than another async generator. Classification list and
metadata-search endpoints are paged by Klass itself. Version lists, codes, code changes and
correspondence payloads are unpaged upstream, so the adapter validates the complete provider
payload and then applies bounded SDK-local paging with a maximum page size of 100. Response
pagination metadata identifies whether `upstreamPaged` is true. A fixed correspondence table has no
separate item endpoint, so callers cannot stream its entries from Klass.

## Formats

The shared HTTP client validates both JSON and text responses. Text support exists for official
formats such as Norges Bank SDMX CSV and Data.norge publisher RDF/Turtle. Provider adapters parse
those formats into explicit intermediate structures before normalization. Dynamic fields, such as
NVDB road-object properties, use `unknown` and are never accepted through `any`.

The `electricity` adapter validates the third-party JSON response independently and keeps that
source classification and attribution separate from the official public-sector providers. It
requires the ordered elapsed-hour sequence and valid provider end boundaries for the requested
Europe/Oslo day, so ordinary days have 24 entries and daylight-saving changes have 23 or 25.
Normalized interval ends use the next start or following local midnight; optional `raw` data
preserves provider-native end timestamps.

## Provider descriptors

Each independently governed service integration declares itself once, in
`src/providers/<provider>/provider.ts`, as a `ProviderDescriptor`: legal metadata, how a caller
identifies itself, how often the service may be called, and how long each class of response stays
fresh. An organization may therefore have more than one descriptor when it operates APIs with
independent contracts. SSB uses `ssb` for PxWeb and `ssb-klass` for Klass while remaining one
public-sector organization. `src/providers/registry.ts` collects the descriptors and derives the
`ProviderId` union from its own keys, with a signature that refuses to compile when a registry key
and a descriptor `id` disagree. One spelling of an identifier therefore reaches error messages,
response `source.id`, cache keys and the `credentials` configuration.

The core reads descriptors and never special-cases a provider. Requests carry the descriptor itself
rather than a provider name, so a typo is a type error rather than a misleading error message.
Adding a provider means writing its folder and adding one registry line; no file under `src/core/`
changes.

`providers` exposes the documented subset of every descriptor. The behavioural fields — header
builders and cache lifetimes — stay internal.

## Caching

Caching is disabled by default. When enabled, provider methods supply TTLs appropriate to their
update cadence, named per operation class on the descriptor. `cache.ttlMs` can override those
recommendations globally. Cache bypass skips both reads and writes, and unsuccessful responses are
never cached. Cache keys include the expected response representation and `Accept` value so JSON and
text variants of one URL cannot collide.

Storage is pluggable. The default `MemoryCache` is a bounded TTL/LRU cache private to one SDK
instance; a caller-supplied `CacheStore` can share validated responses across instances or
processes and then owns expiry and eviction. Reads and writes are awaited either way.
`NorwayOpenData.clearCache()` resolves once the backing store has cleared, without exposing
internal keys or values.

All Klass operation classes recommend a 24-hour TTL because classification metadata and historical
tables change slowly. This remains optional, in-process caching by default; enabling it does not add
persistent storage.

## Request budgets

Every descriptor may declare a `rateLimit`. Enforcement is on by default: one sliding-window
limiter per provider is shared by all clients on a `NorwayOpenData` instance, and admission is
serialized so concurrent callers cannot observe the same free slot and overshoot together.

Budget is consumed per network attempt, so a retry pays for itself and a cache hit pays nothing.
Waiting happens before the request timeout is armed, so a queued request is not charged for time
spent waiting its turn, and a caller's `signal` rejects a waiting request immediately.

`basis` records whether a number is `provider-documented` or an `sdk-courtesy` budget chosen for a
provider that publishes none.

Budgets are scoped to service descriptors, not organizations. SSB PxWeb retains its documented
budget, while SSB publishes no numeric Klass rate limit. The `ssb-klass` descriptor therefore uses
an explicit SDK-courtesy budget of 30 requests per minute; it is not presented as official SSB
guidance.

## Identification and credentials

- Entur and NVDB require a meaningful application identifier.
- MET Norway requires an application identifier and monitored contact email.
- NVE energy and warning feeds are anonymous.
- NVE HydAPI station and observation methods require `credentials.nve.apiKey` from free
  registration.
- Geonorge catalogue, the selected Naturbase layers and NIBIO AR50 are anonymous and introduce no
  credentials or environment variables.

These requirements are declared on each descriptor rather than implemented per client. A descriptor
names the configuration values it needs and builds its own headers from them; the HTTP client
verifies the values are present and raises `ConfigurationError` with the provider's own instructions
before any network access. Cross-provider profiles ask the same question to decide whether to skip a
section as `not-configured` rather than failing the whole composition.

`credentials` is keyed by provider id, so a new credentialled provider needs no configuration
change in the core, and an unknown provider key is rejected rather than silently ignored.
Credentials remain instance configuration. They are never embedded in source, fixtures, examples,
generated documentation, or package artifacts.

## Compatibility

`tsup` produces ESM, CommonJS, TypeScript declarations, and source maps from the same public entry
point. Consumer code imports only `norway-open-data-sdk`; internal source paths are unsupported.
