import { defineOAuth } from "../../core/oauth.js";
import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * BarentsWatch platform API provider declaration, covering the marine forecast
 * services behind `www.barentswatch.no/bwapi`.
 *
 * Separate from `barentswatch-ais` because BarentsWatch issues two different
 * kinds of self-registered client. This descriptor is the API-client, whose
 * tokens carry the `api` scope; the AIS hosts require an AIS-client with the
 * `ais` scope instead. Neither client's secret is accepted by the other service,
 * so they are configured under their own provider ids and their tokens are cached
 * separately.
 */
export const barentswatchProvider = {
  id: "barentswatch",
  name: "BarentsWatch",
  homepage: "https://www.barentswatch.no/",
  documentation: "https://developer.barentswatch.no/docs/appreg/",
  access: "registration-required",
  authentication:
    "OAuth2 client credentials with the `api` scope, from a self-registered API-client on BarentsWatch MyPage.",
  license: "Norwegian Licence for Open Government Data (NLOD)",
  attribution: "Credit BarentsWatch and the wave forecast's own upstream model provider.",
  oauth: defineOAuth({
    tokenUrl: "https://id.barentswatch.no/connect/token",
    scope: "api",
    missing:
      "BarentsWatch marine requests require credentials.barentswatch.clientId and clientSecret from an API-client registered at https://www.barentswatch.no/minside/. An AIS-client secret will not work; the AIS APIs use the separate 'barentswatch-ais' provider.",
  }),
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "BarentsWatch publishes no request-per-minute figure; forecasts are refreshed on a model schedule measured in hours, so this budget is generous for any real use.",
    },
  },
  cacheTtlMs: {
    /**
     * Wave and current forecasts come from numerical models rerun a few times a
     * day, so a caller polling faster than this gains nothing.
     */
    forecast: 30 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
