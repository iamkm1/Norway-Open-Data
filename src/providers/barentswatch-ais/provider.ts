import { defineOAuth } from "../../core/oauth.js";
import type { ProviderDescriptor } from "../../core/provider.js";

/**
 * BarentsWatch AIS provider declaration.
 *
 * Separate from the `barentswatch` descriptor because BarentsWatch issues two
 * different kinds of self-registered client: an AIS-client, whose tokens carry
 * the `ais` scope and reach the AIS hosts, and an API-client, whose tokens carry
 * the `api` scope and reach the rest of the platform. A secret registered for one
 * is not accepted by the other, so they are configured, scoped and cached apart.
 *
 * Two hosts share this descriptor: `live.ais.barentswatch.no` for current
 * positions and the streaming feeds, and `historic.ais.barentswatch.no` for
 * tracks over the retained window. Both are the same service under one set of
 * terms, one scope and one request budget.
 */
export const barentswatchAisProvider = {
  id: "barentswatch-ais",
  name: "BarentsWatch AIS",
  homepage: "https://www.barentswatch.no/",
  documentation: "https://developer.barentswatch.no/docs/AIS/live-ais-api/",
  access: "registration-required",
  authentication:
    "OAuth2 client credentials with the `ais` scope, from a self-registered AIS-client on BarentsWatch MyPage.",
  license: "Norwegian Licence for Open Government Data (NLOD)",
  attribution:
    "AIS data is provided by the Norwegian Coastal Administration (Kystverket) via BarentsWatch; credit both.",
  oauth: defineOAuth({
    tokenUrl: "https://id.barentswatch.no/connect/token",
    scope: "ais",
    missing:
      "BarentsWatch AIS requests require credentials['barentswatch-ais'].clientId and clientSecret from an AIS-client registered at https://www.barentswatch.no/minside/. An API-client secret will not work; AIS needs its own client.",
  }),
  rateLimit: {
    default: {
      requests: 60,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "BarentsWatch publishes no request-per-minute figure for the AIS APIs; the SDK keeps polling well inside a conservative budget so a busy caller is not mistaken for abuse.",
    },
    /**
     * Streaming connections are opened, not polled. They are budgeted far more
     * tightly than requests because each one holds a socket open for as long as
     * the caller iterates it, and a reconnect loop is the failure mode most
     * likely to look like an attack.
     */
    stream: {
      requests: 5,
      intervalMs: 60_000,
      basis: "sdk-courtesy",
      note: "A live feed is meant to be opened once and held; this budget bounds an accidental reopen loop without limiting normal use.",
    },
  },
  cacheTtlMs: {
    /** Tracks are historical once recorded, but the 24-hour window keeps moving. */
    track: 2 * 60 * 1_000,
    /** A position snapshot is stale almost immediately; cached only to absorb bursts. */
    latest: 30 * 1_000,
    /** Vessel identity from AIS static messages changes rarely. */
    vesselSearch: 10 * 60 * 1_000,
    /** The published coverage area changes on the order of months. */
    coverage: 24 * 60 * 60 * 1_000,
  },
} as const satisfies ProviderDescriptor;
