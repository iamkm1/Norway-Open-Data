import type { ProviderDescriptor } from "../../core/provider.js";

/** NIBIO's open, generalized AR50 land-resource WFS. */
export const nibioProvider = {
  id: "nibio",
  name: "Norwegian Institute of Bioeconomy Research (NIBIO)",
  homepage: "https://www.nibio.no/",
  documentation: "https://www.nibio.no/tjenester/wfs-tjenester/wfs-tjeneste-ar50",
  access: "open",
  authentication: "None for the supported AR50 WFS.",
  license: "Norwegian Licence for Open Government Data (NLOD) 1.0",
  attribution: "Kilde: NIBIO.",
  rateLimit: {
    default: {
      requests: 20,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "NIBIO publishes no numeric WFS budget; the SDK uses bounded pages and a conservative request rate.",
    },
  },
  cacheTtlMs: {
    landResource: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
