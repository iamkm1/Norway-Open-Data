# API stability

Norway Open Data SDK is pre-1.0; see `CHANGELOG.md` for the current release. The public surface is
usable, tested and typed, but it should not be treated as a 1.0 stability promise.

## Supported consumer surface

Supported imports come from the package root:

```ts
import {
  NorwayOpenData,
  type OpenDataResponse,
  type OpenDataSource,
  type ProfileComponent,
} from "norway-open-data-sdk";
```

The package export map exposes the root entry point and `package.json`. Imports from `src/`,
`dist/` or provider-internal paths are unsupported and may change without compatibility aliases.
The same root contract is built as ESM, CommonJS and TypeScript declarations.

The 0.2.0 profile additions (`components`, `hazardMatches`, and `roadSearch`) are optional in the
exported profile types for source compatibility, while profiles produced by this SDK populate the
metadata that applies to their operations. `OpenDataSource.attribution` is likewise optional and is
present only when the provider registry or a service-specific profile component declares
attribution text.

## Versioning

Changesets record user-visible changes and drive semantic versions:

- Patch: compatible fixes, validation corrections and documentation updates.
- Minor: new compatible methods, types, providers or options.
- Major: incompatible changes to public imports, signatures, normalized output or behavior.

Before 1.0, breaking changes may still be necessary, but they must be documented through a
Changeset and changelog entry rather than introduced silently. A breaking change is released as a
minor version while the major version is `0`, so a caret range such as `^0.4.1` does not pick it up
automatically. Patch releases stay compatible.

## Provider contract risk

The SDK depends on independently operated APIs. Providers can change endpoints, limits, schemas or
terms outside this repository's release cycle. Runtime schemas turn unexpected responses into
`ResponseValidationError` rather than allowing unvalidated data into application code, but they
cannot prevent upstream downtime or policy changes.

Provider adapters normalize only semantics that are clear and stable. Dynamic or provider-defined
fields may remain `unknown`. See `PROVIDERS.md` for known stability risks and the current official
documentation links.

Correctness checks can reject provider behavior that would otherwise duplicate or mislabel data.
For example, cursor iterators reject repeated markers, and electricity days must contain the exact
ordered 23, 24 or 25 Europe/Oslo elapsed-hour sequence with valid provider end boundaries. Such
failures surface as `ResponseValidationError` rather than silently returning ambiguous normalized
data.

## Raw responses

`{ includeRaw: true }` returns a validated provider representation for diagnostics or advanced use.
It is not guaranteed to remain structurally stable across provider changes, and it is not always a
complete wire payload. Adapters may allowlist or sanitize fields to protect privacy and preserve
the SDK's supported-access boundary.

Applications should depend on the typed normalized `data` field whenever possible.
