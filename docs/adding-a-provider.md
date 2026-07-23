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

- `provider.ts` for the provider descriptor;
- `types.ts` for provider-native public TypeScript types;
- `schemas.ts` for Zod schemas at the network boundary;
- `client.ts` for requests, input validation and safe normalization;
- `index.ts` for provider-local exports.

Use the shared HTTP client for timeouts, cancellation, retry behavior, error mapping, caching,
caller identification and request budgets. Do not use `any`, bypass runtime validation or force
unrelated provider records into a universal schema. Leave genuinely dynamic values as `unknown` and
document how callers should interpret them.

## The descriptor

`provider.ts` is the single declaration of everything the SDK core needs. Nothing about a provider
is special-cased anywhere else, so this file plus one registry line is the whole integration.

```ts
import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

export const exampleProvider = {
  id: "example",
  name: "Example Directorate",
  homepage: "https://example.no/",
  documentation: "https://api.example.no/docs",
  access: "identification-required",
  authentication: "X-Client header naming the calling application.",
  license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  attribution: "Credit Example Directorate when redistributing data.",
  auth: defineAuth({
    requires: ["applicationName"],
    headers: ({ applicationName }) => ({ "X-Client": applicationName }),
    missing: "Example requests require applicationName for the mandatory X-Client header.",
  }),
  rateLimit: {
    requests: 60,
    intervalMs: 60_000,
    basis: "sdk-courtesy",
    note: "Example publishes no explicit budget; the SDK keeps paging polite.",
  },
  cacheTtlMs: {
    search: 10 * 60 * 1_000,
    detail: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
```

Field notes:

- **`id`** is the one spelling used everywhere: registry key, error messages, response `source.id`
  and the `credentials` configuration key. Use the provider's own short name, hyphenated, not a
  camelCase variant. The registry refuses to compile if a key and an `id` disagree.
- **`auth`** is only for providers that require identification. Always wrap it in `defineAuth`:
  that makes `requires` the sole inference site, so `headers` is type-checked against exactly the
  values the provider asked for and reading an undeclared value is a compile error. Without the
  wrapper the field set widens to every possible value and the check is lost. `headers` receives
  those values already proven present and non-empty. `missing` is shown verbatim to the caller, so
  name the configuration keys and say where to get a key. Declare `auth` even if only some
  endpoints need it, and set `authenticate: true` on just those requests.
- **`rateLimit`** is `provider-documented` only when the provider publishes a number; cite it in
  `note`. Otherwise use `sdk-courtesy` and pick a budget that keeps normal use comfortable while
  bounding a runaway loop. Omit it only for a provider that genuinely has no meaningful limit.
- **`cacheTtlMs`** names each operation class. Clients reference `exampleProvider.cacheTtlMs.search`
  rather than repeating raw millisecond literals, so the freshness policy is reviewable in one
  place.

## Integration checklist

- Write `provider.ts` with authoritative links, classification, access type, licence and
  attribution.
- Add one line to `src/providers/registry.ts`.
- Define caller identification or credentials only when the provider requires them; the descriptor
  is the only place that should mention them. Credentials reach only the declaring provider's
  requests and never appear in cache keys or errors.
- Reference the request with `provider: exampleProvider` so errors, budgets and identification
  resolve automatically.
- Wire the client into the `NorwayOpenData` facade and package-root exports.
- Add JSDoc for public methods, parameters, return types and non-obvious limitations.
- Add a runnable example and update `docs/capabilities.md`.
- Update `PROVIDERS.md` with rate limits, stability risks and unsupported restricted access.

## Tests and privacy review

- Save the smallest representative offline fixture; remove credentials and unsupported personal
  fields.
- Test valid responses, malformed responses, boundary inputs, provider errors and cache behavior.
- The shared registry tests already assert descriptor invariants; a provider that declares an
  incoherent budget, an empty cache policy or an unhelpful `missing` message fails without any
  new test being written.
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
