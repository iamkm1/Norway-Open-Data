import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * Kartverket address, place-name and municipality-lookup provider declaration.
 *
 * Covers the open Geonorge APIs for addresses and place names and the Kommuneinfo
 * API, which share access terms. Kartverket's tide and water-level API is run by
 * its Hydrographic Service under separate terms and is declared separately.
 */
export const kartverketProvider = {
  id: "kartverket",
  name: "Kartverket",
  homepage: "https://www.kartverket.no/en",
  documentation: "https://ws.geonorge.no/",
  access: "open",
  authentication: "None for supported address, place-name and municipality-lookup endpoints.",
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
    municipality: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
