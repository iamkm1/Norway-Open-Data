import type { ProviderDescriptor } from "../../core/provider.js";

/** Stortinget open-data provider declaration. */
export const stortingetProvider = {
  id: "stortinget",
  name: "Stortinget",
  homepage: "https://www.stortinget.no/en/In-English/",
  documentation: "https://data.stortinget.no/dokumentasjon-og-hjelp/",
  access: "open",
  authentication: "None.",
  license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  attribution: "Credit Stortinget as the source.",
  rateLimit: {
    default: {
      requests: 100,
      intervalMs: 60_000,
      basis: "provider-documented",
      note: "data.stortinget.no allows 100 API calls/minute and returns HTTP 429 beyond it.",
    },
  },
  cacheTtlMs: {
    people: 6 * 60 * 60 * 1_000,
    parliamentaryData: 15 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
