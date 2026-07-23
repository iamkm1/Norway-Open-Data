import type { ProviderDescriptor } from "../../core/provider.js";

/** Kartverket address and place-name provider declaration. */
export const kartverketProvider = {
  id: "kartverket",
  name: "Kartverket",
  homepage: "https://www.kartverket.no/en",
  documentation: "https://ws.geonorge.no/",
  access: "open",
  authentication: "None for supported address and place-name endpoints.",
  license: "See Geonorge dataset-specific terms and licences",
  attribution: "Attribute Kartverket where required by the selected dataset.",
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Geonorge publishes no numeric budget; the SDK keeps address lookups polite.",
    },
  },
  cacheTtlMs: {
    address: 24 * 60 * 60 * 1_000,
    place: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
