import type { ProviderDescriptor } from "../../core/provider.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1_000;

/** Statistics Norway's Klass classifications and codelists provider declaration. */
export const ssbKlassProvider = {
  id: "ssb-klass",
  name: "Statistics Norway (SSB) Klass",
  homepage: "https://www.ssb.no/en/klass/",
  documentation: "https://data.ssb.no/api/klass/v1/api-guide.html",
  access: "open",
  authentication: "None.",
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution:
    "Statistics Norway (SSB), Klass — CC BY 4.0. Link to ssb.no and the licence, and indicate changes.",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "SSB publishes no numeric Klass API budget; the SDK conservatively allows 30 requests per minute.",
    },
  },
  cacheTtlMs: {
    classifications: ONE_DAY_MS,
    classification: ONE_DAY_MS,
    version: ONE_DAY_MS,
    codes: ONE_DAY_MS,
    correspondenceTables: ONE_DAY_MS,
    correspondence: ONE_DAY_MS,
    changes: ONE_DAY_MS,
  },
} as const satisfies ProviderDescriptor;
