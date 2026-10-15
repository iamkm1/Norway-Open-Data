import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * Kartverket's API for water level and tides, run by its Hydrographic Service.
 *
 * Declared separately from `kartverket`: it is an independently governed service
 * with its own terms, a mandatory credit to the Hydrographic Service, its own
 * capacity guidance and an XML-only contract.
 */
export const kartverketTidesProvider = {
  id: "kartverket-tides",
  name: "Kartverket Hydrographic Service",
  homepage: "https://www.kartverket.no/til-sjos/se-havniva",
  documentation: "https://vannstand.kartverket.no/tideapi_en.html",
  access: "open",
  authentication:
    "None. Kartverket asks clients to cache static data and to keep request volumes low.",
  license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
  attribution: "Credit the Norwegian Mapping Authority, Hydrographic Service (Kartverket).",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Kartverket describes capacity of about 20 requests per second shared by every user and asks clients to cache and limit requests; the SDK keeps a small courtesy budget.",
    },
  },
  cacheTtlMs: {
    stations: 24 * 60 * 60 * 1_000,
    levels: 24 * 60 * 60 * 1_000,
    tideTable: 6 * 60 * 60 * 1_000,
    waterLevels: 10 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
