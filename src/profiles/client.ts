import { createResponse } from "../core/client.js";
import type { OpenDataResponse, RequestOptions } from "../core/types.js";
import type { BrregClient } from "../providers/brreg/client.js";
import type { KartverketAddressClient } from "../providers/kartverket/address-client.js";
import { selectAddressMatch } from "./company-profile.js";
import type { CompanyProfile } from "./types.js";

const profileSource = {
  id: "brreg+kartverket",
  name: "Brønnøysundregistrene and Kartverket",
  homepage: "https://www.npmjs.com/package/norway-open-data-sdk",
  documentation: "https://www.npmjs.com/package/norway-open-data-sdk#company-profiles",
};

function hasUsableAddress(address: CompanyProfile["company"]["businessAddress"]): boolean {
  const addressText = address?.addressText?.trim();
  const countryCode = address?.countryCode?.trim().toUpperCase();
  const countryName = address?.countryName?.trim().toUpperCase();
  return (
    address !== undefined &&
    addressText !== undefined &&
    addressText.length > 0 &&
    !/^(?:P\.?\s*O\.?\s*BOX|POSTBOKS|PB\.?)(?:\s|$)/iu.test(addressText) &&
    (countryCode === undefined || countryCode === "NO" || countryCode === "NOR") &&
    (countryName === undefined || ["NORGE", "NOREG", "NORWAY"].includes(countryName)) &&
    ((address.municipalityCode !== undefined && /^\d{4}$/.test(address.municipalityCode)) ||
      (address.postalCode !== undefined && /^\d{4}$/.test(address.postalCode)))
  );
}

/** Cross-provider client for deterministic, transparent company enrichment. */
export class ProfileClient {
  readonly #companies: BrregClient;
  readonly #addresses: KartverketAddressClient;

  /** @internal */
  constructor(companies: BrregClient, addresses: KartverketAddressClient) {
    this.#companies = companies;
    this.#addresses = addresses;
  }

  /** Enriches a company with the best official Kartverket address coordinate match. */
  async company(
    organizationNumber: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<CompanyProfile>> {
    const companyResponse = await this.#companies.get(organizationNumber, {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      includeRaw: options?.includeRaw === true,
    });
    const company = companyResponse.data;
    const businessAddress = company.businessAddress;
    if (!hasUsableAddress(businessAddress) || businessAddress === undefined) {
      return createResponse(
        { company },
        profileSource,
        { company: companyResponse.raw },
        companyResponse.cached,
        options,
      );
    }
    const addressResponse = await this.#addresses.search(
      {
        query: businessAddress.addressText ?? "",
        ...(businessAddress.municipalityCode === undefined
          ? {}
          : { municipalityCode: businessAddress.municipalityCode }),
        ...(businessAddress.postalCode === undefined
          ? {}
          : { postalCode: businessAddress.postalCode }),
        limit: 10,
      },
      {
        ...(options?.signal === undefined ? {} : { signal: options.signal }),
        ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
        includeRaw: options?.includeRaw === true,
      },
    );
    const match = selectAddressMatch(businessAddress, addressResponse.data.items);
    return createResponse(
      {
        company,
        ...(match === undefined ? {} : { location: match }),
      },
      profileSource,
      { company: companyResponse.raw, addressSearch: addressResponse.raw },
      companyResponse.cached && addressResponse.cached,
      options,
    );
  }
}
