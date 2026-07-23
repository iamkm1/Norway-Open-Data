import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

/** MET Norway Locationforecast provider declaration. */
export const metProvider = {
  id: "met",
  name: "MET Norway",
  homepage: "https://www.met.no/en",
  documentation: "https://api.met.no/doc/",
  access: "identification-required",
  authentication: "Meaningful User-Agent containing application and contact information.",
  license: "NLOD 2.0 and CC BY 4.0 unless the product states otherwise",
  attribution: "Credit the Norwegian Meteorological Institute as required by its terms.",
  auth: defineAuth({
    requires: ["applicationName", "contactEmail"],
    headers: ({ applicationName, contactEmail, sdkVersion }) => ({
      "User-Agent": `NorwayOpenDataSDK/${sdkVersion} ${applicationName} ${contactEmail}`,
    }),
    missing:
      "MET Norway requests require both applicationName and contactEmail so the User-Agent identifies the caller.",
  }),
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "MET asks clients exceeding 20 requests/second per application to seek agreement; the SDK stays far below that and honours Expires through caching.",
    },
  },
  cacheTtlMs: {
    forecast: 10 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
