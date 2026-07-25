import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * Fiskeridirektoratet public aquaculture register (Akvakulturregisteret).
 *
 * Separate from `fiskeridir-vessels`; see that descriptor for why the two
 * registers are declared independently.
 */
export const fiskeridirAquaProvider = {
  id: "fiskeridir-aqua",
  name: "Norwegian Directorate of Fisheries — aquaculture register",
  homepage: "https://www.fiskeridir.no/english",
  documentation: "https://api.fiskeridir.no/pub-aqua/api/swagger-ui/index.html",
  access: "open",
  authentication: "None. The public register is served anonymously.",
  license: "Fiskeridirektoratet data licence, published under NLOD terms",
  attribution: "Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).",
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Fiskeridirektoratet publishes no request budget for the public aquaculture register; the SDK keeps paging polite and bounds a runaway loop.",
    },
  },
  cacheTtlMs: {
    /** Site clearances and capacities change on the timescale of decisions, not minutes. */
    search: 60 * 60 * 1_000,
    detail: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
