import { z } from "zod";

import { type CacheStore, MemoryCache } from "./core/cache.js";
import { availableAuthValues, HttpClient } from "./core/client.js";
import { ConfigurationError } from "./core/errors.js";
import { missingAuthFields, type ProviderDescriptor } from "./core/provider.js";
import type { NorwayOpenDataConfig, ProviderCredentials, ResolvedConfig } from "./core/types.js";
import { ProfileClient } from "./profiles/client.js";
import { BrregClient } from "./providers/brreg/client.js";
import { DataNorgeClient } from "./providers/data-norge/client.js";
import { EnturClient } from "./providers/entur/client.js";
import { FhiClient } from "./providers/fhi/client.js";
import { ElectricityClient } from "./providers/hvakosterstrommen/client.js";
import { KartverketAddressClient } from "./providers/kartverket/address-client.js";
import { KartverketPlaceClient } from "./providers/kartverket/place-client.js";
import { MetClient } from "./providers/met/client.js";
import { NveEnergyClient } from "./providers/nve/energy-client.js";
import { NveHazardsClient } from "./providers/nve/hazards-client.js";
import { NorgesBankClient } from "./providers/norges-bank/client.js";
import { type ProviderId, providerIds } from "./providers/registry.js";
import { SsbClient } from "./providers/ssb/client.js";
import { StortingetClient } from "./providers/stortinget/client.js";
import { VegvesenClient } from "./providers/vegvesen/client.js";

const secretSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\r\n]/.test(value));

const providerCredentialSchema = z.object({ apiKey: secretSchema.optional() });

/**
 * Credentials are validated per registered provider id, so a new provider needs
 * no change here, and a misspelled provider name is rejected rather than
 * silently ignored.
 */
const credentialsSchema = z
  .object(Object.fromEntries(providerIds.map((id) => [id, providerCredentialSchema.optional()])))
  .strict();

const cacheStoreSchema = z.custom<CacheStore>(
  (value) =>
    typeof value === "object" &&
    value !== null &&
    typeof (value as CacheStore).get === "function" &&
    typeof (value as CacheStore).set === "function" &&
    typeof (value as CacheStore).clear === "function",
  { message: "cache.store must implement get, set and clear." },
);

const configSchema = z.object({
  applicationName: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .refine((value) => !/[\r\n]/.test(value))
    .optional(),
  contactEmail: z.email().optional(),
  timeoutMs: z.number().int().positive().optional(),
  retries: z.number().int().min(0).max(10).optional(),
  fetch: z.custom<typeof globalThis.fetch>((value) => typeof value === "function").optional(),
  cache: z
    .object({
      enabled: z.boolean().optional(),
      ttlMs: z.number().int().positive().optional(),
      maxEntries: z.number().int().positive().max(10_000).optional(),
      store: cacheStoreSchema.optional(),
    })
    .optional(),
  rateLimit: z.object({ enabled: z.boolean().optional() }).optional(),
  credentials: credentialsSchema.optional(),
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
      "A fetch implementation is required. Use Node.js 22+ or pass config.fetch.",
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
      ...(parsed.data.cache?.store === undefined ? {} : { store: parsed.data.cache.store }),
    },
    rateLimit: { enabled: parsed.data.rateLimit?.enabled ?? true },
    credentials: (parsed.data.credentials ?? {}) as ProviderCredentials,
  };
}

/**
 * Unified entry point for Norwegian open public data providers.
 *
 * Provider clients are initialized once and share retry, timeout, validation,
 * fetch injection, per-provider request budgets, caller identification and the
 * optional response cache.
 */
export class NorwayOpenData {
  readonly #cache: CacheStore;
  readonly companies: BrregClient;
  readonly statistics: SsbClient;
  readonly health: FhiClient;
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
  readonly electricity: ElectricityClient;

  /** Creates an SDK client with safe request defaults. */
  constructor(config: NorwayOpenDataConfig = {}) {
    const resolved = resolveConfig(config);
    const cache = resolved.cache.store ?? new MemoryCache(resolved.cache.maxEntries);
    this.#cache = cache;
    const http = new HttpClient(resolved, cache);
    this.companies = new BrregClient(http);
    this.statistics = new SsbClient(http);
    this.health = new FhiClient(http);
    this.addresses = new KartverketAddressClient(http);
    this.places = new KartverketPlaceClient(http);
    this.transport = new EnturClient(http);
    this.weather = new MetClient(http);
    this.catalog = new DataNorgeClient(http);
    this.currency = new NorgesBankClient(http);
    this.energy = new NveEnergyClient(http);
    this.hazards = new NveHazardsClient(http);
    this.parliament = new StortingetClient(http);
    this.roads = new VegvesenClient(http);
    this.electricity = new ElectricityClient(http);
    // Constructed last: cross-provider profiles depend on the clients above.
    this.profiles = new ProfileClient(this.companies, this.addresses, {
      weather: this.weather,
      hazards: this.hazards,
      roads: this.roads,
      statistics: this.statistics,
      health: this.health,
      canAuthenticate: (provider: ProviderDescriptor) =>
        missingAuthFields(provider, availableAuthValues(resolved, provider.id as ProviderId))
          .length === 0,
    });
  }

  /**
   * Removes every response cached for this SDK instance.
   *
   * With the default in-memory cache this affects only this instance. With a
   * shared {@link CacheStore} it clears whatever that store considers its
   * contents, which other instances may also be reading.
   */
  async clearCache(): Promise<void> {
    await this.#cache.clear();
  }
}
