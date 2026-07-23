import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

/** Statens vegvesen NVDB provider declaration. */
export const vegvesenProvider = {
  id: "vegvesen",
  name: "Statens vegvesen",
  homepage: "https://www.vegvesen.no/",
  documentation: "https://nvdb.atlas.vegvesen.no/docs/produkter/nvdbapil/v4/introduksjon/Oversikt/",
  access: "identification-required",
  authentication: "Meaningful X-Client header; no API key for supported NVDB read endpoints.",
  license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  attribution: "Credit Statens vegvesen and NVDB when redistributing data.",
  auth: defineAuth({
    requires: ["applicationName"],
    headers: ({ applicationName }) => ({ "X-Client": applicationName }),
    missing: "Statens vegvesen requests require applicationName for the mandatory X-Client header.",
  }),
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "The NVDB V4 overview states no numeric budget but asks for modest, cached, throttling-aware use.",
    },
  },
  cacheTtlMs: {
    typeMetadata: 24 * 60 * 60 * 1_000,
    roadData: 5 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
