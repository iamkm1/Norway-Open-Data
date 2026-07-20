# Testing

The default test suite is deterministic and offline. Provider responses are represented by small,
saved fixtures so routine development and CI do not depend on network availability.

## Local checks

```bash
pnpm test
pnpm test:watch
pnpm test:coverage
pnpm lint
pnpm typecheck
pnpm build
```

Coverage uses V8. The configured minimums are 90% for statements, lines and functions, and 65% for
branches.

## Live provider tests

Live tests are opt-in, low-volume contract checks under `tests/live`. `pnpm test:live` sets
`RUN_LIVE_TESTS=true`; ordinary `pnpm test` and CI exclude them.

macOS or Linux:

```bash
NORWAY_OPEN_DATA_APPLICATION_NAME=my-application \
NORWAY_OPEN_DATA_CONTACT_EMAIL=developer@example.no \
pnpm test:live
```

PowerShell:

```powershell
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "my-application"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "developer@example.no"
pnpm test:live
```

The application name is required for Entur and NVDB. MET's live case is skipped without a contact
email. The current suite uses anonymous NVE energy data and does not read an NVE HydAPI key.

Live checks cover Brønnøysundregistrene, SSB, Kartverket, Entur, MET Norway, Data.norge, Norges
Bank, Stortinget, NVDB and NVE. Keep requests bounded and do not add load or rate-limit bypasses.

## Built-package smoke test

Build first, retain the same application identity variables, and run:

```bash
pnpm build
pnpm smoke
```

The smoke script exercises the built package through 12 mandatory public operations. It uses
anonymous NVE energy data, reports each pass or failure and exits with status 1 if any check fails.

## Adding tests

- Keep unit tests offline and deterministic.
- Add a minimal saved fixture for each new provider response shape.
- Test input validation, provider-response validation, normalized output and error behavior.
- Put network checks under `tests/live` and keep them low-volume and explicitly opt-in.
- Never commit caller emails, API keys, tokens or complete sensitive provider payloads.

GitHub Actions runs formatting, linting, type checking, coverage and builds on supported Node.js
versions. It also verifies that TypeDoc can be generated. It does not run live-provider tests.
