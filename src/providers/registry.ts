import {
  type ProviderDescriptor,
  type ProviderMetadata,
  providerMetadata,
} from "../core/provider.js";
import { brregProvider } from "./brreg/provider.js";
import { dataNorgeProvider } from "./data-norge/provider.js";
import { enturProvider } from "./entur/provider.js";
import { fhiProvider } from "./fhi/provider.js";
import { hvakosterstrommenProvider } from "./hvakosterstrommen/provider.js";
import { kartverketProvider } from "./kartverket/provider.js";
import { metProvider } from "./met/provider.js";
import { norgesBankProvider } from "./norges-bank/provider.js";
import { nveProvider } from "./nve/provider.js";
import { ssbProvider } from "./ssb/provider.js";
import { stortingetProvider } from "./stortinget/provider.js";
import { vegvesenProvider } from "./vegvesen/provider.js";

/**
 * Collects provider descriptors, requiring every registry key to equal the
 * descriptor's own `id`.
 *
 * The SDK uses one spelling of a provider identifier everywhere -- registry
 * key, error messages, response `source.id` and the `credentials` config -- and
 * this signature is what keeps those from drifting apart.
 */
function registry<const T extends Record<string, ProviderDescriptor>>(
  descriptors: T & { [Key in keyof T]: { readonly id: Key } },
): T {
  return descriptors;
}

/** Every provider the SDK supports, keyed by provider id. */
export const providerDescriptors = registry({
  brreg: brregProvider,
  "data-norge": dataNorgeProvider,
  entur: enturProvider,
  fhi: fhiProvider,
  hvakosterstrommen: hvakosterstrommenProvider,
  kartverket: kartverketProvider,
  met: metProvider,
  "norges-bank": norgesBankProvider,
  nve: nveProvider,
  ssb: ssbProvider,
  stortinget: stortingetProvider,
  vegvesen: vegvesenProvider,
});

/** Provider registry key. Identical to the provider's `id`. */
export type ProviderId = keyof typeof providerDescriptors;

/** Every supported provider id, in registry order. */
export const providerIds = Object.keys(providerDescriptors) as readonly ProviderId[];

/** Legal and operational metadata for every supported provider, keyed by provider id. */
export const providers: Readonly<Record<ProviderId, ProviderMetadata>> = Object.fromEntries(
  Object.entries(providerDescriptors).map(([id, descriptor]) => [id, providerMetadata(descriptor)]),
) as Record<ProviderId, ProviderMetadata>;
