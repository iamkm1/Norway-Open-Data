# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning.

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
