import { z } from "zod";

import { MemoryCache } from "./core/cache.js";
import { HttpClient } from "./core/client.js";
import { ConfigurationError } from "./core/errors.js";
import type { NorwayOpenDataConfig, ResolvedConfig } from "./core/types.js";
import { ProfileClient } from "./profiles/client.js";
import { BrregClient } from "./providers/brreg/client.js";
import { DataNorgeClient } from "./providers/data-norge/client.js";
import { EnturClient } from "./providers/entur/client.js";
import { KartverketAddressClient } from "./providers/kartverket/address-client.js";
import { KartverketPlaceClient } from "./providers/kartverket/place-client.js";
import { MetClient } from "./providers/met/client.js";
import { NveEnergyClient } from "./providers/nve/energy-client.js";
import { NveHazardsClient } from "./providers/nve/hazards-client.js";
import { NorgesBankClient } from "./providers/norges-bank/client.js";
import { SsbClient } from "./providers/ssb/client.js";
import { StortingetClient } from "./providers/stortinget/client.js";
import { VegvesenClient } from "./providers/vegvesen/client.js";

const configSchema = z.object({
  applicationName: z.string().trim().min(1).optional(),
  contactEmail: z.email().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function").optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      ttlMs: z.number().int().positive().optional(),
      maxEntries: z.number().int().positive().max(10_000).optional(),
    })
    .optional(),
  credentials: z
    .object({
      nve: z
        .object({
          apiKey: z.string().trim().min(1).optional(),
        })
        .optional(),
    })
    .optional(),
});

function resolveConfig(config: NorwayOpenDataConfig): ResolvedConfig {
  const parsed = configSchema.safeParse(config);
  if (!parsed.success) {
    throw new ConfigurationError("Invalid NorwayOpenData configuration.", {
      cause: parsed.error,
    });
  }
  const fetchImplementation = parsed.data.fetch ?? globalThis.fetch;
  if (typeof fetchImplementation !== "function") {
    throw new ConfigurationError(
      "A fetch implementation is required. Use Node.js 20+ or pass config.fetch.",
    );
  }
  return {
    ...(parsed.data.applicationName === undefined
      ? {}
      : { applicationName: parsed.data.applicationName }),
    ...(parsed.data.contactEmail === undefined ? {} : { contactEmail: parsed.data.contactEmail }),
    timeoutMs: parsed.data.timeoutMs ?? 10_000,
    retries: parsed.data.retries ?? 2,
    fetch: fetchImplementation,
    cache: {
      enabled: parsed.data.cache?.enabled ?? false,
      ...(parsed.data.cache?.ttlMs === undefined ? {} : { ttlMs: parsed.data.cache.ttlMs }),
      maxEntries: parsed.data.cache?.maxEntries ?? 100,
    },
    credentials: {
      nve: {
        ...(parsed.data.credentials?.nve?.apiKey === undefined
          ? {}
          : { apiKey: parsed.data.credentials.nve.apiKey }),
      },
    },
  };
}

/**
 * Unified entry point for Norwegian open public data providers.
 *
 * Provider clients are initialized once and share retry, timeout, validation,
 * fetch injection, and optional in-memory caching infrastructure.
 */
export class NorwayOpenData {
  readonly companies: BrregClient;
  readonly statistics: SsbClient;
  readonly addresses: KartverketAddressClient;
  readonly places: KartverketPlaceClient;
  readonly transport: EnturClient;
  readonly weather: MetClient;
  readonly profiles: ProfileClient;
  readonly catalog: DataNorgeClient;
  readonly currency: NorgesBankClient;
  readonly energy: NveEnergyClient;
  readonly hazards: NveHazardsClient;
  readonly parliament: StortingetClient;
  readonly roads: VegvesenClient;

  /** Creates an SDK client with safe request defaults. */
  constructor(config: NorwayOpenDataConfig = {}) {
    const resolved = resolveConfig(config);
    const cache = new MemoryCache(resolved.cache.maxEntries);
    const http = new HttpClient(resolved, cache);
    this.companies = new BrregClient(http);
    this.statistics = new SsbClient(http);
    this.addresses = new KartverketAddressClient(http);
    this.places = new KartverketPlaceClient(http);
    this.transport = new EnturClient(http, resolved.applicationName);
    this.weather = new MetClient(http, resolved.applicationName, resolved.contactEmail);
    this.profiles = new ProfileClient(this.companies, this.addresses);
    this.catalog = new DataNorgeClient(http);
    this.currency = new NorgesBankClient(http);
    this.energy = new NveEnergyClient(http);
    this.hazards = new NveHazardsClient(http, resolved.credentials.nve.apiKey);
    this.parliament = new StortingetClient(http);
    this.roads = new VegvesenClient(http, resolved.applicationName);
  }
}
