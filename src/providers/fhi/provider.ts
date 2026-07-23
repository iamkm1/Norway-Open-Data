import type { ProviderDescriptor } from "../../core/provider.js";

/** Norwegian Institute of Public Health (FHI) statistics-bank provider declaration. */
export const fhiProvider = {
  id: "fhi",
  name: "Norwegian Institute of Public Health (FHI)",
  homepage: "https://www.fhi.no/",
  documentation:
    "https://www.fhi.no/ta/statistikkalender_og_statistikkbanker/apen-api-og-statistikk/",
  access: "open",
  authentication: "None.",
  license: "Open API; each statistics bank publishes its own terms and source notes",
  attribution:
    "Credit Folkehelseinstituttet (FHI) and the publishing register; flagged observations must stay suppressed.",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "FHI publishes no numeric budget; statistics-bank queries are expensive, so the SDK stays conservative.",
    },
  },
  cacheTtlMs: {
    source: 24 * 60 * 60 * 1_000,
    tableList: 6 * 60 * 60 * 1_000,
    metadata: 24 * 60 * 60 * 1_000,
    query: 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
