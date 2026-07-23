---
"norway-open-data-sdk": minor
---

Providers are now declared once, in one place. Each provider owns a `ProviderDescriptor` under
`src/providers/<provider>/provider.ts` holding its legal metadata, caller identification, request
budgets and cache lifetimes, and `src/providers/registry.ts` collects them. The `ProviderId` union
is derived from the registry's own keys, and the registry refuses to compile when a key and a
descriptor `id` disagree, so one spelling of an identifier reaches error messages, response
`source.id`, cache keys and configuration. Requests carry the descriptor rather than a provider
name, making a mistyped provider a type error instead of a misleading message. Adding a provider now
means writing its folder and one registry line; no file under `src/core/` changes.

Caller identification is declarative. A descriptor names the configuration values it needs and
builds its own headers from them; the HTTP client verifies they are present and raises
`ConfigurationError` with the provider's own instructions before any network access. The bespoke
per-client identity plumbing for Entur, MET Norway, NVDB and NVE HydAPI is gone, and cross-provider
profiles ask the same question to decide whether to skip a section as `not-configured`.

New: per-provider request budgets, enforced by default. Every provider declares how often the SDK
may call it, and one sliding-window limiter per budget is shared by all clients on a
`NorwayOpenData` instance. Admission is serialized so concurrent callers cannot overshoot together.
Waiting happens before the request timeout is armed, so a queued request is not charged for its
wait; a cache hit costs no budget, a retry does, and a caller's `signal` rejects a queued request
immediately. Budgets are named per operation class because providers publish different limits per
service — Data.norge allows 10 searches per minute but 5 resource lookups per second, and those no
longer throttle each other. `basis` distinguishes a provider's published number from a conservative
budget the SDK chose. Disable with `rateLimit: { enabled: false }`.

New: pluggable cache storage. `cache.store` accepts any `CacheStore` implementing `get`, `set` and
`clear`, synchronously or asynchronously, so validated responses can be shared across instances,
workers or hosts instead of being trapped in one process. The default in-memory cache is unchanged.

Breaking changes. This is a minor release before 1.0, so a `^0.4.1` dependency range will not pick
it up automatically; upgrade deliberately and read this list first:

- Per-provider request budgets are enforced by **default**. Code that previously issued unbounded
  bursts now waits instead of failing, which is the intended behaviour but changes timing. Data.norge
  is the tightest at 10 search requests per minute, as that service documents. Opt out with
  `rateLimit: { enabled: false }`.
- `NorwayOpenData.clearCache()` returns `Promise<void>` so it can await a custom store. Existing
  calls that ignore the result keep working; `await` it when you depend on the cache being empty.
- `providers` is keyed by provider id rather than a camelCase alias, so `providers.dataNorge` and
  `providers.norgesBank` become `providers["data-norge"]` and `providers["norges-bank"]`. Its values
  are now `ProviderMetadata` rather than literal types, and expose `rateLimit`. Every other key is
  unchanged.
- `credentials` is keyed by provider id and rejects unknown providers instead of ignoring them.
  `credentials.nve.apiKey` is unchanged.
- A cancellation that arrives while the cache is being read now rejects before the request is sent
  rather than after. Cancellation semantics are otherwise unchanged.

Provider rate limits were reconciled against the numbers recorded in `PROVIDERS.md`, and a
regression test now fails if a documented budget drifts from its descriptor.
