# Release checklist

This checklist describes verification only. Publishing, tagging, pushing, and release creation
must require separate explicit authorization.

## Source and contracts

- [ ] Verify every changed source against current authoritative documentation.
- [ ] Confirm official and independently operated sources are classified accurately and derived
      data has documented lineage.
- [ ] Confirm endpoints are public or documented self-service endpoints, with no scraping.
- [ ] Update runtime schemas, fixtures, normalized types, metadata, terms, attribution, and limits.
- [ ] Confirm restricted and personal data remain outside supported methods.
- [ ] Confirm no real email address, API key, token, or other credential is stored.

## Local checks

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm format
corepack pnpm verify
```

`prepublishOnly` runs the same gate when the publishing workflow invokes `npm publish`.

## Live checks

Use a monitored contact address only through the process environment. NVE HydAPI is optional unless
its credential-protected methods changed.

```powershell
$env:RUN_LIVE_TESTS = "true"
$env:NORWAY_OPEN_DATA_APPLICATION_NAME = "your-company-your-application"
$env:NORWAY_OPEN_DATA_CONTACT_EMAIL = "your-monitored-address@example.no"
$env:NVE_HYDAPI_KEY = "your-key-if-needed"
corepack pnpm test:live
corepack pnpm smoke
```

## Package checks

- [ ] Run `npm pack --dry-run` and inspect every included path.
- [ ] Install the final tarball in a separate directory.
- [ ] Verify ESM, CommonJS, and strict TypeScript consumers.
- [ ] Make a low-volume request to each new provider where anonymous access permits it.
- [ ] Verify consumer code never imports an internal source path.
- [ ] Re-run the credential and unfinished-code scans.

## Publish with provenance

Future registry releases must use the manual `Publish to npm` workflow from `main`. Local publishing
cannot produce npm provenance and is not the supported release path.

- [ ] Apply the Changeset version and changelog updates, then merge them to `main`.
- [ ] Confirm CI, CodeQL, package checks, and the required live checks are green on that commit.
- [ ] In GitHub Actions, run `Publish to npm` and enter the exact version from `package.json`.
- [ ] Install the published version in a fresh temporary consumer and run `npm audit signatures`
      there, confirming npm reports a provenance attestation for this SDK.
- [ ] Confirm the registry `gitHead` matches the intended GitHub commit.
- [ ] Create the version tag at that exact commit only after the registry checks pass.

The npm package settings must trust GitHub Actions for repository `iamkm1/Norway-Open-Data`,
workflow `publish.yml`, and the `npm publish` action. The workflow uses short-lived OIDC credentials;
do not add an `NPM_TOKEN` secret.

## Authorization boundary

- [ ] Do not create a Git remote without explicit authorization.
- [ ] Do not push, tag, publish, or create a release without explicit authorization.
