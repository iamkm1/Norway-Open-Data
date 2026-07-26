import { createResponse } from "../core/client.js";
import { parseCoordinates } from "../core/geo.js";
import {
  ConfigurationError,
  InputValidationError,
  NotFoundError,
  ProviderError,
} from "../core/errors.js";
import {
  missingAuthMessage,
  type OpenDataSource,
  type ProviderDescriptor,
  responseSource,
} from "../core/provider.js";
import { providers } from "../providers/registry.js";
import { barentswatchAisProvider } from "../providers/barentswatch-ais/provider.js";
import { kartverketProvider } from "../providers/kartverket/provider.js";
import { metProvider } from "../providers/met/provider.js";
import { naturbaseProvider } from "../providers/naturbase/provider.js";
import { nibioProvider } from "../providers/nibio/provider.js";
import { ssbProvider } from "../providers/ssb/provider.js";
import { vegvesenProvider } from "../providers/vegvesen/provider.js";
import type { OpenDataResponse, RequestOptions } from "../core/types.js";
import type { AisClient } from "../providers/barentswatch-ais/client.js";
import type { BrregClient } from "../providers/brreg/client.js";
import type { FhiClient } from "../providers/fhi/client.js";
import type { FisheriesClient } from "../providers/fiskeridir/client.js";
import type { KartverketAddressClient } from "../providers/kartverket/address-client.js";
import type { KartverketPlaceClient } from "../providers/kartverket/place-client.js";
import type { MetClient } from "../providers/met/client.js";
import type { NaturbaseClient } from "../providers/naturbase/client.js";
import type { NibioClient } from "../providers/nibio/client.js";
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
  NatureAtLocationParameters,
  NatureAtLocationProfile,
  ProfileComponent,
  ProfileComponentOperation,
  ProfileComponentSection,
  ProfileOmissionReason,
  VesselAisSummary,
  VesselProfile,
  VesselProfileParameters,
} from "./types.js";
import { joinCallSign, latestTrackPoint, trackName } from "./vessel-profile.js";

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

function addressProfileSource(
  includeWeather: boolean,
  includeNve: boolean,
  includeRoads: boolean,
): ProfileSource {
  return profileSource(
    [
      { id: "kartverket", name: "Kartverket" },
      ...(includeWeather ? [{ id: "met", name: "MET Norway" }] : []),
      ...(includeNve ? [{ id: "nve", name: "NVE" }] : []),
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

function vesselProfileSource(
  includeFisheries: boolean,
  includeWeather: boolean,
  includeKartverket: boolean,
): ProfileSource {
  return profileSource(
    [
      { id: "barentswatch-ais", name: "BarentsWatch AIS" },
      ...(includeFisheries ? [{ id: "fiskeridir-vessels", name: "Fiskeridirektoratet" }] : []),
      ...(includeWeather ? [{ id: "met", name: "MET Norway" }] : []),
      ...(includeKartverket ? [{ id: "kartverket", name: "Kartverket" }] : []),
    ],
    "cross-provider-vessel-profile",
  );
}

function natureProfileSource(
  includeNaturbase: boolean,
  includeNibio: boolean,
  includeKartverket: boolean,
): ProfileSource {
  return profileSource(
    [
      ...(includeNaturbase ? [{ id: "naturbase", name: "Miljødirektoratet / Naturbase" }] : []),
      ...(includeNibio ? [{ id: "nibio", name: "NIBIO" }] : []),
      ...(includeKartverket ? [{ id: "kartverket", name: "Kartverket" }] : []),
    ],
    "cross-provider-nature-profile",
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

function uniqueSources(sources: readonly OpenDataSource[]): OpenDataSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    // A single provider can publish several feeds under different legal terms
    // or mandatory attribution text. Provider ID alone is therefore not a
    // sufficient provenance key (for example, Naturbase's INON snapshot and
    // NVE's three Varsom warning feeds).
    const key = JSON.stringify([
      source.id,
      source.name,
      source.homepage,
      source.documentation,
      source.license,
      source.attribution,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function presentResponses(
  ...responses: readonly (OpenDataResponse<unknown> | undefined)[]
): OpenDataResponse<unknown>[] {
  return responses.filter(
    (response): response is OpenDataResponse<unknown> => response !== undefined,
  );
}

/**
 * Builds a profile envelope with a stable synthetic profile identity and the
 * real providers that actually contributed.
 *
 * The top-level synthetic `source` preserves the existing profile contract and
 * makes clear that the result is SDK composition rather than one upstream's
 * response. `sources` is authoritative for provider licences, attribution and
 * provenance. The fallback responses cover successful "no data here"
 * operations, whose components are intentionally marked omitted even though
 * the provider answered normally.
 */
function createProfileResponse<T extends { components?: readonly ProfileComponent[] }>(
  data: T,
  source: ProfileSource,
  raw: unknown,
  cached: boolean,
  options?: RequestOptions,
  successfulEmptyResponses: readonly OpenDataResponse<unknown>[] = [],
): OpenDataResponse<T> {
  const componentSources = (data.components ?? [])
    .filter(
      (component): component is Extract<ProfileComponent, { status: "available" }> =>
        component.status === "available",
    )
    .map((component) => component.source);
  const sources = uniqueSources(
    componentSources.length === 0
      ? successfulEmptyResponses.map((response) => response.source)
      : componentSources,
  );
  if (sources.length === 0) {
    throw new ProviderError("Every provider needed for this profile failed.", {
      provider: "profiles",
    });
  }
  return {
    ...createResponse(data, source, raw, cached, options),
    sources,
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
  ais: AisClient;
  fisheries: FisheriesClient;
  places: KartverketPlaceClient;
  environment: NaturbaseClient;
  land: NibioClient;
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

/** Cross-provider client for deterministic, transparent public-data composition. */
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

    return createProfileResponse(
      profile,
      addressProfileSource(
        weather !== undefined,
        flood !== undefined || avalanche !== undefined || landslide !== undefined,
        roads !== undefined,
      ),
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
    // Validate before any network request: an empty or whitespace-only query can
    // never resolve, so rejecting it here avoids spending an SSB request to
    // discover that.
    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      throw new InputValidationError(
        "Municipality profiles require a non-empty municipality code or name.",
        { provider: ssbProvider.id },
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
    const resolved = resolveMunicipality(regionDimension, trimmedQuery);
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
        // The region was resolved from this metadata, so reuse it rather than
        // spending a second SSB request on the same document.
        dependencies.statistics.queryWithMetadata(
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
          metadataResponse.data,
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

    return createProfileResponse(
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

  /**
   * Answers one vessel from several providers at once.
   *
   * Asks BarentsWatch for the vessel's latest AIS position and identity and for its
   * recorded track, then uses the radio call sign AIS reported to look the vessel up
   * in the Norwegian fishing-vessel register, and adds conditions and the nearest
   * official place name at the position.
   *
   * What absence means here matters, so the profile distinguishes it rather than
   * collapsing everything into "missing":
   *
   * - `ais.status` of `no-recent-data` means BarentsWatch had no position in its
   *   window. It never means the MMSI is unassigned or the vessel does not exist:
   *   the feed excludes fishing vessels under 15 m and leisure vessels under 45 m,
   *   covers only Norwegian waters, and retains 14 days.
   * - A `registration` component omitted as `not-found` means the register was
   *   searched by call sign and holds no such vessel, which is the ordinary case
   *   for any vessel that is not a Norwegian fishing vessel.
   * - Omitted as `not-applicable` means AIS reported no call sign, so there was
   *   nothing to match on. Matching by name instead would produce confident wrong
   *   answers, so it is not attempted.
   * - Omitted as `not-configured` means the provider needs credentials this client
   *   does not have.
   * - Omitted as `provider-error` means the provider was asked and failed.
   *
   * A caller without BarentsWatch AIS credentials gets a
   * {@link ConfigurationError}, because AIS is the only
   * source that can resolve an MMSI at all and there is no profile without it.
   */
  async vessel(
    parameters: VesselProfileParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<VesselProfile>> {
    const dependencies = this.#dependencies;
    if (dependencies === undefined) {
      throw new NotFoundError("Vessel profiles require a fully configured NorwayOpenData client.");
    }
    const mmsi = parameters.mmsi.trim();
    if (!/^\d{1,9}$/.test(mmsi)) {
      throw new InputValidationError(
        `Invalid MMSI "${parameters.mmsi}". An MMSI must be 1-9 digits.`,
        { provider: barentswatchAisProvider.id },
      );
    }
    // Checked before any request. Every other source in this profile is reached
    // through what AIS reports, so without AIS credentials there is no profile to
    // degrade -- the caller gets the provider's own instructions instead of a
    // response whose every section is a failure.
    if (!dependencies.canAuthenticate(barentswatchAisProvider)) {
      throw new ConfigurationError(missingAuthMessage(barentswatchAisProvider), {
        provider: barentswatchAisProvider.id,
      });
    }
    const forwarded: RequestOptions = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      includeRaw: options?.includeRaw === true,
    };
    const signal = forwarded.signal;

    // Requested together: the snapshot carries identity, the track carries movement,
    // and neither can substitute for the other.
    const [snapshotResult, trackResult] = await Promise.all([
      attempt(dependencies.ais.getVesselSnapshot(mmsi, forwarded), signal),
      attempt(dependencies.ais.getTrackLast24Hours(mmsi, forwarded), signal),
    ]);
    const snapshot = succeeded(snapshotResult);
    const track = succeeded(trackResult);

    const trackData = track?.data;
    const latest = trackData === undefined ? undefined : latestTrackPoint(trackData);
    const identity = {
      ...(snapshot?.data?.name === undefined
        ? trackData === undefined || trackName(trackData) === undefined
          ? {}
          : { name: trackName(trackData) }
        : { name: snapshot.data.name }),
      ...(snapshot?.data?.callSign === undefined ? {} : { callSign: snapshot.data.callSign }),
      ...(snapshot?.data?.imoNumber === undefined ? {} : { imoNumber: snapshot.data.imoNumber }),
      ...(snapshot?.data?.shipType === undefined ? {} : { shipType: snapshot.data.shipType }),
    };
    const hasAis = snapshot?.data !== undefined || latest !== undefined;
    const ais: VesselAisSummary = {
      status: hasAis ? "available" : "no-recent-data",
      ...(latest === undefined ? {} : { latestPosition: latest }),
      ...(trackData === undefined ? {} : { track: trackData }),
      ...(Object.keys(identity).length === 0 ? {} : { identity }),
    };

    // The register holds no MMSI, so the call sign AIS reported is the only join
    // key. Absent it, the lookup is skipped rather than guessed at by name.
    const callSign = joinCallSign([snapshot?.data?.callSign]);
    const position =
      snapshot?.data?.latitude !== undefined && snapshot.data.longitude !== undefined
        ? { latitude: snapshot.data.latitude, longitude: snapshot.data.longitude }
        : latest?.latitude !== undefined && latest.longitude !== undefined
          ? { latitude: latest.latitude, longitude: latest.longitude }
          : undefined;

    const registrationPromise =
      callSign === undefined
        ? undefined
        : dependencies.fisheries.searchVessels({ radioCallSign: callSign, pageSize: 2 }, forwarded);
    const weatherPromise =
      position !== undefined && dependencies.canAuthenticate(metProvider)
        ? dependencies.weather.current(position, forwarded)
        : undefined;
    const placePromise =
      position === undefined
        ? undefined
        : dependencies.places.nearby({ ...position, radiusMeters: 20_000, limit: 1 }, forwarded);

    const [registrationResult, weatherResult, placeResult] = await Promise.all([
      registrationPromise === undefined ? undefined : attempt(registrationPromise, signal),
      weatherPromise === undefined ? undefined : attempt(weatherPromise, signal),
      placePromise === undefined ? undefined : attempt(placePromise, signal),
    ]);
    const registration = succeeded(registrationResult);
    const weather = succeeded(weatherResult);
    const place = succeeded(placeResult);
    // Exactly one match is a match. Several vessels sharing a call sign means the
    // register cannot say which one this is, and picking the first would invent
    // certainty the data does not support.
    const registeredVessel =
      registration?.data.items.length === 1 ? registration.data.items[0] : undefined;
    const nearestPlace = place?.data.items[0];

    const components: ProfileComponent[] = [
      snapshotResult !== undefined && "failure" in snapshotResult
        ? failedComponent(
            "ais.getVesselSnapshot",
            "ais",
            providers["barentswatch-ais"],
            snapshotResult.failure,
          )
        : snapshot?.data === undefined
          ? omittedComponent(
              "ais.getVesselSnapshot",
              "ais",
              providers["barentswatch-ais"],
              "not-covered",
            )
          : availableComponent("ais.getVesselSnapshot", "ais", snapshot),
      trackResult !== undefined && "failure" in trackResult
        ? failedComponent(
            "ais.getTrackLast24Hours",
            "ais",
            providers["barentswatch-ais"],
            trackResult.failure,
          )
        : track === undefined || track.data.points.length === 0
          ? omittedComponent(
              "ais.getTrackLast24Hours",
              "ais",
              providers["barentswatch-ais"],
              "not-covered",
            )
          : availableComponent("ais.getTrackLast24Hours", "ais", track),
      registrationResult !== undefined && "failure" in registrationResult
        ? failedComponent(
            "fisheries.searchVessels",
            "registration",
            providers["fiskeridir-vessels"],
            registrationResult.failure,
          )
        : registration === undefined
          ? omittedComponent(
              "fisheries.searchVessels",
              "registration",
              providers["fiskeridir-vessels"],
              "not-applicable",
            )
          : registeredVessel === undefined
            ? omittedComponent(
                "fisheries.searchVessels",
                "registration",
                providers["fiskeridir-vessels"],
                "not-found",
              )
            : availableComponent("fisheries.searchVessels", "registration", registration),
      weatherResult !== undefined && "failure" in weatherResult
        ? failedComponent("weather.current", "weather", providers.met, weatherResult.failure)
        : weather === undefined
          ? omittedComponent(
              "weather.current",
              "weather",
              providers.met,
              position === undefined ? "missing-coordinate" : "not-configured",
            )
          : availableComponent("weather.current", "weather", weather),
      placeResult !== undefined && "failure" in placeResult
        ? failedComponent("places.nearby", "place", providers.kartverket, placeResult.failure)
        : place === undefined
          ? omittedComponent("places.nearby", "place", providers.kartverket, "missing-coordinate")
          : nearestPlace === undefined
            ? omittedComponent("places.nearby", "place", providers.kartverket, "not-found")
            : availableComponent("places.nearby", "place", place),
    ];

    const profile: VesselProfile = {
      mmsi,
      ais,
      ...(registeredVessel === undefined ? {} : { registration: registeredVessel }),
      ...(weather?.data === undefined ? {} : { weather: weather.data }),
      ...(nearestPlace === undefined ? {} : { nearestPlace }),
      components,
    };

    return createProfileResponse(
      profile,
      vesselProfileSource(
        registeredVessel !== undefined,
        weather !== undefined,
        nearestPlace !== undefined,
      ),
      {
        ...(snapshot === undefined ? {} : { vesselSnapshot: snapshot.raw }),
        ...(track === undefined ? {} : { track: track.raw }),
        ...(registration === undefined ? {} : { registrationSearch: registration.raw }),
        ...(weather === undefined ? {} : { weather: weather.raw }),
        ...(place === undefined ? {} : { nearbyPlaces: place.raw }),
      },
      (snapshot?.cached ?? true) &&
        (track?.cached ?? true) &&
        (registration?.cached ?? true) &&
        (weather?.cached ?? true) &&
        (place?.cached ?? true),
      options,
      presentResponses(snapshot, track, registration, weather, place),
    );
  }

  /**
   * Composes bounded nature, land-resource and place-name information at one
   * WGS84 coordinate.
   *
   * The five dataset lookups and Kartverket place lookup run independently.
   * Provider failures are reported in `components` and `warnings`; caller
   * cancellation is always propagated.
   */
  async natureAtLocation(
    parameters: NatureAtLocationParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<NatureAtLocationProfile>> {
    const dependencies = this.#dependencies;
    if (dependencies === undefined) {
      throw new NotFoundError("Nature profiles require a fully configured NorwayOpenData client.");
    }
    const location = parseCoordinates(
      { latitude: parameters.latitude, longitude: parameters.longitude },
      "profiles",
    );
    const limit = parameters.limit ?? 100;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new InputValidationError(
        "Nature profile limit must be a safe integer between 1 and 100.",
        { provider: "profiles" },
      );
    }
    const forwarded: RequestOptions = {
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
      ...(options?.bypassCache === undefined ? {} : { bypassCache: options.bypassCache }),
      includeRaw: options?.includeRaw === true,
    };
    const spatialParameters = { ...location, limit };

    const [
      protectedResult,
      proposedResult,
      natureTypeResult,
      interventionFreeResult,
      landResourceResult,
      placeResult,
    ] = await Promise.all([
      attempt(
        dependencies.environment.getProtectedAreasAt(spatialParameters, forwarded),
        options?.signal,
      ),
      attempt(
        dependencies.environment.getProposedProtectedAreasAt(spatialParameters, forwarded),
        options?.signal,
      ),
      attempt(
        dependencies.environment.getNatureTypesAt(spatialParameters, forwarded),
        options?.signal,
      ),
      attempt(
        dependencies.environment.getInterventionFreeAreasAt(spatialParameters, forwarded),
        options?.signal,
      ),
      attempt(dependencies.land.getLandResourcesAt(spatialParameters, forwarded), options?.signal),
      attempt(
        dependencies.places.nearby({ ...location, radiusMeters: 5_000, limit: 1 }, forwarded),
        options?.signal,
      ),
    ]);

    const protectedAreas = succeeded(protectedResult);
    const proposedProtectedAreas = succeeded(proposedResult);
    const natureTypes = succeeded(natureTypeResult);
    const interventionFreeAreas = succeeded(interventionFreeResult);
    const landResources = succeeded(landResourceResult);
    const nearbyPlaces = succeeded(placeResult);
    const nearestPlace = nearbyPlaces?.data.items[0];
    const municipality =
      nearestPlace !== undefined &&
      (nearestPlace.municipalityCode !== undefined ||
        nearestPlace.municipalityName !== undefined ||
        nearestPlace.countyCode !== undefined ||
        nearestPlace.countyName !== undefined)
        ? {
            ...(nearestPlace.municipalityCode === undefined
              ? {}
              : { code: nearestPlace.municipalityCode }),
            ...(nearestPlace.municipalityName === undefined
              ? {}
              : { name: nearestPlace.municipalityName }),
            ...(nearestPlace.countyCode === undefined
              ? {}
              : { countyCode: nearestPlace.countyCode }),
            ...(nearestPlace.countyName === undefined
              ? {}
              : { countyName: nearestPlace.countyName }),
          }
        : undefined;

    const components: ProfileComponent[] = [
      "failure" in protectedResult
        ? failedComponent(
            "environment.getProtectedAreasAt",
            "protected-areas",
            naturbaseProvider,
            protectedResult.failure,
          )
        : availableComponent(
            "environment.getProtectedAreasAt",
            "protected-areas",
            protectedResult.response,
          ),
      "failure" in proposedResult
        ? failedComponent(
            "environment.getProposedProtectedAreasAt",
            "proposed-protected-areas",
            naturbaseProvider,
            proposedResult.failure,
          )
        : availableComponent(
            "environment.getProposedProtectedAreasAt",
            "proposed-protected-areas",
            proposedResult.response,
          ),
      "failure" in natureTypeResult
        ? failedComponent(
            "environment.getNatureTypesAt",
            "nature-types",
            naturbaseProvider,
            natureTypeResult.failure,
          )
        : availableComponent(
            "environment.getNatureTypesAt",
            "nature-types",
            natureTypeResult.response,
          ),
      "failure" in interventionFreeResult
        ? failedComponent(
            "environment.getInterventionFreeAreasAt",
            "intervention-free-areas",
            naturbaseProvider,
            interventionFreeResult.failure,
          )
        : availableComponent(
            "environment.getInterventionFreeAreasAt",
            "intervention-free-areas",
            interventionFreeResult.response,
          ),
      "failure" in landResourceResult
        ? failedComponent(
            "land.getLandResourcesAt",
            "land-resources",
            nibioProvider,
            landResourceResult.failure,
          )
        : availableComponent(
            "land.getLandResourcesAt",
            "land-resources",
            landResourceResult.response,
          ),
      "failure" in placeResult
        ? failedComponent("places.nearby", "place", kartverketProvider, placeResult.failure)
        : nearestPlace === undefined
          ? omittedComponent("places.nearby", "place", kartverketProvider, "not-found")
          : availableComponent("places.nearby", "place", placeResult.response),
    ];

    const warnings: string[] = [];
    const failures: Array<[string, AttemptResult<unknown>]> = [
      ["Protected-area lookup", protectedResult],
      ["Proposed protected-area lookup", proposedResult],
      ["Nature-type lookup", natureTypeResult],
      ["Intervention-free-area lookup", interventionFreeResult],
      ["Land-resource lookup", landResourceResult],
      ["Nearby-place lookup", placeResult],
    ];
    for (const [label, result] of failures) {
      if ("failure" in result) warnings.push(`${label} failed: ${result.failure.message}`);
    }
    const truncationChecks = [
      ["protected areas", protectedAreas?.data.pagination],
      ["proposed protected areas", proposedProtectedAreas?.data.pagination],
      ["nature types", natureTypes?.data.pagination],
      ["intervention-free areas", interventionFreeAreas?.data.pagination],
      ["land resources", landResources?.data.pagination],
    ] as const;
    for (const [label, pagination] of truncationChecks) {
      if (pagination?.truncated === true) {
        warnings.push(
          `The ${label} result was truncated at ${String(pagination.returned)} ${
            pagination.returned === 1 ? "feature" : "features"
          }.`,
        );
      }
    }

    const profile: NatureAtLocationProfile = {
      location,
      ...(municipality === undefined ? {} : { municipality }),
      ...(nearestPlace === undefined ? {} : { nearestPlace }),
      ...(protectedAreas === undefined ? {} : { protectedAreas: protectedAreas.data.features }),
      ...(proposedProtectedAreas === undefined
        ? {}
        : { proposedProtectedAreas: proposedProtectedAreas.data.features }),
      ...(natureTypes === undefined ? {} : { natureTypes: natureTypes.data.features }),
      ...(interventionFreeAreas === undefined
        ? {}
        : { interventionFreeAreas: interventionFreeAreas.data.features }),
      ...(landResources === undefined ? {} : { landResources: landResources.data.features }),
      pagination: {
        ...(protectedAreas === undefined ? {} : { protectedAreas: protectedAreas.data.pagination }),
        ...(proposedProtectedAreas === undefined
          ? {}
          : { proposedProtectedAreas: proposedProtectedAreas.data.pagination }),
        ...(natureTypes === undefined ? {} : { natureTypes: natureTypes.data.pagination }),
        ...(interventionFreeAreas === undefined
          ? {}
          : { interventionFreeAreas: interventionFreeAreas.data.pagination }),
        ...(landResources === undefined ? {} : { landResources: landResources.data.pagination }),
      },
      warnings,
      components,
    };

    return createProfileResponse(
      profile,
      natureProfileSource(
        protectedAreas !== undefined ||
          proposedProtectedAreas !== undefined ||
          natureTypes !== undefined ||
          interventionFreeAreas !== undefined,
        landResources !== undefined,
        nearestPlace !== undefined,
      ),
      {
        ...(protectedAreas === undefined ? {} : { protectedAreas: protectedAreas.raw }),
        ...(proposedProtectedAreas === undefined
          ? {}
          : { proposedProtectedAreas: proposedProtectedAreas.raw }),
        ...(natureTypes === undefined ? {} : { natureTypes: natureTypes.raw }),
        ...(interventionFreeAreas === undefined
          ? {}
          : { interventionFreeAreas: interventionFreeAreas.raw }),
        ...(landResources === undefined ? {} : { landResources: landResources.raw }),
        ...(nearbyPlaces === undefined ? {} : { nearbyPlaces: nearbyPlaces.raw }),
      },
      (protectedAreas?.cached ?? true) &&
        (proposedProtectedAreas?.cached ?? true) &&
        (natureTypes?.cached ?? true) &&
        (interventionFreeAreas?.cached ?? true) &&
        (landResources?.cached ?? true) &&
        (nearbyPlaces?.cached ?? true),
      options,
      presentResponses(
        protectedAreas,
        proposedProtectedAreas,
        natureTypes,
        interventionFreeAreas,
        landResources,
        nearbyPlaces,
      ),
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
      return createProfileResponse(
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
      return createProfileResponse(
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
    return createProfileResponse(
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
