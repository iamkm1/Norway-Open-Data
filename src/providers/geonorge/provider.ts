import type { ProviderDescriptor } from "../../core/provider.js";

/** Geonorge's national geospatial metadata catalogue provider declaration. */
export const geonorgeProvider = {
  id: "geonorge",
  name: "Geonorge / Kartverket",
  homepage: "https://www.geonorge.no/",
  documentation: "https://kartkatalog.geonorge.no/swagger/index.html",
  access: "open",
  authentication: "None for the supported catalogue search and metadata endpoints.",
  license:
    "CC BY 4.0 for Kartverket open products; catalogued resources have publisher-specific licences and access constraints.",
  attribution:
    "Credit © Kartverket for the Geonorge catalogue; also follow each resource publisher's licence and attribution metadata.",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Geonorge publishes no numeric Kartkatalog API budget; the SDK keeps catalogue access polite.",
    },
  },
  cacheTtlMs: {
    search: 10 * 60 * 1_000,
    metadata: 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
