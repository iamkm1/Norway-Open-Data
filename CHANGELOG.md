# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning once
published.

## 0.2.0 - 2026-07-21

### Added

- Cross-provider address profiles via `profiles.address()`, composing a Kartverket address match
  with MET Norway conditions, matching NVE warnings, and the NVDB road segments around the
  coordinate. Sections whose provider needs identification the client does not have are omitted
  rather than failing the call.
- Electricity spot prices from Hva koster strømmen? via the new `electricity` namespace
  (`getPrices`, `getCurrentPrice`) for all five Norwegian bidding zones.
- Auto-paginating async iterators for list endpoints: `companies.searchAll`,
  `catalog.searchAll`, `parliament.searchCasesAll`, `roads.searchRoadObjectsAll` and
  `roads.getRoadNetworkAll`. Each accepts `maxItems` and `maxPages` bounds.
- Live contract checks for every public method of every provider, including `profiles` and the
  anonymous `hazards` warnings, with detail lookups chained from list calls.
- A weekly scheduled workflow that runs the live suite so upstream contract changes surface
  early, and a workflow that publishes the TypeDoc reference to GitHub Pages.

### Fixed

- NVE power-plant responses no longer fail validation when the provider publishes negative
  capacity or mean-production figures, which previously made `energy.getHydropowerPlants` and
  `energy.getPowerPlants` throw on live data.
- Search pagination no longer rejects an empty page that reports a size of zero.

## 0.1.1 - 2026-07-21

First public release. (0.1.0 was published briefly and superseded by release hardening before general use.)

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
