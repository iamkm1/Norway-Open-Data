# Contributing

Thank you for improving Norway Open Data SDK. Contributions should preserve its narrow purpose: a
reusable, direct Node.js interface to official open public APIs. Restricted data, personal data,
scraping, hosted services, databases, and user-account features are outside scope.

## Development

Requirements are Node.js 20+ and pnpm 10.

```bash
pnpm install
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:coverage
pnpm build
```

Unit tests must be deterministic and offline. Add a small saved fixture for new provider shapes.
Live tests belong under `tests/live`, must remain low-volume, and must never run in ordinary CI.

## Provider changes

Link to current official documentation in the pull request. Preserve provider-native semantics,
validate external JSON at runtime, and update `PROVIDERS.md` when identification, licensing,
attribution, or limits change. Do not silently guess at a universal data model.

## Public API changes

Add useful JSDoc, tests, examples where appropriate, and a changeset:

```bash
pnpm changeset
```

Use a patch for compatible fixes, a minor for new compatible API, and a major for breaking changes.
By participating, you agree to follow the Code of Conduct.
