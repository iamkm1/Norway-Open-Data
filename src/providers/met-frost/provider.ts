import { ConfigurationError } from "../../core/errors.js";
import { defineAuth, type ProviderDescriptor } from "../../core/provider.js";

/** Printable ASCII without a colon: what HTTP Basic can carry as a username. */
const BASIC_USERNAME_PATTERN = /^[\x21-\x39\x3b-\x7e]+$/;

/**
 * Encodes a Frost client ID as an HTTP Basic credential with an empty password.
 *
 * Frost issues UUIDs as client IDs. A colon would end the Basic username early
 * and `btoa` only encodes Latin-1, so anything else is a configuration mistake
 * reported before a request is sent.
 */
function basicCredential(clientId: string): string {
  if (!BASIC_USERNAME_PATTERN.test(clientId)) {
    throw new ConfigurationError(
      'credentials["met-frost"].clientId must be a Frost client ID: printable ASCII without a colon.',
      { provider: "met-frost" },
    );
  }
  return btoa(`${clientId}:`);
}

/**
 * MET Norway's Frost observation and climate archive.
 *
 * Declared separately from `met`: Frost is a different service with its own
 * self-registered client ID, licence declaration and failure contract.
 */
export const metFrostProvider = {
  id: "met-frost",
  name: "MET Norway Frost",
  homepage: "https://frost.met.no/",
  documentation: "https://frost.met.no/api.html",
  access: "registration-required",
  authentication:
    "Free Frost client ID sent as the HTTP Basic username. Register at https://frost.met.no/auth/requestCredentials.html.",
  license: "Creative Commons Attribution 3.0 Norway (CC BY 3.0 NO), as declared in Frost responses",
  attribution: "Credit the Norwegian Meteorological Institute (MET Norway) as its terms require.",
  auth: defineAuth({
    requires: ["clientId"],
    headers: ({ clientId }) => ({ Authorization: `Basic ${basicCredential(clientId)}` }),
    missing:
      'Frost requests require credentials["met-frost"].clientId, a free client ID from https://frost.met.no/auth/requestCredentials.html.',
  }),
  rateLimit: {
    default: {
      requests: 30,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "Frost publishes no numeric budget and answers overload with HTTP 429 or 503 and Retry-After; the SDK keeps a courtesy budget and obeys Retry-After.",
    },
  },
  cacheTtlMs: {
    stations: 24 * 60 * 60 * 1_000,
    timeSeries: 24 * 60 * 60 * 1_000,
    observations: 30 * 60 * 1_000,
    latest: 5 * 60 * 1_000,
    normals: 7 * 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
