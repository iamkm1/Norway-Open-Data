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

`prepublishOnly` runs the same gate for both direct npm publishing and the `pnpm release` script.

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

## Authorization boundary

- [ ] Do not create a Git remote without explicit authorization.
- [ ] Do not push, tag, publish, or create a release without explicit authorization.
