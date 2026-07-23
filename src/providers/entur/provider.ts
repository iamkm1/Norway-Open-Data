import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

/** Entur geocoding, departure-board and journey-planning provider declaration. */
export const enturProvider = {
  id: "entur",
  name: "Entur",
  homepage: "https://entur.no/",
  documentation: "https://developer.entur.no/",
  access: "identification-required",
  authentication: "ET-Client-Name request header.",
  license: "Norwegian Licence for Open Government Data (NLOD)",
  attribution: "Attribute Entur and the relevant source transport authority.",
  auth: defineAuth({
    requires: ["applicationName"],
    headers: ({ applicationName }) => ({ "ET-Client-Name": applicationName }),
    missing:
      "Entur requests require applicationName (normally company-application) for ET-Client-Name.",
  }),
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Entur publishes no numeric budget but may throttle or block unidentified clients; the SDK keeps realtime polling modest.",
    },
  },
  cacheTtlMs: {
    autocomplete: 5 * 60 * 1_000,
    realtime: 20 * 1_000,
  },
} as const satisfies ProviderDescriptor;
