import { createResponse } from "../core/client.js";
import { NotFoundError } from "../core/errors.js";
import { providers, responseSource } from "../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../core/types.js";
import type { BrregClient } from "../providers/brreg/client.js";
import type { KartverketAddressClient } from "../providers/kartverket/address-client.js";
import type { MetClient } from "../providers/met/client.js";
import type { NveHazardsClient } from "../providers/nve/hazards-client.js";
import type { VegvesenClient } from "../providers/vegvesen/client.js";
import {
  boundingBoxAround,
  ROAD_BOX_HALF_SIZE_METRES,
  warningMatchesArea,
  type WarningAreaMatch,
} from "./address-profile.js";
import { selectAddressMatch } from "./company-profile.js";
import type {
  AddressHazardMatch,
  AddressProfile,
  CompanyProfile,
  ProfileComponent,
  ProfileComponentOperation,
  ProfileComponentSection,
  ProfileOmissionReason,
} from "./types.js";

const PROJECT_URL = "https://github.com/iamkm1/Norway-Open-Data";

type ProfileSourcePart = { id: string; name: string };
type ProfileSource = ProfileSourcePart & { homepage: string; documentation: string };

function profileSource(parts: ProfileSourcePart[], documentationAnchor: string): ProfileSource {
  const names = parts.map((part) => part.name);
  const finalName = names.at(-1) ?? "Norwegian public data";
  return {
    id: parts.map((part) => part.id).join("+"),
    name: names.length < 2 ? finalName : `${names.slice(0, -1).join(", ")} and ${finalName}`,
    homepage: PROJECT_URL,
    documentation: `${PROJECT_URL}#${documentationAnchor}`,
  };
}

function companyProfileSource(includeKartverket: boolean): ProfileSource {
  return profileSource(
    [
      { id: "brreg", name: "Brønnøysundregistrene" },
      ...(includeKartverket ? [{ id: "kartverket", name: "Kartverket" }] : []),
    ],
    "cross-provider-company-profile",
  );
}

function addressProfileSource(includeWeather: boolean, includeRoads: boolean): ProfileSource {
  return profileSource(
    [
      { id: "kartverket", name: "Kartverket" },
      ...(includeWeather ? [{ id: "met", name: "MET Norway" }] : []),
      { id: "nve", name: "NVE" },
      ...(includeRoads ? [{ id: "vegvesen", name: "Statens vegvesen" }] : []),
    ],
    "cross-provider-address-profile",
  );
}

function availableComponent<T>(
  operation: ProfileComponentOperation,
  section: ProfileComponentSection,
  response: OpenDataResponse<T>,
): ProfileComponent {
  return {
    operation,
    section,
    status: "available",
    source: response.source,
    retrievedAt: response.retrievedAt,
    cached: response.cached,
  };
}

function omittedComponent(
  operation: ProfileComponentOperation,
  section: ProfileComponentSection,
  source: Parameters<typeof responseSource>[0],
  reason: ProfileOmissionReason,
): ProfileComponent {
  return {
    operation,
    section,
    status: "omitted",
    source: responseSource(source),
    reason,
  };
}

function addressHazardMatch(
  warning: AddressProfile["hazards"][number],
  match: WarningAreaMatch,
  address: AddressProfile["address"],
): AddressHazardMatch {
  const municipality = match.basis.startsWith("municipality");
  const codeMatch = match.basis.endsWith("code");
  const warningAreas = municipality ? warning.municipalities : warning.counties;
  const warningArea = warningAreas?.find((area) =>
    codeMatch ? area.code === match.warningValue : area.name === match.warningValue,
  );
  return {
    warning,
    matchBasis: match.basis,
    addressArea: municipality
      ? {
          ...(address.municipalityCode === undefined ? {} : { code: address.municipalityCode }),
          ...(address.municipalityName === undefined ? {} : { name: address.municipalityName }),
        }
      : {
          ...(address.countyCode === undefined ? {} : { code: address.countyCode }),
          ...(address.countyName === undefined ? {} : { name: address.countyName }),
        },
    warningArea: {
      ...(warningArea?.code === undefined ? {} : { code: warningArea.code }),
      ...(warningArea?.name === undefined
        ? codeMatch
          ? {}
          : { name: match.warningValue }
        : { name: warningArea.name }),
    },
  };
}

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
   * Norway, exact NVE administrative-area matches, and the first page of NVDB
   * segments intersecting a derived bounding box. A missing warning match is
   * not an all-clear. Sections whose provider needs identification the client
   * does not have are omitted rather than failing the call.
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

    const roadBoundingBox =
      hasCoordinates && latitude !== undefined && longitude !== undefined
        ? boundingBoxAround(latitude, longitude)
        : undefined;
    const weatherPromise =
      hasCoordinates && dependencies.hasMetIdentity
        ? dependencies.weather.current({ latitude, longitude }, forwarded)
        : undefined;
    const roadsPromise =
      roadBoundingBox !== undefined && dependencies.hasApplicationName
        ? dependencies.roads.getRoadNetwork(
            { boundingBox: roadBoundingBox, pageSize: 10 },
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

    const hazardMatches = [...flood.data, ...avalanche.data, ...landslide.data].flatMap(
      (warning) => {
        const match = warningMatchesArea(warning, {
          municipalityCode: address.municipalityCode,
          municipalityName: address.municipalityName,
          countyCode: address.countyCode,
          countyName: address.countyName,
        });
        return match === undefined ? [] : [addressHazardMatch(warning, match, address)];
      },
    );
    const components: ProfileComponent[] = [
      availableComponent("addresses.search", "address", addressResponse),
      availableComponent("hazards.getFloodWarnings", "hazards", flood),
      availableComponent("hazards.getAvalancheWarnings", "hazards", avalanche),
      availableComponent("hazards.getLandslideWarnings", "hazards", landslide),
      weather === undefined
        ? omittedComponent(
            "weather.current",
            "weather",
            providers.met,
            hasCoordinates ? "not-configured" : "missing-coordinate",
          )
        : availableComponent("weather.current", "weather", weather),
      roads === undefined
        ? omittedComponent(
            "roads.getRoadNetwork",
            "roads",
            providers.vegvesen,
            hasCoordinates ? "not-configured" : "missing-coordinate",
          )
        : availableComponent("roads.getRoadNetwork", "roads", roads),
    ];

    const profile: AddressProfile = {
      address,
      hazards: hazardMatches.map((match) => match.warning),
      hazardMatches,
      ...(weather?.data === undefined ? {} : { weather: weather.data }),
      ...(roads === undefined ? {} : { roads: roads.data.items }),
      ...(roads === undefined || roadBoundingBox === undefined
        ? {}
        : {
            roadSearch: {
              shape: "bounding-box" as const,
              halfSizeMetres: ROAD_BOX_HALF_SIZE_METRES,
              boundingBox: roadBoundingBox,
              requestedPageSize: 10,
              truncated:
                roads.data.pagination.nextStart !== undefined ||
                roads.data.pagination.nextUrl !== undefined,
            },
          }),
      components,
    };

    return createResponse(
      profile,
      addressProfileSource(weather !== undefined, roads !== undefined),
      {
        addressSearch: addressResponse.raw,
        floodWarnings: flood.raw,
        avalancheWarnings: avalanche.raw,
        landslideWarnings: landslide.raw,
        ...(weather === undefined ? {} : { weather: weather.raw }),
        ...(roads === undefined ? {} : { roadNetwork: roads.raw }),
      },
      addressResponse.cached &&
        flood.cached &&
        avalanche.cached &&
        landslide.cached &&
        (weather?.cached ?? true) &&
        (roads?.cached ?? true),
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
    const companyComponent = availableComponent("companies.get", "company", companyResponse);
    const businessAddress = company.businessAddress;
    if (!hasUsableAddress(businessAddress) || businessAddress === undefined) {
      return createResponse(
        {
          company,
          components: [
            companyComponent,
            omittedComponent("addresses.search", "address", providers.kartverket, "not-applicable"),
          ],
        },
        companyProfileSource(false),
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
        components: [
          companyComponent,
          availableComponent("addresses.search", "address", addressResponse),
        ],
      },
      companyProfileSource(true),
      { company: companyResponse.raw, addressSearch: addressResponse.raw },
      companyResponse.cached && addressResponse.cached,
      options,
    );
  }
}
