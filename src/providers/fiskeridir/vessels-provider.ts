import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * Fiskeridirektoratet vessel register (Fartøyregisteret / Merkeregisteret).
 *
 * A separate descriptor from `fiskeridir-aqua` even though one directorate runs
 * both: the two registers have their own base URLs, their own contact teams, and
 * incompatible paging models -- page numbers with a total count here, an offset
 * range there. One descriptor would have to describe both and would misstate each.
 * They share a namespace (`fisheries`) because a caller thinks of them as one
 * agency, and a licence because they are published under the same terms.
 */
export const fiskeridirVesselsProvider = {
  id: "fiskeridir-vessels",
  name: "Norwegian Directorate of Fisheries — vessel register",
  homepage: "https://www.fiskeridir.no/english",
  documentation: "https://api.fiskeridir.no/vessel-api/api/openapi.json",
  access: "open",
  authentication: "None. The register is served anonymously.",
  license: "Fiskeridirektoratet data licence, published under NLOD terms",
  attribution: "Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).",
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Fiskeridirektoratet publishes no request budget for the vessel register; the SDK keeps paging polite and bounds a runaway loop.",
    },
  },
  cacheTtlMs: {
    /** The register changes as vessels are entered and removed, not by the minute. */
    search: 60 * 60 * 1_000,
    detail: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
