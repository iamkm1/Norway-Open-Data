# Testing

The default test suite is deterministic and offline. Provider responses are represented by small,
saved fixtures so routine development and CI do not depend on network availability.

## Local checks

Run the complete release-equivalent gate with:

```bash
pnpm verify
```

For focused development, the underlying commands remain available individually:

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

Development requires Node.js 22 or newer. CI verifies the runtime and packed-package contract on
Node.js 22 and 24, and additionally executes the built package on Deno and Bun so the published
artifact stays runtime-neutral.

`pnpm check:portability` guards that neutrality locally: it scans the built bundles for any Node
built-in reference and runs the SDK's request, cache, validation, error and cancellation paths
against a hand-written object implementing only the standard `Response` surface.
`scripts/cross-runtime-check.mjs` is the script the Deno and Bun jobs run and can be executed with
any runtime.

Geospatial unit coverage remains offline as well. Saved fixtures exercise strict Point,
MultiPoint, LineString, Polygon and MultiPolygon validation, holes, null geometry, CRS rejection,
ArcGIS/WFS/OGC page normalization, empty and truncated results, repeated-page protection,
`AbortSignal`, provider attribution and partial nature-profile failures. Tests never need a map
server merely to prove paging or geometry behavior.

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
anonymously or with caller identification only. The v0.8 Geonorge, Naturbase and NIBIO probes need
no new environment variables.

Live checks are representative contract probes across the supported public-sector source adapters,
the third-party electricity endpoint and representative `profiles` compositions. Representative
auto-paginating iterators have one-item, one-page probes. Individual cases may call several related
methods, but the suite does not claim exhaustive coverage of every method, parameter combination or
upstream response variant. Detail lookups are chained from list calls rather than hard-coded IDs
where practical. Keep requests bounded and do not add load or rate-limit bypasses.

### Geospatial live probes

`tests/live/geospatial.live.test.ts` includes low-volume, anonymous checks for Geonorge catalogue
search/detail, each selected Naturbase dataset and NIBIO AR50. Spatial probes use one point, request
at most one feature from one page and validate the live CRS declaration and representative
attributes without assuming that a feature must always exist at one coordinate. The nature profile
is covered offline with injected component responses and partial-failure cases.

These checks are contract sentinels, not data-quality or coverage audits. They do not follow
Geonorge distribution/service URLs, render WMS images, traverse nationwide feature sets or touch
restricted Geovekst resources. An upstream timeout, temporary empty layer or changed metadata string
must be investigated before changing a runtime schema. Enable them with the same
`RUN_LIVE_TESTS=true` path as every other live check; there are no geospatial credentials.

### Maritime live probes

`tests/live/maritime.live.test.ts` covers BarentsWatch and Fiskeridirektoratet. Its environment
variables are provider-scoped, because BarentsWatch issues two separate client kinds:

| Variable                         | Enables                                   |
| -------------------------------- | ----------------------------------------- |
| `BARENTSWATCH_AIS_CLIENT_ID`     | `norway.ais` and `profiles.vessel` probes |
| `BARENTSWATCH_AIS_CLIENT_SECRET` | `norway.ais` and `profiles.vessel` probes |
| `BARENTSWATCH_CLIENT_ID`         | `norway.marine` probes                    |
| `BARENTSWATCH_CLIENT_SECRET`     | `norway.marine` probes                    |

Both Fiskeridirektoratet registers are open, so those probes always run when live tests are enabled
and need no configuration.

The AIS probes are deliberately conservative. The streaming probe takes exactly one message and
stops on a 25-second abort deadline, so a quiet moment on the feed is not reported as a failure; a
live feed only produces a message when a vessel actually transmits. The area-search probe uses a box
well inside the provider's 500-square-kilometre limit. Probes that depend on a vessel being present
return early rather than asserting when the snapshot is empty.

One live probe checks a privacy guarantee rather than a contract: it reads a wide page of the vessel
register and asserts that no natural person's name, postal code or town appears in the normalized
output or in the raw payload.

SSB Klass also has a separate bounded anonymous live suite in `tests/live/klass.live.test.ts`. It
runs serially with conservative pacing and performs only a few read-only calls: classification
discovery, one code-list check and one known historical administrative correspondence. It needs no
credentials, remains excluded from ordinary deterministic CI and must never be expanded into a
rate-limit probe.

## Scheduled live monitoring

For authorized repository maintainers, `.github/workflows/live.yml` runs
the live suite every Monday and on demand (**Actions → Live provider checks → Run workflow**). It
never runs on pull requests, so forks cannot trigger outbound calls or read repository secrets.

Configure once in repository settings:

| Name                                | Kind     | Purpose                                             |
| ----------------------------------- | -------- | --------------------------------------------------- |
| `NORWAY_OPEN_DATA_APPLICATION_NAME` | Variable | Caller identity for Entur, MET and NVDB             |
| `NORWAY_OPEN_DATA_CONTACT_EMAIL`    | Secret   | Monitored contact address required by MET           |
| `NVE_HYDAPI_KEY`                    | Secret   | Optional; enables the two HydAPI checks             |
| `BARENTSWATCH_AIS_CLIENT_ID`        | Secret   | Optional; enables the AIS and vessel-profile checks |
| `BARENTSWATCH_AIS_CLIENT_SECRET`    | Secret   | Optional; enables the AIS and vessel-profile checks |
| `BARENTSWATCH_CLIENT_ID`            | Secret   | Optional; enables the marine-forecast checks        |
| `BARENTSWATCH_CLIENT_SECRET`        | Secret   | Optional; enables the marine-forecast checks        |

A BarentsWatch client id contains the registering account's address, so it is stored as a secret
rather than a variable even though it is not a bearer credential on its own.

Geonorge, Naturbase and NIBIO require no repository variable or secret. `RUN_LIVE_TESTS` is set by
the live-test script/workflow itself rather than stored as a credential.

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
- For geospatial changes, cover geometry structure, source/output CRS, limits, truncation, empty
  results, repeated pages and abort propagation without broadening schemas to fit one fixture.
- Put network checks under `tests/live` and keep them low-volume and explicitly opt-in.
- Never commit caller emails, API keys, tokens or complete sensitive provider payloads.

GitHub Actions runs formatting, linting, type checking, coverage and builds on supported Node.js
versions, and verifies that TypeDoc can be generated. Live-provider tests are excluded from that
workflow and run on the separate weekly schedule described above.
