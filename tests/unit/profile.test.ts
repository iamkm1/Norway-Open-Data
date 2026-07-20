import brregCompany from "../fixtures/brreg-company.json" with { type: "json" };
import addressFixture from "../fixtures/kartverket-address.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { NorwayOpenData } from "../../src/index.js";
import { selectAddressMatch } from "../../src/profiles/company-profile.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("company profiles", () => {
  it("assigns deterministic exact, high, and possible confidence", () => {
    const business = {
      addressText: "Haraldsgata 100",
      postalCode: "5528",
      municipalityCode: "1106",
    };
    expect(selectAddressMatch(business, [business])?.matchConfidence).toBe("exact");
    expect(
      selectAddressMatch(business, [{ addressText: "Haraldsgata 100", municipalityCode: "1106" }])
        ?.matchConfidence,
    ).toBe("high");
    expect(selectAddressMatch(business, [{ addressText: "Haraldsgata 10" }])?.matchConfidence).toBe(
      "possible",
    );
  });

  it("enriches a company with official coordinates", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(brregCompany), jsonResponse(addressFixture));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company("923609016");
    expect(response.data.location).toMatchObject({
      matchConfidence: "exact",
      address: { latitude: 59.4111516, longitude: 5.2711408 },
    });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("does not call Kartverket without a usable business address", async () => {
    const payload = { ...brregCompany };
    delete (payload as Partial<typeof brregCompany>).forretningsadresse;
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).profiles.company("923609016");
    expect(response.data.location).toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
