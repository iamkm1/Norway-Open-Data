import { createResponse } from "../core/client.js";
import { NotFoundError } from "../core/errors.js";
import type { OpenDataResponse, RequestOptions } from "../core/types.js";
import type { BrregClient } from "../providers/brreg/client.js";
import type { KartverketAddressClient } from "../providers/kartverket/address-client.js";
import type { MetClient } from "../providers/met/client.js";
import type { NveHazardsClient } from "../providers/nve/hazards-client.js";
import type { VegvesenClient } from "../providers/vegvesen/client.js";
import { boundingBoxAround, warningMatchesArea } from "./address-profile.js";
import { selectAddressMatch } from "./company-profile.js";
import type { AddressProfile, CompanyProfile } from "./types.js";

const profileSource = {
  id: "brreg+kartverket",
  name: "Brønnøysundregistrene and Kartverket",
  homepage: "https://www.npmjs.com/package/norway-open-data-sdk",
  documentation: "https://www.npmjs.com/package/norway-open-data-sdk#company-profiles",
};

const addressProfileSource = {
  id: "kartverket+met+nve+vegvesen",
  name: "Kartverket, MET Norway, NVE and Statens vegvesen",
  homepage: "https://www.npmjs.com/package/norway-open-data-sdk",
  documentation: "https://www.npmjs.com/package/norway-open-data-sdk#address-profiles",
};

/**
 * Providers used by cross-provider address enrichment, plus the identification
 * the current configuration actually supplies.
 *
 * @internal
 */
export type AddressProfileDependencies = {
  weather: MetClient;
  hazards: NveHazardsClient;
  roads: VegvesenClient;
  /** True when both `applicationName` and `contactEmail` are configured. */
  hasMetIdentity: boolean;
  /** True when `applicationName` is configured. */
  hasApplicationName: boolean;
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
  readonly #dependencies?: AddressProfileDependencies;

  /** @internal */
  constructor(
    companies: BrregClient,
    addresses: KartverketAddressClient,
    dependencies?: AddressProfileDependencies,
  ) {
    this.#companies = companies;
    this.#addresses = addresses;
    this.#dependencies = dependencies;
  }

  /**
   * Answers one location from several providers at once.
   *
   * Resolves the address through Kartverket, then adds conditions from MET
   * Norway, matching NVE warnings, and the road segments around the
   * coordinate. Sections whose provider needs identification the client does
   * not have are omitted rather than failing the call.
   */
  async address(
    query: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AddressProfile>> {
    const dependencies = this.#dependencies;
    if (dependencies === undefined) {
      throw new NotFoundError("Address profiles require a fully configured NorwayOpenData client.");
    }
    const forwarded: RequestOptions = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      includeRaw: options?.includeRaw === true,
    };

    const addressResponse = await this.#addresses.search({ query, limit: 1 }, forwarded);
    const address = addressResponse.data.items[0];
    if (address === undefined) {
      throw new NotFoundError(`No official Norwegian address matched "${query}".`, {
        provider: "kartverket",
      });
    }

    const { latitude, longitude } = address;
    const hasCoordinates = latitude !== undefined && longitude !== undefined;

    const weatherPromise =
      hasCoordinates && dependencies.hasMetIdentity
        ? dependencies.weather.current({ latitude, longitude }, forwarded)
        : undefined;
    const roadsPromise =
      hasCoordinates && dependencies.hasApplicationName
        ? dependencies.roads.getRoadNetwork(
            { boundingBox: boundingBoxAround(latitude, longitude), pageSize: 10 },
            forwarded,
          )
        : undefined;

    const [flood, avalanche, landslide, weather, roads] = await Promise.all([
      dependencies.hazards.getFloodWarnings({}, forwarded),
      dependencies.hazards.getAvalancheWarnings({}, forwarded),
      dependencies.hazards.getLandslideWarnings({}, forwarded),
      weatherPromise,
      roadsPromise,
    ]);

    const areas = [address.municipalityName, address.countyName];
    const hazards = [...flood.data, ...avalanche.data, ...landslide.data].filter((warning) =>
      warningMatchesArea(warning, areas),
    );

    const profile: AddressProfile = {
      address,
      hazards,
      ...(weather?.data === undefined ? {} : { weather: weather.data }),
      ...(roads === undefined ? {} : { roads: roads.data.items }),
    };

    return createResponse(
      profile,
      addressProfileSource,
      {
        addressSearch: addressResponse.raw,
        floodWarnings: flood.raw,
        avalancheWarnings: avalanche.raw,
        landslideWarnings: landslide.raw,
        ...(weather === undefined ? {} : { weather: weather.raw }),
        ...(roads === undefined ? {} : { roadNetwork: roads.raw }),
      },
      addressResponse.cached && flood.cached && avalanche.cached && landslide.cached,
      options,
    );
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
