import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

/**
 * NVE provider declaration.
 *
 * `auth` covers the HydAPI station and observation endpoints only. Reservoir,
 * power-plant and Varsom warning endpoints are anonymous, so their operations
 * never resolve the descriptor's auth.
 */
export const nveProvider = {
  id: "nve",
  name: "Norwegian Water Resources and Energy Directorate (NVE)",
  homepage: "https://www.nve.no/",
  documentation: "https://api.nve.no/doc/",
  access: "registration-required",
  authentication:
    "None for supported energy and warning endpoints; X-API-Key for HydAPI stations and observations.",
  license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  attribution: "Credit NVE; Varsom warning data also requires its specified attribution.",
  auth: defineAuth({
    requires: ["apiKey"],
    headers: ({ apiKey }) => ({ "X-API-Key": apiKey }),
    missing:
      "NVE HydAPI station and observation requests require credentials.nve.apiKey from free HydAPI registration.",
  }),
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "HydAPI throttles a fixed but unpublished number of requests per key; the SDK keeps well inside a conservative budget.",
    },
  },
  cacheTtlMs: {
    reservoir: 60 * 60 * 1_000,
    powerPlant: 24 * 60 * 60 * 1_000,
    warning: 5 * 60 * 1_000,
    station: 24 * 60 * 60 * 1_000,
    observation: 10 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
