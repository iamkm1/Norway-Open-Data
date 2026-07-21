# Adding a provider

New sources must fit the SDK's narrow scope. Prefer official, documented Norwegian public-sector
APIs with clear access and reuse terms. A third-party endpoint is an exception: it must expose a
distinct public-data capability, document its upstream lineage and reuse expectations, and be
clearly labelled as independently operated throughout the SDK. Scraping, personal data,
restricted data, delegated government authentication and private agreements are outside scope.

## Before implementation

Confirm all of the following:

- The endpoint is documented and intended for public or self-service use.
- An independently operated endpoint has transparent upstream lineage and no suitable supported
  official endpoint provides the same capability.
- Authentication, caller identification, rate limits and traffic rules are documented.
- The data licence, attribution wording and redistribution constraints are clear.
- Supported fields do not expose personal, restricted or role-protected data.
- The provider adds a distinct capability rather than duplicating an existing namespace.

Record authoritative links, source classification, lineage and legal notes in `PROVIDERS.md`
before opening the public API.

## Adapter structure

A typical adapter under `src/providers/<provider>/` contains:

- `types.ts` for provider-native public TypeScript types;
- `schemas.ts` for Zod schemas at the network boundary;
- `client.ts` for requests, input validation and safe normalization;
- `index.ts` for provider-local exports.

Use the shared HTTP client for timeouts, cancellation, retry behavior, error mapping and caching.
Do not use `any`, bypass runtime validation or force unrelated provider records into a universal
schema. Leave genuinely dynamic values as `unknown` and document how callers should interpret
them.

## Integration checklist

- Add source metadata, authoritative links, classification, access type, licence and attribution.
- Define meaningful caller identification or credentials only when the provider requires them.
- Send credentials only to the intended provider host and never include them in cache keys or
  errors.
- Choose a conservative provider-aware cache TTL.
- Wire the client into the `NorwayOpenData` facade and package-root exports.
- Add JSDoc for public methods, parameters, return types and non-obvious limitations.
- Add a runnable example and update `docs/capabilities.md`.
- Update `PROVIDERS.md` with rate limits, stability risks and unsupported restricted access.

## Tests and privacy review

- Save the smallest representative offline fixture; remove credentials and unsupported personal
  fields.
- Test valid responses, malformed responses, boundary inputs, provider errors and cache behavior.
- Add a low-volume, opt-in live check and built-package smoke coverage where practical.
- Review `{ includeRaw: true }` separately. Raw output must be validated and must not restore fields
  intentionally excluded for privacy or access-control reasons.
- Confirm logs and thrown messages never expose request headers, API keys or complete provider
  payloads.

Follow [Testing](testing.md) for command and fixture policy.

## Pull-request checklist

- Link current authoritative API, access, lineage, licence and attribution documentation.
- Run formatting, linting, type checking, unit coverage, build, TypeDoc and package dry-run checks.
- Update the README only when the top-level provider or namespace overview changes.
- Add a Changeset for every user-visible behavior or public API change.
- Confirm the change does not add scraping, personal data, restricted endpoints or unsupported
  authentication flows.

Provider contracts change independently of this package. A provider-affecting pull request must
update fixtures, runtime schemas and provider documentation together.
