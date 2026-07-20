# Changelog

All notable user-visible changes are recorded here. The project follows semantic versioning once
published.

## Unreleased

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
