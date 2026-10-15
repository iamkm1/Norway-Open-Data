# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning.

## 0.9.0 — 2026-10-15

### Minor Changes

- **Weather and Climate Norway.** Expands `weather` from one product to seven and adds two
  namespaces, two official service integrations and a cross-provider conditions profile. The
  surface grows from 118 to 135 methods across 24 namespaces, backed by 21 official service
  integrations from the same 15 public-sector organizations, plus one third-party API.

  **`sdk.weather` — six more MET Norway products.** `forecast()` and `current()` are unchanged.

  - `getWarnings()` returns MET Norway's current official weather warnings from MetAlerts 2.0:
    wind, gale, rain, snow, ice, icing, storm surge, forest-fire danger, lightning and polar lows.
    With a coordinate, MetAlerts itself decides which warning areas contain the point; other
    filters narrow by county, event, land or marine domain and risk colour, in Norwegian or English.
    Each warning keeps its awareness level and colour, CAP severity, certainty and message type
    (including cancellations), named extreme-weather incidents, the counties and municipalities it
    names, its validity window and its area as validated GeoJSON. An empty list is never an
    all-clear, and flood, landslide and avalanche warnings remain NVE's, in `hazards`.
  - `getNowcast()` returns the radar-based precipitation nowcast for roughly the next two hours in
    five-minute steps, with current conditions and the radar status.
  - `getSunTimes()` and `getMoonTimes()` return rise, set, culmination and moon phase in the
    Europe/Oslo offset for the requested date. A day with neither sunrise nor sunset reports
    `polarCondition` as `midnight-sun` or `polar-night` rather than leaving the gap unexplained.
  - `getOceanForecast()` returns sea temperature, wave height and direction, and surface current for
    the nearest ocean-model cell.
  - `getAirQualityForecast()` returns the hourly air-quality index and NO₂, PM10, PM2.5 and O₃
    concentrations for the statistical area containing a point. **Experimental:** MET Norway
    publishes the product as version 0.1. Concentrations in an unexpected unit are rejected rather
    than mislabelled.

  A point outside a product's coverage resolves to `undefined` rather than raising: the nowcast
  outside the Nordic radar area (which excludes Svalbard), the ocean forecast inland and offshore,
  and the air-quality forecast outside Norway. Each case was verified against the live service.

  **`sdk.tides` — Kartverket's Hydrographic Service.** `listStations()`, `getWaterLevels()`,
  `getTideTable()` and `getReferenceLevels()` for the Norwegian coast. Water levels return
  observation, astronomical prediction, weather effect (surge) and forecast series, with the
  forecast's uncertainty band, the reference level they are measured from, Kartverket's quality
  assessment and any service notice. Every result states which reference station the values were
  modelled from, with its amplitude factor and time delay, and which permanent gauge supplied the
  weather effect, because away from a gauge the values are modelled rather than measured. Inland and
  far-offshore positions resolve to `undefined`. Windows are bounded per request (7 days at
  10-minute resolution, 31 days hourly, 366 days for tide tables) well inside the provider's own
  limit, and times are requested and returned in UTC. Anonymous; CC BY 4.0 with a mandatory credit
  to the Hydrographic Service.

  **`sdk.climate` — MET Norway Frost.** `searchStations()` (by ID, name, municipality, county,
  element or nearest to a point), `getAvailableTimeSeries()`, `getObservations()`,
  `getLatestObservations()` and `getClimateNormals()`. Requires a free Frost client ID, configured
  as `credentials["met-frost"].clientId` and sent as the HTTP Basic username. Observation windows
  are bounded to 31 days, or 366 days when every requested resolution is daily or coarser, and use
  Frost's recommended default time offsets and sensor levels unless overridden. A query Frost has no
  data for resolves to an empty array, because Frost answers HTTP 404 or 412 for both "no data" and
  "no such station". Frost's station-holder names are withheld at the validation boundary, so they
  reach neither `data`, `raw` nor the cache. **Experimental:** the schemas follow Frost's published
  Swagger models; no Frost client ID was available to verify them against the live service, and
  the opt-in live probes do so once `MET_FROST_CLIENT_ID` is configured.

  **`places.getMunicipalityAt()` — Kartverket Kommuneinfo.** Resolves a coordinate to the
  municipality and county whose official boundary contains it, or `undefined` at sea and abroad.
  This is an administrative-boundary lookup, not an inference from nearby place names.

  **`profiles.conditionsAtLocation()` — a cross-provider conditions profile.** Answers "what are
  conditions here?" for one coordinate from MET Norway, NVE, Kartverket, the Hydrographic Service and,
  when configured, Frost: forecast, nowcast, MET warnings, NVE warnings matched to the municipality
  from `getMunicipalityAt()`, sun times, ocean forecast, tide table, air quality, and the latest
  observations at the nearest active weather station beside its 1991–2020 monthly temperature
  normal. Each of its 14 operations reports its own provenance or why it is absent —
  `not-configured`, `not-covered`, `not-applicable`, `not-found` or `provider-error` — and a missing
  section never removes another. NVE warnings are only requested once the municipality is known, and
  a distant weather station or degraded radar coverage produces an explicit notice. **Experimental.**

  **Shared infrastructure.** A request can now declare which non-success responses mean "the
  provider has nothing for this subject", optionally matched on body text, and those are handed to
  the schema as `null` exactly as HTTP 204 already was. A small strict XML reader parses the tide
  API: it refuses document type declarations outright, so entity-expansion and external-entity
  attacks have nothing to work with, decodes only the predefined and numeric entities, and bounds
  input size and nesting depth. Time windows are validated once, require an explicit offset, and are
  refused rather than silently reinterpreted.

  **Scope and verification.** Every MET, Kartverket and tide method was verified against the live
  services, including polar day and night, points outside each model area, inland and offshore tide
  positions, and the provider's in-band XML errors. 2,640 current and archived MetAlerts geometries
  validate against the SDK's strict GeoJSON schemas. Measured air quality from NILU is not included:
  its measurement endpoints now require authentication and its lookups have been withdrawn.

### Patch Changes

- `ProviderCredential.clientId` documentation now covers Frost, which takes the client ID as an
  HTTP Basic username rather than exchanging it at an OAuth2 token endpoint.
- The conformance suite holds four more operations to the shared contract, and a Basic credential
  may only ever be sent to `frost.met.no`.

## 0.8.0 — 2026-07-26

### Minor Changes

- **Geospatial Norway.** Adds three anonymous, experimental namespaces for focused catalogue,
  environmental and land-resource use. The SDK deliberately remains a curated data client rather
  than a general GIS proxy.

  **`sdk.geodata` — Geonorge / Kartverket catalogue.** `searchDatasets()` and `searchServices()`
  return bounded, deterministically ordered metadata results; `searchDatasetsAll()` and
  `searchServicesAll()` expose caller-bounded async iterators. `getMetadata()`, `getDataset()` and
  `getService()` normalize publisher, themes, licence, geographic extent, update metadata,
  distributions and related services. Discovery classifies WFS, WMS, OGC API Features, ArcGIS REST,
  downloadable files and other published links, but the SDK never follows a discovered URL or
  grants access to the resource behind it.

  **`sdk.environment` — Miljødirektoratet / Naturbase.** Adds point lookups, bounding-box searches
  and lazy bounded iterators for current protected areas, proposed protected areas, modern NiN
  nature localities and the January 2023 intervention-free nature status. The integration is
  intentionally limited to these useful public vector layers instead of exposing every map layer.

  **`sdk.land` — NIBIO AR50.** Adds point lookup, bounding-box search and a bounded iterator for the
  open generalized AR50 land-resource classification. Restricted agreement-based Geovekst AR5,
  parcel-precision data and soil/cultivation-suitability products are not included.

  **`profiles.natureAtLocation()` — a partial cross-provider nature profile.** Composes all five
  Naturbase/NIBIO datasets with the nearest official Kartverket place and municipality context.
  Each operation retains its real source, retrieval time and attribution. Provider failures degrade
  to component warnings without removing successful sections; caller cancellation still rejects
  the complete call.

  **Profile-source compatibility and provenance.** Existing `profiles.company()`,
  `profiles.address()`, `profiles.municipality()` and `profiles.vessel()` responses retain their
  synthetic top-level composite source identities. The new nature profile also uses a synthetic
  top-level source so a multi-provider result is not attributed to only one provider. The additive
  `sources` array is derived from successful components and carries their real provider descriptors,
  preserving separate entries when licence or mandatory attribution text differs; `components`
  retains per-operation provenance.

  **Strict shared GeoJSON and bounded feature paging.** Adds runtime validation for two-dimensional
  WGS84 Point, MultiPoint, LineString, Polygon, MultiPolygon, polygon holes, null geometry, feature
  identifiers, feature collections and CRS declarations. Naturbase and NIBIO request server-side
  WGS84 output while retaining the advertised source CRS. Unsupported CRS declarations are rejected;
  the SDK does not silently reinterpret coordinates and includes no client-side reprojection engine.
  Feature searches default to 100 results, expose truncation and continuation metadata, propagate
  `AbortSignal`, and stop repeated cursors, repeated pages and empty endless pages.

  **Scope and verification.** WMS image rendering, arbitrary caller-supplied upstream URLs,
  restricted datasets and full-country downloads remain out of scope. Deterministic offline tests
  cover geometry, CRS, ArcGIS/WFS/OGC paging, truncation, attribution and partial profiles; bounded
  anonymous live probes are opt-in through the existing `RUN_LIVE_TESTS` switch. No new credentials
  or environment variables are required.

## 0.7.0 — 2026-07-26

### Minor Changes

- **Maritime Norway.** Adds three namespaces, two new public-sector organizations and four official
  API integrations, plus the transport infrastructure they needed.

  **`sdk.ais` — BarentsWatch AIS.** Vessel positions and identity, recorded tracks, area search,
  name search, the published coverage area, and live AIS streaming.

  - `getTrackLast24Hours()` and `getTrack()` return recorded position reports for one vessel.
  - `getVesselSnapshot()` and `getVesselSnapshots()` merge each vessel's latest position with its
    latest static data, so name, call sign, IMO number and dimensions arrive in one request.
  - `getLatestPositions()` returns a point-in-time snapshot; `getMmsiInArea()` lists the MMSIs seen
    in a window of space and time; `searchVessels()` searches recent AIS static data by name.
  - `getCoverageArea()` returns the sea area BarentsWatch actually publishes, so a caller can tell
    "no data for this vessel" apart from "outside the feed".
  - `streamPositions()` and `streamMessages()` return an `AsyncIterable`, so a live feed is an
    ordinary `for await` loop. The connection opens on the first iteration, and leaving the loop or
    aborting the signal closes it. `streamMessages()` yields a union discriminated by `kind`.
  - Every field each documented message shape declares is validated and surfaced, including all 36
    fields of the met/hydro binary broadcast and the receiver-network label carried by every
    message. A streamed message has no accompanying raw payload, so a field dropped in
    normalization would be unrecoverable. BarentsWatch publishes no units for the met/hydro
    payload, so those values are passed through unconverted and no unit is asserted for them.
  - Message labels are matched case-insensitively. The live service sends `Staticdata` where the
    provider's documentation writes `StaticData`, and the numeric AIS message type remains a second
    fallback, so a static-data message is never surfaced as `kind: "unknown"`.

  **`sdk.marine` — BarentsWatch wave and current forecasts.** `getWaveForecast()`,
  `getWaveForecastSeries()` and `getSeaCurrent()`. A coordinate outside every model area resolves to
  `undefined` rather than raising, so "no model covers this point" stays distinguishable from a
  provider failure. The series endpoint expresses that same absence in two ways — HTTP 204, and
  HTTP 200 with one value-free entry per model time — and both are surfaced as an empty array, so
  an uncovered coordinate does not arrive looking like a covered one with dozens of readings.
  `{ includeRaw: true }` still exposes the provider's untouched payload.

  **`sdk.fisheries` — Fiskeridirektoratet.** The fishing-vessel register and the public aquaculture
  register, both open and needing no credentials: `searchVessels()`, `searchVesselsAll()`,
  `getVessel()`, `searchAquacultureSites()`, `searchAquacultureSitesAll()` and
  `getAquacultureSite()`. `getVessel()` accepts a register id, a registration mark or a radio call
  sign, and raises `NotFoundError` both when nothing matches and when more than one vessel does.

  **`profiles.vessel()` — a cross-provider vessel profile.** Composes BarentsWatch AIS with the
  Fiskeridirektoratet vessel register, MET Norway and Kartverket, joined on the radio call sign,
  which is the one identifier AIS and the register both publish. Every section reports why it is
  present or absent, and two new `ProfileOmissionReason` values distinguish the cases that mattered:
  `not-found` (the provider was searched and holds no matching record) and `not-covered` (the
  provider answered and publishes nothing for this subject). An `ais.status` of `no-recent-data`
  never means the MMSI is unassigned.

  **Reusable OAuth2 client-credentials support** in the transport layer, declared per provider and
  configured as `credentials.<provider>.clientId` and `clientSecret`. Tokens are acquired on first
  use, cached in memory per SDK instance, refreshed before their stated expiry with a minute of
  headroom for clock skew, and shared by concurrent requests through a single in-flight request. A
  token the provider rejects with HTTP 401 is discarded rather than replayed, and one caller aborting
  does not cancel a token request the others are waiting on. Tokens are never written to the response
  cache or any persistent store, there is no hosted proxy, and secrets, client ids and tokens are
  redacted from errors and never logged.

  **A web-standard NDJSON stream parser** returning `AsyncIterable<T>`, built on `ReadableStream`,
  `TextDecoder` and `AbortSignal` with no Node stream dependency. Records split across chunks are
  reassembled, several records in one chunk are all emitted, blank lines and `\\r\\n` endings are
  handled, a final record without a trailing newline is emitted, every record is validated
  independently, a configurable maximum buffered-record size bounds a stream that never sends a
  newline, and the reader is released when iteration stops early. Backpressure is preserved: a chunk
  is read only when the consumer asks for the next record.

  **Shared geographic primitives.** `Coordinates` and `BoundingBox`, with their Zod schemas and a
  `boundingBoxToPolygon()` helper, exported from the package root. Latitude and longitude ranges are
  enforced, non-finite values are rejected, `north` must exceed `south`, and a box crossing the
  antimeridian is refused with an explicit message rather than silently returning nothing — no
  provider in this SDK publishes data there.

  **`ProviderCredential` gains `clientId` and `clientSecret`**, and `ProviderAuthField` gains the
  matching members. These are additive; existing `apiKey` configuration is unchanged.

  **BarentsWatch needs two separate credentials.** BarentsWatch issues two kinds of self-registered
  client and a secret registered for one is not accepted by the other, so `ais` and `marine` are
  declared as separate providers: `credentials["barentswatch-ais"]` (an AIS-client, `ais` scope) and
  `credentials.barentswatch` (an API-client, `api` scope).

  Limitations documented rather than papered over: AIS coverage excludes fishing vessels under 15 m
  and leisure vessels under 45 m, is limited to Norwegian waters, and retains 14 days, so an absent
  vessel is never an absent vessel; streams are not reconnected automatically in this release; the
  Fiskeridirektoratet registers report their totals only in a response header the SDK does not read,
  so paging stops at the first short page.

### Patch Changes

- HTTP 204 responses are now handed to a provider's runtime schema as `null` instead of being
  reported as an unreadable payload. This lets a provider that answers "no data for this point" with
  an empty response be modelled as a nullable result. No existing provider returned 204, so no
  existing behaviour changes.

- The vessel register's owner data is filtered during response validation: a private individual's
  name, postal code and town are not carried into SDK output, including `{ includeRaw: true }` and
  cached values, while the owner entry itself is kept as `{ entityType: "person" }` so the ownership
  structure and owner count stay visible. An owner entity type the SDK does not recognize is
  withheld by default.

## 0.6.0 - 2026-07-25

### Minor Changes

- Adds the top-level `sdk.klass` namespace for Statistics Norway's anonymous SSB Klass API.

  - Browse and search classifications, inspect dated versions, list version/date/range code lists,
    retrieve exact codes, and use the provider's official code-pattern syntax.
  - List correspondence-table metadata and page through fixed, dated or ranged correspondence.
    Because Klass does not page these upstream resources, the SDK labels locally bounded pages with
    `pagination.upstreamPaged: false` instead of implying network-level pagination.
  - Resolve historical municipality and county codes through official change graphs. Results retain
    merges, splits, multiple predecessors and successors, mixed-step ambiguity, missing context and
    no-match outcomes; no branch is silently selected.
  - Exports strict runtime-validated types and stable classification IDs for municipalities,
    counties, industry, occupations, education and three country-code systems.
  - Registers `ssb-klass` as a separate service integration from SSB PxWeb while counting Statistics
    Norway as one organization. Klass uses anonymous CC BY 4.0 access, a 24-hour optional in-process
    cache policy and a conservative SDK courtesy request budget.
  - Keeps `profiles.municipality()` behavior backward-compatible. Its current-region lookup has no
    historical date context, so applications resolve historical codes explicitly through `klass`
    and continue only when their own policy accepts the returned relationship.

  SSB Klass does not provide code-name search, upstream paging for code or correspondence payloads,
  or mapping weights in the discovered resources. Missing correspondence is inconclusive, and an
  administrative mapping must not be interpreted as statistical comparability.

## 0.5.3 - 2026-07-24

### Patch Changes

- Fixes two defects in `profiles.municipality()` population handling. No public API or type changes.

  - **Incomplete SSB population years are no longer exposed as complete totals.** SSB returns one cell
    per requested sex and age band, and a suppressed or absent observation arrives as `null`. The
    aggregation previously skipped those `null` cells and summed the rest, so a year missing one or more
    components was published as if it were a finished count — and any year-over-year `change` was then
    computed against that partial figure. Completeness is now tracked per year: a year contributes a
    total only when every one of its cells is numeric. Missing data is treated as unknown, never as
    zero, so an incomplete year is omitted rather than under-reported, `total`/`year` come from the
    newest complete year, and `change` is only ever calculated between two complete years. When no year
    is complete the `population` section is omitted, matching the profile's existing degradation model.
    Fully populated data is unaffected and produces the same totals as before.

  - **Municipality input is validated before any provider request.** An empty or whitespace-only query
    can never resolve, but it previously spent an SSB metadata request to discover that and then failed
    with `NotFoundError`. The query is now trimmed and rejected up front with `InputValidationError`
    before the HTTP client is invoked. A non-empty query behaves exactly as before; only the empty-query
    path changed, and its error type moved from the later `NotFoundError` to `InputValidationError`
    (both extend `OpenDataError`).

## 0.5.2 - 2026-07-23

### Patch Changes

- Fixes two defects in the shared HTTP core and documents an ESM/CommonJS limitation.

  - **A public `applicationName` no longer corrupts provider responses.** Providers that identify the
    caller through a public header — Entur's `ET-Client-Name`, NVDB's `X-Client`, MET Norway's
    `User-Agent` — had that header's value treated as a secret and stripped out of successful payloads
    before validation. An `applicationName` that also occurred in a provider's own data rewrote it: an
    application called `vegvesen` turned NVDB's continuation URL into
    `https://nvdbapiles.atlas.[REDACTED].no/…`, which then failed URL validation and made every
    `roads.getRoadNetwork()` and `roads.getRoadNetworkAll()` call raise `ResponseValidationError`.
    Caller identification is public by design, so it is no longer a redaction target. Genuine secrets
    are unaffected: `contactEmail`, configured `apiKey` values, and `Authorization`, `Cookie` and
    `X-API-Key` header values are still redacted from payloads and errors, and properties named after
    request headers are still dropped.

  - **`Retry-After` is no longer shortened to the backoff cap.** A provider asking for a 30-second
    pause was retried after 5 seconds, because the five-second cap on the SDK's own exponential
    backoff was also applied to the provider's explicit instruction. The two are now distinct: with no
    `Retry-After` the SDK uses capped, jittered backoff as before; with a `Retry-After` of up to one
    minute it waits the stated duration in full; and beyond one minute it stops retrying and raises
    immediately, without waiting first. The existing status-to-error mapping is unchanged there —
    `RateLimitError` for HTTP 429, the usual `ProviderError` for a retryable 5xx — and both now carry
    `retryAfter` in seconds, which is the stable cross-status signal that a provider asked you to wait.
    One minute is the longest sliding window any provider budget uses, so it is the longest pause the
    SDK's own rate limiter can already impose. Cancelling the caller's `signal` still rejects a waiting
    retry immediately. Retryable statuses, attempt counts and every other retry behaviour are
    unchanged.

    This changes timing for callers that hit HTTP 429 or a retryable 5xx carrying `Retry-After`: those
    retries now happen later than before, or surface as an error instead of retrying. That is the
    intended correction.

  - **Mixed ESM/CommonJS error identity is now documented.** When one process loads both published
    builds, an error from one fails `instanceof` against the other build's class, because class
    identity is per-bundle. The README explains this and recommends branching on the stable `name`,
    `provider`, `statusCode` and `retryAfter` fields where an error can cross that boundary. The
    packed-package test now asserts same-build `instanceof` in both builds and verifies the documented
    fallback.

## 0.5.1 - 2026-07-23

### Patch Changes

- Fixes three defects found in the 0.5.0 request-budget and profile code, each now covered by a
  regression test.

  - A request naming a budget the provider never declared was given its own limiter holding a copy of
    the `default` policy, so that budget could be spent twice over per window. The limiter is now keyed
    by the resolved budget name, so an undeclared name shares the provider's `default` limiter as the
    documentation always said it would. Declared budgets such as Data.norge's `resource` stay separate.
  - `profiles.address()` credited NVE in the composed `source` even when all three Varsom warning feeds
    had failed and contributed nothing. An empty `hazards` array alongside an NVE attribution reads as
    an all-clear NVE never issued. NVE is now named only when at least one feed answered, matching the
    behaviour `profiles.municipality()` already had. Callers that need per-feed status continue to read
    `components`.
  - `profiles.municipality()` fetched SSB's table 07459 metadata twice per call: once to resolve the
    municipality and once inside the population query. That spent two requests of SSB's documented
    30-per-minute budget on identical bytes. The metadata is now fetched once and reused, through a new
    `@internal` `SsbClient.queryWithMetadata`; the supported `query()` and `queryRaw()` surface is
    unchanged.

  Also fixes `pnpm check:portability` leaving its generated probe file inside `dist/` when the probe
  process failed, because `process.exit` in the error path pre-empted the cleanup.

## 0.5.0 - 2026-07-23

### Minor Changes

- Providers are now declared once, in one place. Each provider owns a `ProviderDescriptor` under
  `src/providers/<provider>/provider.ts` holding its legal metadata, caller identification, request
  budgets and cache lifetimes, and `src/providers/registry.ts` collects them. The `ProviderId` union
  is derived from the registry's own keys, and the registry refuses to compile when a key and a
  descriptor `id` disagree, so one spelling of an identifier reaches error messages, response
  `source.id`, cache keys and configuration. Requests carry the descriptor rather than a provider
  name, making a mistyped provider a type error instead of a misleading message. Adding a provider now
  means writing its folder and one registry line; no file under `src/core/` changes.

  Caller identification is declarative. A descriptor names the configuration values it needs and
  builds its own headers from them; the HTTP client verifies they are present and raises
  `ConfigurationError` with the provider's own instructions before any network access. The bespoke
  per-client identity plumbing for Entur, MET Norway, NVDB and NVE HydAPI is gone, and cross-provider
  profiles ask the same question to decide whether to skip a section as `not-configured`.

  New: per-provider request budgets, enforced by default. Every provider declares how often the SDK
  may call it, and one sliding-window limiter per budget is shared by all clients on a
  `NorwayOpenData` instance. Admission is serialized so concurrent callers cannot overshoot together.
  Waiting happens before the request timeout is armed, so a queued request is not charged for its
  wait; a cache hit costs no budget, a retry does, and a caller's `signal` rejects a queued request
  immediately. Budgets are named per operation class because providers publish different limits per
  service — Data.norge allows 10 searches per minute but 5 resource lookups per second, and those no
  longer throttle each other. `basis` distinguishes a provider's published number from a conservative
  budget the SDK chose. Disable with `rateLimit: { enabled: false }`.

  New: pluggable cache storage. `cache.store` accepts any `CacheStore` implementing `get`, `set` and
  `clear`, synchronously or asynchronously, so validated responses can be shared across instances,
  workers or hosts instead of being trapped in one process. The default in-memory cache is unchanged.

  Breaking changes. This is a minor release before 1.0, so a `^0.4.1` dependency range will not pick
  it up automatically; upgrade deliberately and read this list first:

  - Per-provider request budgets are enforced by **default**. Code that previously issued unbounded
    bursts now waits instead of failing, which is the intended behaviour but changes timing. Data.norge
    is the tightest at 10 search requests per minute, as that service documents. Opt out with
    `rateLimit: { enabled: false }`.
  - `NorwayOpenData.clearCache()` returns `Promise<void>` so it can await a custom store. Existing
    calls that ignore the result keep working; `await` it when you depend on the cache being empty.
  - `providers` is keyed by provider id rather than a camelCase alias, so `providers.dataNorge` and
    `providers.norgesBank` become `providers["data-norge"]` and `providers["norges-bank"]`. Its values
    are now `ProviderMetadata` rather than literal types, and expose `rateLimit`. Every other key is
    unchanged.
  - `credentials` is keyed by provider id and rejects unknown providers instead of ignoring them.
    `credentials.nve.apiKey` is unchanged.
  - A cancellation that arrives while the cache is being read now rejects before the request is sent
    rather than after. Cancellation semantics are otherwise unchanged.

  Provider rate limits were reconciled against the numbers recorded in `PROVIDERS.md`, and a
  regression test now fails if a documented budget drifts from its descriptor.

## 0.4.1 - 2026-07-23

### Patch Changes

- Documented and verified that the package runs unchanged on Node.js 22+, Deno, Bun,
  Cloudflare Workers and other edge hosts, and in browsers wherever the provider sends
  permissive CORS headers. No runtime API changed and no new capability was added: the
  SDK already used only web-standard APIs, and the previous README claim that browser
  support was not guaranteed was simply inaccurate.

  Distribution now targets ES2022 on esbuild's neutral platform rather than `node22`;
  the ESM output is byte-identical and the CommonJS output is marginally smaller.
  `exports` gains a trailing `default` condition so resolvers matching neither `import`
  nor `require` still reach the ESM build, which can only widen resolution.

  Portability is now enforced rather than assumed. `pnpm check:portability` scans the
  built bundles for any Node built-in reference and exercises the request, cache,
  validation, error and cancellation paths against an object implementing only the
  standard `Response` surface; it runs as part of `pnpm verify`. CI additionally
  executes the built package on real Deno and Bun runtimes on every change.

  Host runtimes must supply a spec-compliant `fetch`, `structuredClone` and a full-ICU
  `Intl` for Europe/Oslo dates and Norwegian locale casing. The README documents this
  in a new "Runtime support" section.

## 0.4.0 - 2026-07-23

### Minor Changes

- New `profiles.municipality()` composition answers one municipality from SSB, FHI,
  Brønnøysundregistrene and NVE in a single call. It resolves a four-digit municipality
  code or an exact municipality name against SSB's region register (counties and the
  whole-country region never resolve, and duplicated names such as Herøy require SSB's
  county-qualified label), then adds SDK-aggregated population totals for the two newest
  years, FHI life expectancy at birth with suppression flags preserved, the registered
  organization count from Brønnøysundregistrene, and exact NVE warning matches. Every
  optional section degrades to a `provider-error` component instead of failing the call.

## 0.3.0 - 2026-07-22

### Minor Changes

- New `health` namespace for the FHI Statistikk open API: `getSources`, `getTables`,
  `getTableMetadata`, `getTableDimensions`, `query` and `queryRaw` cover source and
  table discovery, provider-authored documentation, hierarchical dimensions and
  JSON-stat2 data queries across Norwegian health registers. FHI's cell-suppression
  flags are preserved rather than hidden: flagged observations normalize to
  `value: null` with the provider's `flag` symbol, and every result carries FHI's
  flag legend. The JSON-stat parsing core is now shared between SSB and FHI, with
  `parseJsonStat` and `parseTableMetadata` unchanged.
- Cross-provider profiles now degrade optional provider failures to partial results
  instead of failing the whole call. If MET, NVDB or one Varsom warning feed errors
  at request time, `profiles.address()` returns every surviving section and reports
  the failing operation as an omitted component with the new `provider-error`
  reason and a sanitized error name and message; `profiles.company()` likewise
  returns a location-less profile when the Kartverket lookup fails. Required
  operations still throw, and caller cancellation always rejects the whole call.

## 0.2.2 - 2026-07-22

### Patch Changes

- Not-found errors now name the requested resource. Detail lookups such as
  `companies.get`, `catalog.getDataset`, `parliament.getCase`, `roads.getRoadObject`,
  `statistics.getTableMetadata` and `electricity.getPrices` report messages like
  `brreg organization 000000000 was not found.` instead of a generic
  `resource was not found.`, and the electricity message notes when the
  requested day may not be published yet.
- Documentation now covers the points first-time consumers stumbled on: how to
  distinguish caller cancellation from a provider failure (check your own
  `signal.aborted`; the SDK reports both as `ProviderError`), that entity types
  follow provider domain naming (`Company`, `NorwegianAddress`) and are all
  exported from the package root, that normalized exchange rates use
  `baseCurrency`/`quoteCurrency` for the requested `from`/`to` pair, and that a
  profile's `components` is an array with one entry per SDK operation.

## 0.2.1 - 2026-07-22

### Patch Changes

- f924276: Include the runnable example sources in the published package so packaged documentation links work.

## 0.2.0 - 2026-07-21

Current release of the expanded Norway Open Data SDK.

### Added

- Cross-provider address profiles via `profiles.address()`, composing a Kartverket address match
  with MET Norway conditions, exact structured NVE administrative-area matches, and first-page
  NVDB road candidates from a bounding box around the coordinate. `hazardMatches` records whether
  an explicit municipality code/name matched, or a county code/name when the warning publishes no
  municipalities; forecast-region names are not matched automatically. `roadSearch` records the
  exact bounds, requested page size, and whether NVDB reported another page.
- Per-operation `components` metadata for company and address profiles. Available components carry
  their provider source, SDK operation-resolution time, and cache status; skipped components report
  an explicit `not-configured`, `missing-coordinate`, or `not-applicable` reason. Provider source
  metadata now includes attribution text, with service-specific wording for each Varsom feed.
- Electricity spot prices from the third-party Hva koster strømmen? public API via the new
  `electricity` namespace (`getPrices`, `getCurrentPrice`) for all five Norwegian bidding zones.
  The provider documents its data as ENTSO-E EUR prices converted to NOK using a Norges Bank
  exchange rate.
- Auto-paginating async iterators for list endpoints: `companies.searchAll`,
  `catalog.searchAll`, `parliament.searchCasesAll`, `roads.searchRoadObjectsAll` and
  `roads.getRoadNetworkAll`. Each accepts `maxItems` and `maxPages` bounds.
- `NorwayOpenData.clearCache()` for invalidating every response cached by one SDK instance.
- Representative opt-in live contract checks across the supported source adapters and `profiles`,
  including anonymous `hazards` warnings, chained detail lookups and one-item, one-page probes for
  every public iterator. These probes do not claim to exercise every method, parameter combination
  or upstream response variant.
- A weekly scheduled workflow that runs the live suite so upstream contract changes surface
  early, and a workflow prepared to publish the TypeDoc reference after GitHub Pages is enabled.

### Changed

- The minimum supported runtime is Node.js 22. Distribution builds target Node.js 22, and CI
  verifies the package on Node.js 22 and 24.
- `pnpm verify` is the single CI and pre-publish gate for formatting, linting, type checking,
  coverage, builds, generated documentation and packed-package consumer checks.

### Fixed

- Auto-paginators now reject unsafe bounds, treat `maxItems: 0` as a zero-request result and keep
  the 100-logical-page safety cap finite. Opaque-cursor iterators also reject repeated markers and
  cycles before requesting an already-seen page again.
- `profiles.address()` now reports `cached: true` only when every included provider response came
  from cache.
- `parliament.searchCasesAll()` now downloads one Stortinget session export per iterator even when
  the SDK cache is disabled.
- Data.norge multi-type iterators now stop cleanly at their documented 100-position result window.
- Electricity responses now verify the complete ordered Europe/Oslo day, including 23- and
  25-interval daylight-saving transitions. Normalized interval ends follow the next chronological
  start (or the following local midnight), while `includeRaw` preserves provider-native timestamps.
- Scheduled live checks now treat empty optional GitHub secrets as absent, and TypeDoc deployment
  requires an explicit manual workflow run.
- The development toolchain now forces `esbuild` 0.28.1, which contains the Windows development
  server path-traversal fix.
- NVE power-plant responses no longer fail validation when the provider publishes negative
  capacity or mean-production figures, which previously made `energy.getHydropowerPlants` and
  `energy.getPowerPlants` throw on live data.
- Search pagination no longer rejects an empty page that reports a size of zero.

## 0.1.1 - 2026-07-21

Release-hardening repository version and Git tag. It was not published to npm. Version `0.1.0`
was published briefly and then unpublished before general use.

### Added

- Data.norge catalogue search and resource lookup.
- Norges Bank exchange-rate, policy-rate, and Nowa time series.
- Stortinget representatives, parties, cases, votes, questions, and meetings.
- Statens vegvesen NVDB road-object metadata, objects, and road-network access.
- NVE reservoir, power-plant, hazard-warning, and HydAPI methods.
- Six new facade namespaces: `catalog`, `currency`, `parliament`, `roads`, `energy`, and `hazards`.
- Provider-specific NVE API-key configuration without changing anonymous provider access.
- Official-provider live checks, examples, fixtures, smoke coverage, and package-consumer tests.

### Fixed

- Privacy-safe `includeRaw` handling for Stortinget representatives and NVDB sensitive metadata.
- Representation-aware HTTP cache keys for JSON and text responses sharing a URL.
- Bounded Data.norge multi-type pagination and latest shared-date cross-currency matching.
- Stronger NVE range/date validation and unambiguous one-series HydAPI observations.
- Caller cancellation during zero-delay retries and abort-listener cleanup.
- Rejection of malformed Entur GraphQL envelopes.
- Documentation examples, package contents, generated source maps, and package-version injection.
- Deprecated Zod object pass-through calls.
