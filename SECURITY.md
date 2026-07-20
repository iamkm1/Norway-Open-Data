# Security policy

## Supported versions

Security fixes are provided for the latest published version.

## Reporting a vulnerability

Please use the repository's private security-advisory feature rather than a public issue. Include
the affected version, impact, reproduction, and any suggested mitigation. Maintainers should
acknowledge a complete report within seven days and coordinate disclosure after a fix is available.

Never include provider credentials, authorization headers, personal data, or private application
data in a report. The SDK intentionally integrates only open, non-personal endpoints and never logs
request headers automatically.

Provider availability, upstream data errors, and public rate limiting are normally reliability
issues, not SDK security vulnerabilities.
