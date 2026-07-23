import type { ProviderDescriptor } from "../../core/provider.js";

/** Data.norge.no catalogue provider declaration. */
export const dataNorgeProvider = {
  id: "data-norge",
  name: "Data.norge.no",
  homepage: "https://data.norge.no/",
  documentation: "https://data.norge.no/en/technical/api",
  access: "open",
  authentication: "None for the supported search and resource endpoints.",
  license: "Resource-specific access rights and licences are included where published",
  attribution:
    "Observe each resource publisher's access rights, licence, and attribution terms; catalogue inclusion does not imply free reuse.",
  rateLimit: {
    default: {
      requests: 10,
      intervalMs: 60_000,
      basis: "provider-documented",
      note: "The Search API documents 10 requests/minute with a burst of 20 and returns HTTP 429 beyond it.",
    },
    resource: {
      requests: 5,
      intervalMs: 1_000,
      basis: "provider-documented",
      note: "The Resource Service documents 5 requests/second with a burst of 10, separately from the Search API.",
    },
  },
  cacheTtlMs: {
    search: 10 * 60 * 1_000,
    resource: 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
