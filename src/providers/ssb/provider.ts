import type { ProviderDescriptor } from "../../core/provider.js";

/** Statistics Norway (SSB) PxWebApi 2.0 provider declaration. */
export const ssbProvider = {
  id: "ssb",
  name: "Statistics Norway (SSB)",
  homepage: "https://www.ssb.no/en/",
  documentation: "https://www.ssb.no/en/api/pxwebapiv2",
  access: "open",
  authentication: "None.",
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution: "Attribute Statistics Norway when redistributing data.",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "provider-documented",
      note: "PxWeb API v2 allows 30 queries per 60 seconds per IP address.",
    },
  },
  cacheTtlMs: {
    metadata: 24 * 60 * 60 * 1_000,
    query: 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
