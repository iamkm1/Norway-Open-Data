import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { InputValidationError, NorwayOpenData, NotFoundError } from "../../src/index.js";
import { normalizeOrganizationNumber } from "../../src/providers/brreg/client.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("BrregClient", () => {
  it("normalizes organization numbers and company responses", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(brregCompany));
    const company = await new NorwayOpenData({ fetch, retries: 0 }).companies.get("923 609 016", {
      includeRaw: true,
    });

    expect(company.data).toMatchObject({
      organizationNumber: "923609016",
      name: "EKSEMPEL TEKNOLOGI AS",
      industry: { code: "62.010" },
      businessAddress: {
        addressText: "Haraldsgata 100",
        municipalityCode: "1106",
      },
      vatRegistered: true,
      numberOfEmployees: 12,
    });
    expect(company.raw).toEqual(brregCompany);
    expect(mock.mock.calls[0]?.[0]).toBe(
      "https://data.brreg.no/enhetsregisteret/api/enheter/923609016",
    );
  });

  it("validates organization numbers", () => {
    expect(normalizeOrganizationNumber(" 923 609 016 ")).toBe("923609016");
    expect(() => normalizeOrganizationNumber("123")).toThrow(InputValidationError);
  });

  it("rejects an invalid organization number before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse(brregCompany));
    await expect(new NorwayOpenData({ fetch }).companies.get("123")).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("constructs searches and exposes pagination", async () => {
    const payload = {
      _embedded: { enheter: [brregCompany] },
      page: { size: 25, totalElements: 1, totalPages: 1, number: 2 },
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).companies.search({
      name: "Eksempel",
      municipalityCode: "1106",
      page: 2,
      size: 25,
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/enhetsregisteret/api/enheter");
    expect(url.searchParams.get("navn")).toBe("Eksempel");
    expect(url.searchParams.get("kommunenummer")).toBe("1106");
    expect(response.data.pagination).toEqual({
      page: 2,
      size: 25,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("uses the public sub-entity endpoint", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(brregCompany));
    await new NorwayOpenData({ fetch, retries: 0 }).companies.getSubEntity("923609016");
    expect(mock.mock.calls[0]?.[0]).toContain("/underenheter/923609016");
  });

  it("converts HTTP 404 without retrying", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse({}, 404));
    await expect(
      new NorwayOpenData({ fetch, retries: 2 }).companies.get("923609016"),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("allows bounded listing but rejects invalid pagination", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        _embedded: { enheter: [] },
        page: { size: 20, totalElements: 0, totalPages: 0, number: 0 },
      }),
    );
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).companies.search({}),
    ).resolves.toBeDefined();
    const sdk = new NorwayOpenData({ fetch: async () => jsonResponse({}) });
    await expect(sdk.companies.search({ page: -1 })).rejects.toBeInstanceOf(InputValidationError);
  });
});
