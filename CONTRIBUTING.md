# Contributing

Thank you for improving Norway Open Data SDK. Contributions should preserve its narrow purpose: a
reusable Node.js interface to official Norwegian public-data APIs. Restricted data, personal data,
scraping, hosted services, databases and user-account features are outside scope.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Development

Requirements are Node.js 20+ and pnpm 10.

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
pnpm run docs
npm pack --dry-run
```

Use [Testing](docs/testing.md) for offline fixture rules, opt-in live tests and the built-package
smoke test. Routine tests and CI must stay deterministic and must not depend on provider networks.

## Provider changes

Read [Adding a provider](docs/adding-a-provider.md) before changing an adapter or proposing a new
provider. Link current official documentation in the pull request, preserve provider-native
semantics and validate every external response at runtime.

Update [PROVIDERS.md](PROVIDERS.md) whenever access requirements, credentials, licences,
attribution, traffic limits or known provider risks change. Do not silently guess at one universal
data model.

## Public API changes

Package-root exports are the supported consumer surface. Read [API stability](docs/api-stability.md)
before changing methods, parameters, normalized response fields or export paths.

Add useful JSDoc, tests and examples for public changes. Record every user-visible change with a
Changeset:

```bash
pnpm changeset
```

Use a patch for compatible fixes, a minor for new compatible APIs and a major for breaking changes.

## Pull-request checklist

- Link the official API and provider terms relevant to the change.
- Add or update minimal offline fixtures and runtime schemas.
- Cover input boundaries, malformed responses, errors and normalized output.
- Review optional raw output for personal, restricted or unsupported fields.
- Confirm credentials and request headers cannot appear in logs, errors, fixtures or package files.
- Update examples, `docs/capabilities.md` and `PROVIDERS.md` where applicable.
- Add a Changeset for user-visible behavior.
- Run formatting, linting, type checking, coverage, build, TypeDoc and package dry-run checks.

Keep pull requests focused. Provider contracts, fixtures, schemas, tests and documentation should
change together when they describe the same behavior.
