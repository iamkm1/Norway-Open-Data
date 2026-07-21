export { NorwayOpenData } from "./norway-open-data.js";
export { providers } from "./providers.js";
export { version } from "./version.js";

export {
  ConfigurationError,
  InputValidationError,
  NotFoundError,
  OpenDataError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
} from "./core/errors.js";
export type { OpenDataErrorDetails } from "./core/errors.js";
export type { ProviderId, ProviderMetadata } from "./core/metadata.js";
export type { PaginateOptions } from "./core/paginate.js";
export type {
  CacheConfig,
  NorwayOpenDataConfig,
  OpenDataResponse,
  ProviderCredentials,
  RequestOptions,
} from "./core/types.js";

export { ProfileClient } from "./profiles/client.js";
export type { AddressProfile, CompanyProfile } from "./profiles/types.js";

export { BrregClient } from "./providers/brreg/client.js";
export type {
  Company,
  CompanySearchPagination,
  CompanySearchParameters,
  CompanySearchResult,
} from "./providers/brreg/types.js";

export { SsbClient } from "./providers/ssb/client.js";
export { parseJsonStat, parseTableMetadata } from "./providers/ssb/json-stat.js";
export type {
  JsonStatDataset,
  StatisticsDimension,
  StatisticsQuery,
  StatisticsResult,
  StatisticsTableMetadata,
} from "./providers/ssb/types.js";

export { KartverketAddressClient } from "./providers/kartverket/address-client.js";
export { KartverketPlaceClient } from "./providers/kartverket/place-client.js";
export type {
  AddressSearchParameters,
  AddressSearchResult,
  NearbyPlaceParameters,
  NorwegianAddress,
  PlaceName,
  PlaceSearchParameters,
  PlaceSearchResult,
} from "./providers/kartverket/types.js";

export { EnturClient } from "./providers/entur/client.js";
export type {
  AutocompleteParameters,
  AutocompletePlace,
  Departure,
  DepartureParameters,
  Journey,
  JourneyLeg,
  JourneyLocationInput,
  JourneyParameters,
  JourneyPlace,
} from "./providers/entur/types.js";

export { MetClient } from "./providers/met/client.js";
export type {
  ForecastParameters,
  WeatherForecast,
  WeatherTimeseriesEntry,
} from "./providers/met/types.js";

export { DataNorgeClient } from "./providers/data-norge/client.js";
export type {
  CatalogDistribution,
  CatalogPublisher,
  CatalogPublisherSummary,
  CatalogResource,
  CatalogResourceType,
  CatalogSearchPagination,
  CatalogSearchParameters,
  CatalogSearchResult,
} from "./providers/data-norge/types.js";

export { ElectricityClient } from "./providers/hvakosterstrommen/client.js";
export type {
  CurrentElectricityPriceParameters,
  ElectricityPrice,
  ElectricityPriceParameters,
  PriceArea,
} from "./providers/hvakosterstrommen/types.js";

export { NorgesBankClient } from "./providers/norges-bank/client.js";
export type {
  CurrencyRate,
  ExchangeRateParameters,
  InterestRateObservation,
  TimeSeriesParameters,
} from "./providers/norges-bank/types.js";

export { NveEnergyClient } from "./providers/nve/energy-client.js";
export { NveHazardsClient } from "./providers/nve/hazards-client.js";
export type {
  HazardWarning,
  HazardWarningParameters,
  HydrologyObservation,
  HydrologyObservationParameters,
  HydrologyStation,
  HydrologyStationParameters,
  PowerPlant,
  ReservoirStatistic,
} from "./providers/nve/types.js";

export { StortingetClient } from "./providers/stortinget/client.js";
export type {
  ParliamentMeetingsParameters,
  ParliamentPartiesParameters,
  ParliamentQuestionsParameters,
  ParliamentRepresentativesParameters,
  ParliamentaryCase,
  ParliamentaryCaseSearchPagination,
  ParliamentaryCaseSearchParameters,
  ParliamentaryCaseSearchResult,
  ParliamentaryCaseStatus,
  ParliamentaryCaseType,
  ParliamentaryMeeting,
  ParliamentaryParty,
  ParliamentaryPersonReference,
  ParliamentaryQuestion,
  ParliamentaryQuestionCategory,
  ParliamentaryQuestionStatus,
  ParliamentaryVote,
  Representative,
} from "./providers/stortinget/types.js";

export { normalizeRoadObject, VegvesenClient } from "./providers/vegvesen/client.js";
export type {
  RoadCategory,
  RoadGeometry,
  RoadNetworkParameters,
  RoadNetworkResult,
  RoadNetworkSegment,
  RoadObject,
  RoadObjectLocation,
  RoadObjectProperty,
  RoadObjectPropertyType,
  RoadObjectSearchParameters,
  RoadObjectSearchResult,
  RoadObjectType,
  RoadPagination,
} from "./providers/vegvesen/types.js";
