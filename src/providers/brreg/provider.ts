import type { ProviderDescriptor } from "../../core/provider.js";

/** Brønnøysundregistrene (Enhetsregisteret) provider declaration. */
export const brregProvider = {
  id: "brreg",
  name: "Brønnøysundregistrene",
  homepage: "https://www.brreg.no/",
  documentation: "https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html",
  access: "open",
  authentication: "None for supported Enhetsregisteret endpoints.",
  license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Enhetsregisteret publishes no numeric budget; the SDK keeps bulk iteration polite.",
    },
  },
  cacheTtlMs: {
    company: 15 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
