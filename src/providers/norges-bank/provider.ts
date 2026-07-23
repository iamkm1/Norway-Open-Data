import type { ProviderDescriptor } from "../../core/provider.js";

/** Norges Bank SDMX data provider declaration. */
export const norgesBankProvider = {
  id: "norges-bank",
  name: "Norges Bank",
  homepage: "https://www.norges-bank.no/en/",
  documentation: "https://data.norges-bank.no/",
  access: "open",
  authentication: "None for the supported SDMX data API.",
  license: "Norges Bank reuse terms (source attribution required)",
  attribution: "State Norges Bank as the source when reusing data.",
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Norges Bank states no numeric public API budget; the SDK keeps time-series retrieval polite.",
    },
  },
  cacheTtlMs: {
    rates: 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
