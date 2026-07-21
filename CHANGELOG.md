# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning once
published.

## 0.2.0 - Unreleased

This version exists in the repository but has not been published to npm or tagged as a release.

### Added

- Cross-provider address profiles via `profiles.address()`, composing a Kartverket address match
  with MET Norway conditions, matching NVE warnings, and the NVDB road segments around the
  coordinate. Sections whose provider needs identification the client does not have are omitted
  rather than failing the call. Warning matches are best-effort discovery only, never an
  all-clear; safety decisions require the complete official Varsom/NVE services.
- Electricity spot prices from the third-party Hva koster strømmen? public API via the new
  `electricity` namespace (`getPrices`, `getCurrentPrice`) for all five Norwegian bidding zones.
  The provider documents its data as ENTSO-E EUR prices converted to NOK using a Norges Bank
  exchange rate.
- Auto-paginating async iterators for list endpoints: `companies.searchAll`,
  `catalog.searchAll`, `parliament.searchCasesAll`, `roads.searchRoadObjectsAll` and
  `roads.getRoadNetworkAll`. Each accepts `maxItems` and `maxPages` bounds.
- Representative opt-in live contract checks across the supported source adapters and `profiles`,
  including anonymous `hazards` warnings and chained detail lookups. These probes do not claim to
  exercise every method, iterator, parameter combination or upstream response variant.
- A weekly scheduled workflow that runs the live suite so upstream contract changes surface
  early, and a workflow prepared to publish the TypeDoc reference after GitHub Pages is enabled.

### Fixed

- Auto-paginators now reject unsafe bounds, treat `maxItems: 0` as a zero-request result and keep
  the 100-request safety cap finite.
- `profiles.address()` now reports `cached: true` only when every included provider response came
  from cache.
- `parliament.searchCasesAll()` now downloads one Stortinget session export per iterator even when
  the SDK cache is disabled.
- Data.norge multi-type iterators now stop cleanly at their documented 100-position result window.
- Electricity responses now verify the requested local date and contiguous one-hour intervals,
  including daylight-saving transitions.
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
