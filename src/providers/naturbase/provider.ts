import type { ProviderDescriptor } from "../../core/provider.js";

/** Miljødirektoratet's fixed, openly licensed Naturbase vector services. */
export const naturbaseProvider = {
  id: "naturbase",
  name: "Norwegian Environment Agency (Miljødirektoratet) / Naturbase",
  homepage: "https://www.miljodirektoratet.no/",
  documentation: "https://kartkatalog.miljodirektoratet.no/",
  access: "open",
  authentication: "None for the supported public ArcGIS REST and WFS layers.",
  license: "Norwegian Licence for Open Government Data (NLOD)",
  attribution:
    "Contains data made available by Miljødirektoratet under the Norwegian Licence for Open Government Data (NLOD).",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Miljødirektoratet publishes no numeric request budget; bounded spatial pages keep use polite.",
    },
  },
  cacheTtlMs: {
    protectedArea: 6 * 60 * 60 * 1_000,
    natureType: 6 * 60 * 60 * 1_000,
    interventionFreeArea: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
