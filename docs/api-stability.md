# API stability

Norway Open Data SDK is currently version `0.2.0`. The public surface is usable, tested and typed,
but it should not be treated as a 1.0 stability promise.

## Supported consumer surface

Supported imports come from the package root:

```ts
import { NorwayOpenData, type OpenDataResponse } from "norway-open-data-sdk";
```

The package export map exposes the root entry point and `package.json`. Imports from `src/`,
`dist/` or provider-internal paths are unsupported and may change without compatibility aliases.
The same root contract is built as ESM, CommonJS and TypeScript declarations.

## Versioning

Changesets record user-visible changes and drive semantic versions:

- Patch: compatible fixes, validation corrections and documentation updates.
- Minor: new compatible methods, types, providers or options.
- Major: incompatible changes to public imports, signatures, normalized output or behavior.

Before 1.0, breaking changes may still be necessary, but they must be documented through a
Changeset and changelog entry rather than introduced silently.

## Provider contract risk

The SDK depends on independently operated APIs. Providers can change endpoints, limits, schemas or
terms outside this repository's release cycle. Runtime schemas turn unexpected responses into
`ResponseValidationError` rather than allowing unvalidated data into application code, but they
cannot prevent upstream downtime or policy changes.

Provider adapters normalize only semantics that are clear and stable. Dynamic or provider-defined
fields may remain `unknown`. See `PROVIDERS.md` for known stability risks and the current official
documentation links.

## Raw responses

`{ includeRaw: true }` returns a validated provider representation for diagnostics or advanced use.
It is not guaranteed to remain structurally stable across provider changes, and it is not always a
complete wire payload. Adapters may allowlist or sanitize fields to protect privacy and preserve
the SDK's supported-access boundary.

Applications should depend on the typed normalized `data` field whenever possible.
