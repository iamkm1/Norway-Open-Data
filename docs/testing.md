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

The package requires Node.js 22 or newer. CI verifies the runtime and packed-package contract on
Node.js 22 and 24.

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

The application name is required for Entur and NVDB. MET's live cases are skipped without a contact
email. The NVE HydAPI cases are skipped unless `NVE_HYDAPI_KEY` is set; every other check runs
anonymously or with caller identification only.

Live checks are representative contract probes across the supported public-sector source adapters,
the third-party electricity endpoint and both `profiles` compositions. Individual cases may call
several related methods, but the suite does not claim exhaustive coverage of every method,
auto-paginating iterator, parameter combination or upstream response variant. Detail lookups are
chained from list calls rather than hard-coded IDs where practical. Keep requests bounded and do
not add load or rate-limit bypasses.

## Scheduled live monitoring

For authorized maintainers of the currently private repository, `.github/workflows/live.yml` runs
the live suite every Monday and on demand (**Actions → Live provider checks → Run workflow**). It
never runs on pull requests, so forks cannot trigger outbound calls or read repository secrets.

Configure once in repository settings:

| Name                                | Kind     | Purpose                                   |
| ----------------------------------- | -------- | ----------------------------------------- |
| `NORWAY_OPEN_DATA_APPLICATION_NAME` | Variable | Caller identity for Entur, MET and NVDB   |
| `NORWAY_OPEN_DATA_CONTACT_EMAIL`    | Secret   | Monitored contact address required by MET |
| `NVE_HYDAPI_KEY`                    | Secret   | Optional; enables the two HydAPI checks   |

A failure can indicate an upstream contract change, temporary provider/network trouble or an SDK
regression. Inspect the provider response and failing path before adjusting a schema.

## Built-package smoke test

Build first, retain the same application identity variables, and run:

```bash
pnpm build
pnpm smoke
```

The smoke script exercises a bounded set of mandatory public operations through the built package,
including anonymous NVE energy and third-party electricity data. It reports each pass or failure
and exits with status 1 if any check fails.

## Adding tests

- Keep unit tests offline and deterministic.
- Add a minimal saved fixture for each new provider response shape.
- Test input validation, provider-response validation, normalized output and error behavior.
- Put network checks under `tests/live` and keep them low-volume and explicitly opt-in.
- Never commit caller emails, API keys, tokens or complete sensitive provider payloads.

GitHub Actions runs formatting, linting, type checking, coverage and builds on supported Node.js
versions, and verifies that TypeDoc can be generated. Live-provider tests are excluded from that
workflow and run on the separate weekly schedule described above.
