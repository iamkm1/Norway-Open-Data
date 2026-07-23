import { describe, expect, it } from "vitest";

import { ConfigurationError } from "../../src/core/errors.js";
import {
  missingAuthFields,
  type ProviderDescriptor,
  responseSource,
} from "../../src/core/provider.js";
import { NorwayOpenData } from "../../src/index.js";
import { providerDescriptors, providerIds, providers } from "../../src/providers/registry.js";

const descriptors: [string, ProviderDescriptor][] = Object.entries(providerDescriptors);

describe("provider registry", () => {
  it("keys every descriptor by its own id", () => {
    for (const [key, descriptor] of descriptors) {
      expect(descriptor.id).toBe(key);
    }
  });

  it("exposes public metadata for every registered provider", () => {
    expect(Object.keys(providers).sort()).toEqual([...providerIds].sort());
    for (const id of providerIds) {
      expect(providers[id]).toMatchObject({
        id,
        name: expect.any(String),
        homepage: expect.stringMatching(/^https:\/\//),
        documentation: expect.stringMatching(/^https:\/\//),
      });
    }
  });

  it("keeps behavioural fields out of the documented metadata", () => {
    for (const id of providerIds) {
      expect(providers[id]).not.toHaveProperty("auth");
      expect(providers[id]).not.toHaveProperty("cacheTtlMs");
    }
  });

  it("declares at least one usable cache lifetime per provider", () => {
    for (const [id, descriptor] of descriptors) {
      const lifetimes = Object.values(descriptor.cacheTtlMs);
      expect(lifetimes.length, id).toBeGreaterThan(0);
      for (const ttl of lifetimes) expect(ttl, id).toBeGreaterThan(0);
    }
  });

  it("declares coherent request budgets", () => {
    for (const [id, descriptor] of descriptors) {
      if (descriptor.rateLimit === undefined) continue;
      expect(descriptor.rateLimit.default, id).toBeDefined();
      for (const [operationClass, policy] of Object.entries(descriptor.rateLimit)) {
        const label = `${id}.${operationClass}`;
        expect(policy.requests, label).toBeGreaterThan(0);
        expect(policy.intervalMs, label).toBeGreaterThan(0);
        expect(policy.note, label).not.toHaveLength(0);
        // A documented limit must cite the provider; a courtesy budget must not
        // pretend the provider published a number.
        expect(["provider-documented", "sdk-courtesy"], label).toContain(policy.basis);
      }
    }
  });

  it("matches the request budgets recorded in PROVIDERS.md", () => {
    // These three are the numbers providers actually publish. Changing one here
    // without changing the provider documentation is a drift bug.
    expect(providerDescriptors.ssb.rateLimit?.default).toMatchObject({
      requests: 30,
      intervalMs: 60_000,
      basis: "provider-documented",
    });
    expect(providerDescriptors["data-norge"].rateLimit?.default).toMatchObject({
      requests: 10,
      intervalMs: 60_000,
      basis: "provider-documented",
    });
    expect(providerDescriptors["data-norge"].rateLimit?.resource).toMatchObject({
      requests: 5,
      intervalMs: 1_000,
      basis: "provider-documented",
    });
    expect(providerDescriptors.stortinget.rateLimit?.default).toMatchObject({
      requests: 100,
      intervalMs: 60_000,
      basis: "provider-documented",
    });
  });

  it("builds complete headers from only the fields each provider declared", () => {
    // Catches a descriptor that reads a value it never required: the core supplies
    // only declared fields, so such a header would render as "undefined".
    for (const [id, descriptor] of descriptors) {
      const auth = descriptor.auth;
      if (auth === undefined) continue;
      const supplied = Object.fromEntries(
        auth.requires.map((field) => [field, `configured-${field}`]),
      );
      const headers = auth.headers({ ...supplied, sdkVersion: "1.2.3" } as never);
      const entries = Object.entries(headers);
      expect(entries.length, id).toBeGreaterThan(0);
      for (const [name, value] of entries) {
        const label = `${id} ${name}`;
        expect(
          typeof value,
          `${label} must be a string; the descriptor likely read an
undeclared auth field. Declare it in requires, or build the header from a declared value.`,
        ).toBe("string");
        expect(value, label).not.toMatch(/undefined|null|\[object/);
        expect(value.trim(), label).not.toHaveLength(0);
        // A header the SDK sends must not contain CR/LF.
        expect(value, label).not.toMatch(/[\r\n]/);
      }
    }
  });

  it("gives every authenticating provider a requirement and an actionable message", () => {
    for (const [id, descriptor] of descriptors) {
      if (descriptor.auth === undefined) continue;
      expect(descriptor.auth.requires.length, id).toBeGreaterThan(0);
      expect(descriptor.auth.missing, id).toMatch(/applicationName|contactEmail|apiKey/);
      // A provider that needs identification must say so in its access model.
      expect(descriptor.access, id).not.toBe("open");
    }
  });

  it("builds a response source from a descriptor without leaking extra fields", () => {
    const source = responseSource(providerDescriptors.ssb);
    expect(source).toEqual({
      id: "ssb",
      name: providerDescriptors.ssb.name,
      homepage: providerDescriptors.ssb.homepage,
      documentation: providerDescriptors.ssb.documentation,
      license: providerDescriptors.ssb.license,
      attribution: providerDescriptors.ssb.attribution,
    });
  });
});

describe("descriptor-driven authentication", () => {
  it("reports exactly the fields a provider is still missing", () => {
    expect(missingAuthFields(providerDescriptors.met, {})).toEqual([
      "applicationName",
      "contactEmail",
    ]);
    expect(missingAuthFields(providerDescriptors.met, { applicationName: "app" })).toEqual([
      "contactEmail",
    ]);
    expect(
      missingAuthFields(providerDescriptors.met, {
        applicationName: "app",
        contactEmail: "team@example.test",
      }),
    ).toEqual([]);
  });

  it("treats a blank value as absent", () => {
    expect(missingAuthFields(providerDescriptors.entur, { applicationName: "   " })).toEqual([
      "applicationName",
    ]);
  });

  it("requires nothing from an anonymous provider", () => {
    expect(missingAuthFields(providerDescriptors.brreg, {})).toEqual([]);
  });

  it("fails before the network with the provider's own instructions", async () => {
    const fetch = (): never => {
      throw new Error("Network access must not be attempted.");
    };
    const sdk = new NorwayOpenData({ fetch: fetch as unknown as typeof globalThis.fetch });

    await expect(sdk.transport.autocomplete({ text: "Oslo S" })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    await expect(sdk.weather.forecast({ latitude: 59.9, longitude: 10.7 })).rejects.toThrow(
      /applicationName and contactEmail/,
    );
    await expect(sdk.roads.getRoadObjectTypes()).rejects.toThrow(/X-Client/);
  });

  it("rejects credentials for a provider that is not registered", () => {
    expect(
      () =>
        new NorwayOpenData({
          credentials: { nvee: { apiKey: "x" } } as unknown as Record<string, { apiKey: string }>,
        }),
    ).toThrow(ConfigurationError);
  });
});
