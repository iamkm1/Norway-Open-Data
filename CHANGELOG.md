# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning.

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
