import { describe, expect, it, vi } from "vitest";

import {
  aquacultureSiteFixture,
  aquacultureSitesFixture,
  fishingVesselsFixture,
} from "../fixtures/fiskeridir.js";
import {
  InputValidationError,
  NorwayOpenData,
  NotFoundError,
  normalizeRegistrationMark,
  ResponseValidationError,
} from "../../src/index.js";
import { collect, jsonResponse } from "./helpers.js";

function fisheriesSdk(handler: (url: URL) => Response): {
  sdk: NorwayOpenData;
  urls: URL[];
  headers: Headers[];
} {
  const urls: URL[] = [];
  const headers: Headers[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    urls.push(url);
    headers.push(new Headers(init?.headers));
    return handler(url);
  }) as typeof globalThis.fetch;
  return {
    sdk: new NorwayOpenData({ fetch, retries: 0, rateLimit: { enabled: false } }),
    urls,
    headers,
  };
}

describe("FisheriesClient vessel register", () => {
  it("needs no credentials and sends no authorization header", async () => {
    const { sdk, headers } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    await sdk.fisheries.searchVessels({ municipalityCode: "1106" });
    expect(headers[0]?.get("Authorization")).toBeNull();
    expect(headers[0]?.get("X-API-Key")).toBeNull();
  });

  it("maps filters onto the register's snake_case query parameters", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    await sdk.fisheries.searchVessels({
      municipalityCode: "1106",
      name: "CONVOY",
      query: "kopervik",
      radioCallSign: "lf7250",
      minLength: 6,
      maxLength: 15,
      page: 2,
      pageSize: 50,
      sortBy: "registrationMark",
      sortAscending: true,
    });
    const parameters = urls[0]?.searchParams;
    expect(Object.fromEntries(parameters ?? [])).toEqual({
      municipality_code: "1106",
      name: "CONVOY",
      query: "kopervik",
      // A call sign is upper-cased, because the register matches it exactly.
      radio_call_sign: "LF7250",
      length_gte: "6",
      length_lte: "15",
      page: "2",
      per_page: "50",
      sort_by: "REGISTRATIONMARK",
      sort_asc: "true",
    });
  });

  it("normalizes a hyphenated or compact registration mark to a form the register accepts", () => {
    // Verified against the live register: the spaced and hyphenated forms match,
    // the compact one does not.
    expect(normalizeRegistrationMark("R 0062H")).toBe("R 0062H");
    expect(normalizeRegistrationMark("r-62-h")).toBe("R-62-H");
    expect(normalizeRegistrationMark("R0062H")).toBe("R-0062-H");
    expect(normalizeRegistrationMark(" R-123-H ")).toBe("R-123-H");
    // Anything that is not a recognizable mark is passed through untouched rather
    // than mangled into something the register would silently not match.
    expect(normalizeRegistrationMark("unknown-format!")).toBe("UNKNOWN-FORMAT!");
  });

  it("sends the normalized registration mark", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    await sdk.fisheries.searchVessels({ registrationMark: "R0062H" });
    expect(urls[0]?.searchParams.get("registration_mark")).toBe("R-0062-H");
  });

  it("normalizes a vessel and reports page position", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    const response = await sdk.fisheries.searchVessels({ municipalityCode: "1106", pageSize: 2 });
    expect(response.data.items[0]).toMatchObject({
      id: "2021118477",
      name: "CONVOY JR",
      registrationMark: "R 0062H",
      radioCallSign: "LF7250",
      municipalityCode: "1106",
      tonnageType: "OC",
      tonnage: 12.4,
      length: 8.65,
      width: 3.2,
      enginePower: 370,
      buildYear: 2015,
      registrationDate: "2021-07-14",
    });
    expect(response.data.pagination).toEqual({ page: 1, pageSize: 2, hasMore: true });
    expect(response.source.id).toBe("fiskeridir-vessels");
  });

  it("reports no further pages when a page comes back short", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    const response = await sdk.fisheries.searchVessels({ pageSize: 30 });
    expect(response.data.pagination.hasMore).toBe(false);
  });

  it("publishes company owners in full", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse([fishingVesselsFixture[0]]));
    const response = await sdk.fisheries.searchVessels({});
    expect(response.data.items[0]?.owners).toEqual([
      {
        entityType: "company",
        organizationNumber: "918581669",
        name: "TESTREDERI AS",
        postalCode: "4250",
        city: "KOPERVIK",
      },
    ]);
  });

  it("keeps a natural person's details out of the response and the raw payload", async () => {
    const personVessel = fishingVesselsFixture[1];
    const owner = personVessel?.owners?.[0];
    const { sdk } = fisheriesSdk(() => jsonResponse([personVessel]));
    const response = await sdk.fisheries.searchVessels({}, { includeRaw: true });

    // The entry itself is kept, so the owner count and structure stay visible.
    expect(response.data.items[0]?.owners).toEqual([{ entityType: "person" }]);
    // Nothing identifying survives anywhere in the response, including `raw`.
    const serialized = JSON.stringify(response);
    for (const value of [owner?.name, owner?.postalCode, owner?.city, owner?.id]) {
      expect(serialized).not.toContain(String(value));
    }
  });

  it("withholds owner details for an entity type it does not recognize", async () => {
    const { sdk } = fisheriesSdk(() =>
      jsonResponse([
        {
          ...fishingVesselsFixture[0],
          owners: [
            { id: "918581669", entityType: "SOMETHING_NEW", name: "UNKNOWN KIND", city: "OSLO" },
          ],
        },
      ]),
    );
    const response = await sdk.fisheries.searchVessels({}, { includeRaw: true });
    expect(response.data.items[0]?.owners).toEqual([{ entityType: "person" }]);
    expect(JSON.stringify(response)).not.toContain("UNKNOWN KIND");
  });

  it("resolves a vessel by register id", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture[0]));
    const response = await sdk.fisheries.getVessel({ id: "2021118477" });
    expect(urls[0]?.pathname).toBe("/vessel-api/api/v1/vessels/2021118477");
    expect(response.data.name).toBe("CONVOY JR");
  });

  it("resolves a vessel by registration mark and by call sign", async () => {
    const byMark = fisheriesSdk(() => jsonResponse([fishingVesselsFixture[0]]));
    await expect(
      byMark.sdk.fisheries.getVessel({ registrationMark: "R-62-H" }),
    ).resolves.toMatchObject({ data: { id: "2021118477" } });

    const byCallSign = fisheriesSdk(() => jsonResponse([fishingVesselsFixture[0]]));
    await expect(
      byCallSign.sdk.fisheries.getVessel({ radioCallSign: "LF7250" }),
    ).resolves.toMatchObject({ data: { radioCallSign: "LF7250" } });
  });

  it("raises not-found rather than guessing when a mark matches nothing", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse([]));
    await expect(sdk.fisheries.getVessel({ registrationMark: "R-1-H" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(sdk.fisheries.getVessel({ registrationMark: "R-1-H" })).rejects.toThrow(
      /registration mark "R-1-H"/,
    );
  });

  it("refuses to pick one when a mark matches several vessels", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    // Silently returning the first would invent certainty the register does not
    // support.
    await expect(sdk.fisheries.getVessel({ radioCallSign: "LF7250" })).rejects.toThrow(
      /More than one/,
    );
  });

  it.each([
    { municipalityCode: "11" },
    { municipalityCode: "abcd" },
    { pageSize: 0 },
    { pageSize: 201 },
    { page: 0 },
    { minLength: -1 },
    { minLength: 20, maxLength: 10 },
  ])("rejects the invalid vessel search %o before requesting", async (parameters) => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    await expect(sdk.fisheries.searchVessels(parameters)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects an empty vessel id before requesting", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture[0]));
    await expect(sdk.fisheries.getVessel({ id: "  " })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects a malformed vessel payload", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse([{ id: 42 }]));
    await expect(sdk.fisheries.searchVessels({})).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("walks pages with bounds and stops on a short page", async () => {
    let page = 0;
    const { sdk } = fisheriesSdk(() => {
      page += 1;
      return jsonResponse(page < 3 ? fishingVesselsFixture : [fishingVesselsFixture[0]]);
    });
    const vessels = await collect(
      sdk.fisheries.searchVesselsAll({ pageSize: 2 }, { maxPages: 10 }),
    );
    expect(vessels).toHaveLength(5);
    expect(page).toBe(3);
  });

  it("respects maxItems on the vessel iterator", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(fishingVesselsFixture));
    const vessels = await collect(sdk.fisheries.searchVesselsAll({ pageSize: 2 }, { maxItems: 3 }));
    expect(vessels).toHaveLength(3);
    expect(urls.length).toBeLessThanOrEqual(2);
  });
});

describe("FisheriesClient aquaculture register", () => {
  it("maps filters onto the register's kebab-case parameters and offset range", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(aquacultureSitesFixture));
    await sdk.fisheries.searchAquacultureSites({
      municipalityCode: "1149",
      countyCode: "11",
      productionAreaCode: "3",
      organizationNumber: "918581669",
      licenceNumber: "H-KM-0018",
      placementType: "Offshore",
      waterType: "Salt",
      speciesType: "Salmon",
      name: "TUHOLMANE",
      siteNumber: "10029",
      offset: 20,
      limit: 10,
    });
    expect(Object.fromEntries(urls[0]?.searchParams ?? [])).toEqual({
      "municipality-code": "1149",
      "county-code": "11",
      "production-area-code": "3",
      "legal-entity-nr": "918581669",
      "license-nr": "H-KM-0018",
      placement: "Offshore",
      water: "Salt",
      "species-type": "Salmon",
      name: "TUHOLMANE",
      nr: "10029",
      // The register pages by an inclusive offset range, not page numbers.
      range: "20-29",
    });
  });

  it("defaults to the first ten sites", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(aquacultureSitesFixture));
    const response = await sdk.fisheries.searchAquacultureSites();
    expect(urls[0]?.searchParams.get("range")).toBe("0-9");
    expect(response.data.pagination).toEqual({ offset: 0, limit: 10, hasMore: false });
  });

  it("normalizes a site, keeping the capacity unit and the production-area status", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse(aquacultureSitesFixture));
    const response = await sdk.fisheries.searchAquacultureSites({ municipalityCode: "1149" });
    expect(response.data.items[0]).toEqual({
      siteNumber: "10029",
      name: "TUHOLMANE Ø",
      placementType: "Offshore",
      waterType: "Salt",
      latitude: 59.371233,
      longitude: 5.216333,
      capacity: 2340,
      temporaryCapacity: 2340,
      // Without the unit, the capacity number means nothing.
      capacityUnitType: "TN",
      firstClearanceTime: "1998-06-18T22:00:00Z",
      placement: {
        municipalityCode: "1149",
        municipalityName: "KARMØY",
        countyCode: "11",
        countyName: "ROGALAND",
        productionAreaCode: "3",
        productionAreaName: "Karmøy til Sotra",
        productionAreaStatus: "RØD",
      },
      speciesTypes: ["SALMON"],
      isSlaughterhouse: false,
      hasCommercialActivity: true,
      licences: [{ licenceNumber: "H-KM-0018", validFrom: "2025-08-27T00:00:00Z" }],
    });
    expect(response.source.id).toBe("fiskeridir-aqua");
  });

  it("resolves one site by site number", async () => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(aquacultureSiteFixture));
    const response = await sdk.fisheries.getAquacultureSite("10029");
    expect(urls[0]?.pathname).toBe("/pub-aqua/api/v1/sites/10029");
    expect(response.data.siteNumber).toBe("10029");
  });

  it.each(["", "abc", "10 029", "-5"])(
    "rejects the invalid site number %o before requesting",
    async (siteNumber) => {
      const { sdk, urls } = fisheriesSdk(() => jsonResponse(aquacultureSiteFixture));
      await expect(sdk.fisheries.getAquacultureSite(siteNumber)).rejects.toBeInstanceOf(
        InputValidationError,
      );
      expect(urls).toHaveLength(0);
    },
  );

  it.each([
    { countyCode: "1" },
    { municipalityCode: "114" },
    { organizationNumber: "12345" },
    { limit: 0 },
    { limit: 101 },
    { offset: -1 },
    { productionAreaCode: "123" },
  ])("rejects the invalid site search %o before requesting", async (parameters) => {
    const { sdk, urls } = fisheriesSdk(() => jsonResponse(aquacultureSitesFixture));
    await expect(sdk.fisheries.searchAquacultureSites(parameters)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(urls).toHaveLength(0);
  });

  it("rejects a malformed site payload", async () => {
    const { sdk } = fisheriesSdk(() => jsonResponse([{ siteNr: "10029" }]));
    await expect(sdk.fisheries.searchAquacultureSites()).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("walks site pages by advancing the offset range", async () => {
    const ranges: string[] = [];
    let page = 0;
    const { sdk } = fisheriesSdk((url) => {
      ranges.push(url.searchParams.get("range") ?? "");
      page += 1;
      return jsonResponse(page < 3 ? aquacultureSitesFixture : []);
    });
    const sites = await collect(
      sdk.fisheries.searchAquacultureSitesAll({ limit: 1 }, { maxPages: 5 }),
    );
    expect(sites).toHaveLength(2);
    expect(ranges).toEqual(["0-0", "1-1", "2-2"]);
  });

  it("keeps the two registers on separate sources and separate hosts", async () => {
    const { sdk, urls } = fisheriesSdk((url) =>
      jsonResponse(
        url.pathname.includes("pub-aqua") ? aquacultureSitesFixture : fishingVesselsFixture,
      ),
    );
    const vessels = await sdk.fisheries.searchVessels({});
    const sites = await sdk.fisheries.searchAquacultureSites();
    expect(vessels.source.id).not.toBe(sites.source.id);
    expect(urls[0]?.pathname.startsWith("/vessel-api")).toBe(true);
    expect(urls[1]?.pathname.startsWith("/pub-aqua")).toBe(true);
  });
});
