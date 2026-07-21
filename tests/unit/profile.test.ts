import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import addressFixture from "../fixtures/kartverket-address.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import {
  NorwayOpenData,
  providers,
  type OpenDataSource,
  type ProviderMetadata,
} from "../../src/index.js";
import { selectAddressMatch } from "../../src/profiles/company-profile.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

const RETRIEVED_AT = "2026-07-21T10:15:30.000Z";

function expectedSource(provider: ProviderMetadata): OpenDataSource {
  return {
    id: provider.id,
    name: provider.name,
    homepage: provider.homepage,
    documentation: provider.documentation,
    ...(provider.license === undefined ? {} : { license: provider.license }),
    ...(provider.attribution === undefined ? {} : { attribution: provider.attribution }),
  };
}

describe("company profiles", () => {
  it("assigns confidence only when address evidence exists", () => {
    const business = {
      addressText: "Haraldsgata 100",
      postalCode: "5528",
      municipalityCode: "1106",
    };
    const coordinates = { latitude: 59.41, longitude: 5.27 };
    expect(selectAddressMatch(business, [{ ...business, ...coordinates }])?.matchConfidence).toBe(
      "exact",
    );
    expect(
      selectAddressMatch(business, [
        { addressText: "Haraldsgata 100", municipalityCode: "1106", ...coordinates },
      ])?.matchConfidence,
    ).toBe("high");
    expect(
      selectAddressMatch(business, [{ addressText: "Haraldsgata 100", ...coordinates }])
        ?.matchConfidence,
    ).toBe("possible");
    expect(
      selectAddressMatch(business, [
        { addressText: "Unrelated street 1", postalCode: "0001", ...coordinates },
      ]),
    ).toBeUndefined();
    expect(
      selectAddressMatch(business, [
        { addressText: "Unrelated street 1", ...coordinates },
        { ...business, ...coordinates },
      ])?.matchConfidence,
    ).toBe("exact");
    expect(
      selectAddressMatch({ addressText: "Haraldsgata 100", postalCode: "", municipalityCode: "" }, [
        {
          addressText: "Haraldsgata 100",
          postalCode: "",
          municipalityCode: "",
          ...coordinates,
        },
      ])?.matchConfidence,
    ).toBe("possible");
    expect(selectAddressMatch(business, [{ ...business }])).toBeUndefined();
  });

  it("enriches a company with official coordinates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RETRIEVED_AT));
    try {
      const { fetch, mock } = sequenceFetch(
        jsonResponse(brregCompany),
        jsonResponse(addressFixture),
      );
      const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company(
        "923609016",
      );
      expect(response.data.location).toMatchObject({
        matchConfidence: "exact",
        address: { latitude: 59.4111516, longitude: 5.2711408 },
      });
      expect(response.data.components).toEqual([
        {
          operation: "companies.get",
          section: "company",
          status: "available",
          source: expectedSource(providers.brreg),
          retrievedAt: RETRIEVED_AT,
          cached: false,
        },
        {
          operation: "addresses.search",
          section: "address",
          status: "available",
          source: expectedSource(providers.kartverket),
          retrievedAt: RETRIEVED_AT,
          cached: false,
        },
      ]);
      expect(response.source.documentation).toBe(
        "https://github.com/iamkm1/Norway-Open-Data#cross-provider-company-profile",
      );
      expect(response.source.id).toBe("brreg+kartverket");
      expect(mock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call Kartverket without a usable business address", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(RETRIEVED_AT));
    try {
      const payload = { ...brregCompany };
      delete (payload as Partial<typeof brregCompany>).forretningsadresse;
      const { fetch, mock } = sequenceFetch(jsonResponse(payload));
      const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company(
        "923609016",
      );
      expect(response.data.location).toBeUndefined();
      expect(response.data.components).toEqual([
        {
          operation: "companies.get",
          section: "company",
          status: "available",
          source: expectedSource(providers.brreg),
          retrievedAt: RETRIEVED_AT,
          cached: false,
        },
        {
          operation: "addresses.search",
          section: "address",
          status: "omitted",
          source: expectedSource(providers.kartverket),
          reason: "not-applicable",
        },
      ]);
      expect(response.source.id).toBe("brreg");
      expect(mock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    {
      label: "foreign address",
      address: {
        adresse: ["10 Downing Street"],
        postnummer: "SW1A 2AA",
        poststed: "LONDON",
        landkode: "GB",
        land: "United Kingdom",
      },
    },
    {
      label: "foreign numeric postal code",
      address: {
        adresse: ["Example Street 1"],
        postnummer: "1000",
        poststed: "BRUSSELS",
        landkode: "BE",
        land: "Belgium",
      },
    },
    {
      label: "foreign address without a country code",
      address: {
        adresse: ["Example Street 1"],
        postnummer: "1000",
        poststed: "STOCKHOLM",
        land: "Sweden",
      },
    },
    {
      label: "PO box",
      address: {
        adresse: ["Postboks 123"],
        postnummer: "5501",
        poststed: "HAUGESUND",
        kommunenummer: "1106",
      },
    },
  ])("does not geocode a $label", async ({ address }) => {
    const payload = { ...brregCompany, forretningsadresse: address };
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company("923609016");
    expect(response.data.location).toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("supports a missing postal code without claiming exact confidence", async () => {
    const businessAddress = { ...brregCompany.forretningsadresse };
    delete (businessAddress as Partial<typeof businessAddress>).postnummer;
    const payload = { ...brregCompany, forretningsadresse: businessAddress };
    const { fetch } = sequenceFetch(jsonResponse(payload), jsonResponse(addressFixture));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company("923609016");
    expect(response.data.location?.matchConfidence).toBe("high");
  });

  it("propagates provider failure and cancellation", async () => {
    const failed = sequenceFetch(jsonResponse(brregCompany), jsonResponse({}, 503));
    await expect(
      new NorwayOpenData({ fetch: failed.fetch, retries: 0 }).profiles.company("923609016"),
    ).rejects.toMatchObject({ provider: "kartverket" });

    const controller = new AbortController();
    const fetch = vi
      .fn()
      .mockImplementationOnce(async () => jsonResponse(brregCompany))
      .mockImplementationOnce(
        async (_input: RequestInfo | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          }),
      );
    const request = new NorwayOpenData({
      fetch: fetch as typeof globalThis.fetch,
      retries: 0,
    }).profiles.company("923609016", { signal: controller.signal });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    controller.abort();
    await expect(request).rejects.toMatchObject({
      provider: "kartverket",
      message: expect.stringMatching(/cancelled/),
    });
  });

  it("composes cache, bypass, and raw behavior across both providers", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(brregCompany),
      jsonResponse(addressFixture),
      jsonResponse(brregCompany),
      jsonResponse(addressFixture),
    );
    const profiles = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).profiles;
    const first = await profiles.company("923609016", { includeRaw: true });
    const cached = await profiles.company("923609016");
    const bypassed = await profiles.company("923609016", {
      bypassCache: true,
      includeRaw: true,
    });
    expect(first.cached).toBe(false);
    expect(first.raw).toMatchObject({ company: brregCompany, addressSearch: addressFixture });
    expect(cached.cached).toBe(true);
    expect(cached.raw).toBeUndefined();
    expect(bypassed.cached).toBe(false);
    expect(mock).toHaveBeenCalledTimes(4);
  });
});
