import { createResponse } from "../core/client.js";
import { NotFoundError } from "../core/errors.js";
import { type ProviderDescriptor, responseSource } from "../core/provider.js";
import { providers } from "../providers/registry.js";
import { kartverketProvider } from "../providers/kartverket/provider.js";
import { metProvider } from "../providers/met/provider.js";
import { ssbProvider } from "../providers/ssb/provider.js";
import { vegvesenProvider } from "../providers/vegvesen/provider.js";
import type { OpenDataResponse, RequestOptions } from "../core/types.js";
import type { BrregClient } from "../providers/brreg/client.js";
import type { FhiClient } from "../providers/fhi/client.js";
import type { KartverketAddressClient } from "../providers/kartverket/address-client.js";
import type { MetClient } from "../providers/met/client.js";
import type { NveHazardsClient } from "../providers/nve/hazards-client.js";
import type { SsbClient } from "../providers/ssb/client.js";
import type { VegvesenClient } from "../providers/vegvesen/client.js";
import {
  boundingBoxAround,
  ROAD_BOX_HALF_SIZE_METRES,
  warningMatchesArea,
  type WarningAreaMatch,
} from "./address-profile.js";
import { selectAddressMatch } from "./company-profile.js";
import {
  LIFE_EXPECTANCY_TABLE,
  pickLifeExpectancy,
  POPULATION_TABLE_ID,
  resolveMunicipality,
  summarizePopulation,
} from "./municipality-profile.js";
import type {
  AddressHazardMatch,
  AddressProfile,
  CompanyProfile,
  MunicipalityProfile,
  ProfileComponent,
  ProfileComponentOperation,
  ProfileComponentSection,
  ProfileOmissionReason,
} from "./types.js";

const PROJECT_URL = "https://github.com/iamkm1/Norway-Open-Data";
const FLOOD_WARNING_ATTRIBUTION = "Varsler fra Flomvarslingen i Norge og www.varsom.no";
const AVALANCHE_WARNING_ATTRIBUTION = "Varsler fra Snøskredvarslingen i Norge og www.varsom.no";
const LANDSLIDE_WARNING_ATTRIBUTION = "Varsler fra Jordskredvarslingen i Norge og www.varsom.no";

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

function municipalityProfileSource(
  includeFhi: boolean,
  includeBrreg: boolean,
  includeNve: boolean,
): ProfileSource {
  return profileSource(
    [
      { id: "ssb", name: "Statistics Norway" },
      ...(includeFhi ? [{ id: "fhi", name: "FHI" }] : []),
      ...(includeBrreg ? [{ id: "brreg", name: "Brønnøysundregistrene" }] : []),
      ...(includeNve ? [{ id: "nve", name: "NVE" }] : []),
    ],
    "cross-provider-municipality-profile",
  );
}

function availableComponent<T>(
  operation: ProfileComponentOperation,
  section: ProfileComponentSection,
  response: OpenDataResponse<T>,
  attribution?: string,
): ProfileComponent {
  return {
    operation,
    section,
    status: "available",
    source: attribution === undefined ? response.source : { ...response.source, attribution },
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

function failedComponent(
  operation: ProfileComponentOperation,
  section: ProfileComponentSection,
  source: Parameters<typeof responseSource>[0],
  failure: Error,
): ProfileComponent {
  return {
    operation,
    section,
    status: "omitted",
    source: responseSource(source),
    reason: "provider-error",
    error: { name: failure.name, message: failure.message },
  };
}

type AttemptResult<T> = { response: OpenDataResponse<T> } | { failure: Error };

/**
 * Converts an optional provider failure into a value so one provider outage
 * degrades its section instead of failing the whole profile. Caller
 * cancellation is never degraded: an aborted signal rethrows immediately.
 */
async function attempt<T>(
  promise: Promise<OpenDataResponse<T>>,
  signal: AbortSignal | undefined,
): Promise<AttemptResult<T>> {
  try {
    return { response: await promise };
  } catch (error) {
    if (signal?.aborted === true) throw error;
    return { failure: error instanceof Error ? error : new Error(String(error)) };
  }
}

function succeeded<T>(result: AttemptResult<T> | undefined): OpenDataResponse<T> | undefined {
  return result !== undefined && "response" in result ? result.response : undefined;
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
 * Providers used by cross-provider enrichment, plus the identification the
 * current configuration actually supplies.
 *
 * @internal
 */
export type ProfileDependencies = {
  weather: MetClient;
  hazards: NveHazardsClient;
  roads: VegvesenClient;
  statistics: SsbClient;
  health: FhiClient;
  /**
   * Reports whether the current configuration satisfies a provider's declared
   * identification requirements, so a component can be skipped as
   * `not-configured` rather than failing the whole composition.
   */
  canAuthenticate: (provider: ProviderDescriptor) => boolean;
};

function warningFeedComponent(
  operation: ProfileComponentOperation,
  result: AttemptResult<AddressProfile["hazards"]> | undefined,
  response: OpenDataResponse<AddressProfile["hazards"]> | undefined,
  attribution: string,
): ProfileComponent {
  return response !== undefined
    ? availableComponent(operation, "hazards", response, attribution)
    : failedComponent(
        operation,
        "hazards",
        providers.nve,
        result !== undefined && "failure" in result ? result.failure : new Error("Unknown"),
      );
}

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
  readonly #dependencies?: ProfileDependencies;

  /** @internal */
  constructor(
    companies: BrregClient,
    addresses: KartverketAddressClient,
    dependencies?: ProfileDependencies,
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
        provider: kartverketProvider.id,
      });
    }

    const { latitude, longitude } = address;
    const hasCoordinates = latitude !== undefined && longitude !== undefined;

    const roadBoundingBox =
      hasCoordinates && latitude !== undefined && longitude !== undefined
        ? boundingBoxAround(latitude, longitude)
        : undefined;
    const weatherPromise =
      hasCoordinates && dependencies.canAuthenticate(metProvider)
        ? dependencies.weather.current({ latitude, longitude }, forwarded)
        : undefined;
    const roadsPromise =
      roadBoundingBox !== undefined && dependencies.canAuthenticate(vegvesenProvider)
        ? dependencies.roads.getRoadNetwork(
            { boundingBox: roadBoundingBox, pageSize: 10 },
            forwarded,
          )
        : undefined;

    const signal = forwarded.signal;
    const [floodResult, avalancheResult, landslideResult, weatherResult, roadsResult] =
      await Promise.all([
        attempt(dependencies.hazards.getFloodWarnings({}, forwarded), signal),
        attempt(dependencies.hazards.getAvalancheWarnings({}, forwarded), signal),
        attempt(dependencies.hazards.getLandslideWarnings({}, forwarded), signal),
        weatherPromise === undefined ? undefined : attempt(weatherPromise, signal),
        roadsPromise === undefined ? undefined : attempt(roadsPromise, signal),
      ]);
    const flood = succeeded(floodResult);
    const avalanche = succeeded(avalancheResult);
    const landslide = succeeded(landslideResult);
    const weather = succeeded(weatherResult);
    const roads = succeeded(roadsResult);

    const hazardMatches = [
      ...(flood?.data ?? []),
      ...(avalanche?.data ?? []),
      ...(landslide?.data ?? []),
    ].flatMap((warning) => {
      const match = warningMatchesArea(warning, {
        municipalityCode: address.municipalityCode,
        municipalityName: address.municipalityName,
        countyCode: address.countyCode,
        countyName: address.countyName,
      });
      return match === undefined ? [] : [addressHazardMatch(warning, match, address)];
    });
    const components: ProfileComponent[] = [
      availableComponent("addresses.search", "address", addressResponse),
      warningFeedComponent(
        "hazards.getFloodWarnings",
        floodResult,
        flood,
        FLOOD_WARNING_ATTRIBUTION,
      ),
      warningFeedComponent(
        "hazards.getAvalancheWarnings",
        avalancheResult,
        avalanche,
        AVALANCHE_WARNING_ATTRIBUTION,
      ),
      warningFeedComponent(
        "hazards.getLandslideWarnings",
        landslideResult,
        landslide,
        LANDSLIDE_WARNING_ATTRIBUTION,
      ),
      weatherResult !== undefined && "failure" in weatherResult
        ? failedComponent("weather.current", "weather", providers.met, weatherResult.failure)
        : weather === undefined
          ? omittedComponent(
              "weather.current",
              "weather",
              providers.met,
              hasCoordinates ? "not-configured" : "missing-coordinate",
            )
          : availableComponent("weather.current", "weather", weather),
      roadsResult !== undefined && "failure" in roadsResult
        ? failedComponent("roads.getRoadNetwork", "roads", providers.vegvesen, roadsResult.failure)
        : roads === undefined
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
        ...(flood === undefined ? {} : { floodWarnings: flood.raw }),
        ...(avalanche === undefined ? {} : { avalancheWarnings: avalanche.raw }),
        ...(landslide === undefined ? {} : { landslideWarnings: landslide.raw }),
        ...(weather === undefined ? {} : { weather: weather.raw }),
        ...(roads === undefined ? {} : { roadNetwork: roads.raw }),
      },
      addressResponse.cached &&
        (flood?.cached ?? true) &&
        (avalanche?.cached ?? true) &&
        (landslide?.cached ?? true) &&
        (weather?.cached ?? true) &&
        (roads?.cached ?? true),
      options,
    );
  }

  /**
   * Answers one municipality from several agencies at once.
   *
   * Resolves a four-digit municipality code or exact municipality name against
   * SSB's region register, then adds SDK-aggregated population totals from
   * SSB, FHI life expectancy with suppression flags preserved, the count of
   * registered organizations from Brønnøysundregistrene, and exact NVE warning
   * matches. Every optional section degrades to a `provider-error` component
   * instead of failing the call; a missing warning match is not an all-clear.
   */
  async municipality(
    query: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<MunicipalityProfile>> {
    const dependencies = this.#dependencies;
    if (dependencies === undefined) {
      throw new NotFoundError(
        "Municipality profiles require a fully configured NorwayOpenData client.",
      );
    }
    const forwarded: RequestOptions = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      includeRaw: options?.includeRaw === true,
    };

    const metadataResponse = await dependencies.statistics.getTableMetadata(
      POPULATION_TABLE_ID,
      forwarded,
    );
    const regionDimension = metadataResponse.data.dimensions.find(
      (dimension) => dimension.code === "Region",
    );
    const resolved = resolveMunicipality(regionDimension, query);
    if (resolved === undefined) {
      throw new NotFoundError(`No Norwegian municipality matched "${query}".`, {
        provider: ssbProvider.id,
      });
    }
    const countyCode = resolved.code.slice(0, 2);

    const signal = forwarded.signal;
    const [
      populationResult,
      lifeResult,
      companiesResult,
      floodResult,
      avalancheResult,
      landslideResult,
    ] = await Promise.all([
      attempt(
        dependencies.statistics.query(
          {
            tableId: POPULATION_TABLE_ID,
            selections: {
              Region: [resolved.code],
              Kjonn: ["1", "2"],
              Alder: ["*"],
              ContentsCode: ["Personer1"],
              Tid: ["top(2)"],
            },
          },
          forwarded,
        ),
        signal,
      ),
      attempt(
        dependencies.health.query(
          {
            source: LIFE_EXPECTANCY_TABLE.source,
            tableId: LIFE_EXPECTANCY_TABLE.tableId,
            selections: {
              GEO: [resolved.code],
              AAR: ["*"],
              KJONN: ["0"],
              ALDER: ["0"],
              UTDANN: ["0"],
              MEASURE_TYPE: [LIFE_EXPECTANCY_TABLE.measure],
            },
          },
          forwarded,
        ),
        signal,
      ),
      attempt(
        this.#companies.search({ municipalityCode: resolved.code, size: 1 }, forwarded),
        signal,
      ),
      attempt(dependencies.hazards.getFloodWarnings({}, forwarded), signal),
      attempt(dependencies.hazards.getAvalancheWarnings({}, forwarded), signal),
      attempt(dependencies.hazards.getLandslideWarnings({}, forwarded), signal),
    ]);
    const populationResponse = succeeded(populationResult);
    const lifeResponse = succeeded(lifeResult);
    const companiesResponse = succeeded(companiesResult);
    const flood = succeeded(floodResult);
    const avalanche = succeeded(avalancheResult);
    const landslide = succeeded(landslideResult);

    const population =
      populationResponse === undefined ? undefined : summarizePopulation(populationResponse.data);
    const lifeExpectancy =
      lifeResponse === undefined ? undefined : pickLifeExpectancy(lifeResponse.data);
    const matchArea = {
      municipalityCode: resolved.code,
      municipalityName: resolved.name,
      countyCode,
    };
    const hazardMatches = [
      ...(flood?.data ?? []),
      ...(avalanche?.data ?? []),
      ...(landslide?.data ?? []),
    ].flatMap((warning) => {
      const match = warningMatchesArea(warning, matchArea);
      if (match === undefined) return [];
      const municipality = match.basis.startsWith("municipality");
      const warningAreas = municipality ? warning.municipalities : warning.counties;
      const warningArea = warningAreas?.find((area) =>
        match.basis.endsWith("code")
          ? area.code === match.warningValue
          : area.name === match.warningValue,
      );
      return [
        {
          warning,
          matchBasis: match.basis,
          addressArea: municipality
            ? { code: resolved.code, name: resolved.name }
            : { code: countyCode },
          warningArea: {
            ...(warningArea?.code === undefined ? {} : { code: warningArea.code }),
            ...(warningArea?.name === undefined ? {} : { name: warningArea.name }),
          },
        } satisfies AddressHazardMatch,
      ];
    });

    const sectionComponent = <T>(
      operation: ProfileComponentOperation,
      section: ProfileComponentSection,
      result: AttemptResult<T> | undefined,
      response: OpenDataResponse<T> | undefined,
      provider: Parameters<typeof responseSource>[0],
    ): ProfileComponent =>
      response !== undefined
        ? availableComponent(operation, section, response)
        : failedComponent(
            operation,
            section,
            provider,
            result !== undefined && "failure" in result ? result.failure : new Error("Unknown"),
          );
    const components: ProfileComponent[] = [
      availableComponent("statistics.getTableMetadata", "municipality", metadataResponse),
      sectionComponent(
        "statistics.query",
        "population",
        populationResult,
        populationResponse,
        providers.ssb,
      ),
      sectionComponent("health.query", "health", lifeResult, lifeResponse, providers.fhi),
      sectionComponent(
        "companies.search",
        "companies",
        companiesResult,
        companiesResponse,
        providers.brreg,
      ),
      warningFeedComponent(
        "hazards.getFloodWarnings",
        floodResult,
        flood,
        FLOOD_WARNING_ATTRIBUTION,
      ),
      warningFeedComponent(
        "hazards.getAvalancheWarnings",
        avalancheResult,
        avalanche,
        AVALANCHE_WARNING_ATTRIBUTION,
      ),
      warningFeedComponent(
        "hazards.getLandslideWarnings",
        landslideResult,
        landslide,
        LANDSLIDE_WARNING_ATTRIBUTION,
      ),
    ];

    const profile: MunicipalityProfile = {
      municipality: { code: resolved.code, name: resolved.name, countyCode },
      ...(population === undefined ? {} : { population }),
      ...(lifeExpectancy === undefined ? {} : { lifeExpectancy }),
      ...(companiesResponse === undefined
        ? {}
        : { companies: { registered: companiesResponse.data.pagination.totalItems } }),
      hazards: hazardMatches.map((match) => match.warning),
      hazardMatches,
      components,
    };

    return createResponse(
      profile,
      municipalityProfileSource(
        lifeResponse !== undefined,
        companiesResponse !== undefined,
        flood !== undefined || avalanche !== undefined || landslide !== undefined,
      ),
      {
        regionMetadata: metadataResponse.raw,
        ...(populationResponse === undefined ? {} : { population: populationResponse.raw }),
        ...(lifeResponse === undefined ? {} : { lifeExpectancy: lifeResponse.raw }),
        ...(companiesResponse === undefined ? {} : { companySearch: companiesResponse.raw }),
        ...(flood === undefined ? {} : { floodWarnings: flood.raw }),
        ...(avalanche === undefined ? {} : { avalancheWarnings: avalanche.raw }),
        ...(landslide === undefined ? {} : { landslideWarnings: landslide.raw }),
      },
      metadataResponse.cached &&
        (populationResponse?.cached ?? true) &&
        (lifeResponse?.cached ?? true) &&
        (companiesResponse?.cached ?? true) &&
        (flood?.cached ?? true) &&
        (avalanche?.cached ?? true) &&
        (landslide?.cached ?? true),
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
    const addressResult = await attempt(
      this.#addresses.search(
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
      ),
      options?.signal,
    );
    if ("failure" in addressResult) {
      return createResponse(
        {
          company,
          components: [
            companyComponent,
            failedComponent(
              "addresses.search",
              "address",
              providers.kartverket,
              addressResult.failure,
            ),
          ],
        },
        companyProfileSource(false),
        { company: companyResponse.raw },
        companyResponse.cached,
        options,
      );
    }
    const addressResponse = addressResult.response;
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
