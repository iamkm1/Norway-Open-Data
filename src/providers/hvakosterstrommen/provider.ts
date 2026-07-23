import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * Hva koster strømmen? provider declaration.
 *
 * Independently operated rather than official: the service converts ENTSO-E
 * euro prices to NOK using a Norges Bank exchange rate and publishes the result
 * as static per-day documents.
 */
export const hvakosterstrommenProvider = {
  id: "hvakosterstrommen",
  name: "Hva koster strømmen?",
  homepage: "https://www.hvakosterstrommen.no/",
  documentation: "https://www.hvakosterstrommen.no/strompris-api",
  access: "open",
  authentication: "None.",
  license: "Provider describes the API as open and free; no standardized licence stated",
  attribution:
    "Credit hvakosterstrommen.no; its API states that it sources euro prices from ENTSO-E and converts them using Norges Bank exchange rates.",
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "A small independently operated service publishing static day documents; the SDK keeps its budget deliberately low.",
    },
  },
  cacheTtlMs: {
    price: 30 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
