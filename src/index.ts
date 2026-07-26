export { NorwayOpenData } from "./norway-open-data.js";
export { providerDescriptors, providerIds, providers } from "./providers.js";
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
export type { CacheStore } from "./core/cache.js";
export type {
  OpenDataSource,
  ProviderAccess,
  ProviderAuth,
  ProviderAuthField,
  ProviderAuthValues,
  ProviderCacheTtls,
  ProviderDescriptor,
  ProviderMetadata,
  ProviderRateLimits,
  RateLimitPolicy,
} from "./core/provider.js";
export type { ProviderId } from "./providers/registry.js";
export { boundingBoxToPolygon, boundingBoxSchema, coordinatesSchema } from "./core/geo.js";
export type { BoundingBox, Coordinates, GeoJsonPolygon, GeoJsonRing } from "./core/geo.js";
export {
  boundingBoxToGeoJsonBoundingBox,
  coordinatesToGeoJsonPosition,
  geoJsonBoundingBoxSchema,
  geoJsonCrsDeclarationSchema,
  geoJsonFeatureCollectionSchema,
  geoJsonFeatureIdSchema,
  geoJsonFeatureSchema,
  geoJsonGeometrySchema,
  geoJsonLinearRingSchema,
  geoJsonLineStringSchema,
  geoJsonMultiPointSchema,
  geoJsonMultiPolygonSchema,
  geoJsonPointSchema,
  geoJsonPolygonSchema,
  geoJsonPositionSchema,
  nullableGeoJsonGeometrySchema,
  resolveGeoJsonCrs,
} from "./core/geojson.js";
export type {
  GeoJsonBoundingBox,
  GeoJsonCrsDeclaration,
  GeoJsonCrsMetadata,
  GeoJsonFeature,
  GeoJsonFeatureCollection,
  GeoJsonFeatureId,
  GeoJsonFeatureProperties,
  GeoJsonGeometry,
  GeoJsonLinearRing,
  GeoJsonLineString,
  GeoJsonMultiPoint,
  GeoJsonMultiPolygon,
  GeoJsonPoint,
  GeoJsonPolygonGeometry,
  GeoJsonPosition,
} from "./core/geojson.js";
export {
  collectFeaturePage,
  DEFAULT_FEATURE_PAGE_SIZE,
  iterateFeaturePages,
  MAX_FEATURE_ITEMS,
  MAX_FEATURE_PAGES,
  MAX_FEATURE_PAGE_SIZE,
} from "./core/feature-page.js";
export type {
  BoundedFeaturePage,
  FeaturePageBatch,
  FeaturePageChunk,
  FeaturePageFetcher,
  FeaturePageOptions,
  FeaturePagePagination,
  FeaturePageRequest,
} from "./core/feature-page.js";
export type { PaginateOptions } from "./core/paginate.js";
export { DEFAULT_MAX_RECORD_SIZE } from "./core/ndjson.js";
export type { ProviderOAuth } from "./core/oauth.js";
export type {
  CacheConfig,
  NorwayOpenDataConfig,
  OpenDataResponse,
  ProviderCredential,
  ProviderCredentials,
  RateLimitConfig,
  RequestOptions,
} from "./core/types.js";

export { ProfileClient } from "./profiles/client.js";
export type {
  AddressHazardMatch,
  AddressProfile,
  AddressRoadSearch,
  CompanyProfile,
  MunicipalityLifeExpectancy,
  MunicipalityPopulation,
  MunicipalityProfile,
  NatureAtLocationParameters,
  NatureAtLocationProfile,
  NatureProfileMunicipality,
  NatureProfilePagination,
  ProfileComponent,
  ProfileComponentOperation,
  ProfileComponentSection,
  ProfileOmissionReason,
  VesselAisSummary,
  VesselProfile,
  VesselProfileParameters,
} from "./profiles/types.js";

export { AisClient, draughtMetres } from "./providers/barentswatch-ais/index.js";
export type {
  AisAidToNavigation,
  AisAreaSearchParameters,
  AisCoverageArea,
  AisFilter,
  AisLatestPositionsParameters,
  AisMessage,
  AisMessageBase,
  AisMessageSelection,
  AisMessageStreamParameters,
  AisPosition,
  AisPositionStreamParameters,
  AisSafetyMessage,
  AisStaticData,
  AisTrack,
  AisTrackParameters,
  AisTrackPoint,
  AisUnknownMessage,
  AisVesselMatch,
  AisVesselSearchParameters,
  AisVesselSnapshot,
  AisVesselSnapshotParameters,
  AisWeatherReport,
  Mmsi,
} from "./providers/barentswatch-ais/index.js";

export { MarineClient } from "./providers/barentswatch/index.js";
export type {
  MarineForecastParameters,
  SeaCurrentForecast,
  WaveForecast,
} from "./providers/barentswatch/index.js";

export { FisheriesClient, normalizeRegistrationMark } from "./providers/fiskeridir/index.js";
export type {
  AquacultureSite,
  AquacultureSiteLicence,
  AquacultureSitePagination,
  AquacultureSitePlacement,
  AquacultureSiteSearchParameters,
  AquacultureSiteSearchResult,
  FisheriesVesselLookup,
  FisheriesVesselPagination,
  FisheriesVesselSearchParameters,
  FisheriesVesselSearchResult,
  FisheriesVesselSortField,
  FishingVessel,
  FishingVesselOwner,
} from "./providers/fiskeridir/index.js";

export { BrregClient } from "./providers/brreg/client.js";
export type {
  Company,
  CompanySearchPagination,
  CompanySearchParameters,
  CompanySearchResult,
} from "./providers/brreg/types.js";

export { FhiClient } from "./providers/fhi/client.js";
export type {
  HealthCubeDimension,
  HealthDimension,
  HealthDimensionValue,
  HealthJsonStatDataset,
  HealthStatisticsQuery,
  HealthStatisticsResult,
  HealthStatisticsRow,
  HealthStatisticsSource,
  HealthStatisticsTable,
  HealthTableDimensions,
  HealthTableMetadata,
} from "./providers/fhi/types.js";

export { SsbClient } from "./providers/ssb/client.js";
export { parseJsonStat, parseTableMetadata } from "./providers/ssb/json-stat.js";
export type {
  JsonStatDataset,
  StatisticsDimension,
  StatisticsQuery,
  StatisticsResult,
  StatisticsTableMetadata,
} from "./providers/ssb/types.js";

export { KlassClient, klassClassificationIds } from "./providers/ssb-klass/index.js";
export type {
  KlassAdministrativeCodeKind,
  KlassChangelogEntry,
  KlassClassification,
  KlassClassificationId,
  KlassClassificationList,
  KlassClassificationSearchResult,
  KlassClassificationSearchHit,
  KlassClassificationSummary,
  KlassClassificationType,
  KlassCode,
  KlassCodeChange,
  KlassCodeChanges,
  KlassCodeList,
  KlassCodePageParameters,
  KlassCodeResolution,
  KlassCodeResolutionMatch,
  KlassCodeResolutionStatus,
  KlassContactPerson,
  KlassCorrespondence,
  KlassCorrespondenceItem,
  KlassCorrespondenceTable,
  KlassCorrespondenceTableId,
  KlassCorrespondenceTableList,
  KlassCorrespondenceTableMetadata,
  KlassCorrespondenceTableSummary,
  KlassGetClassificationParameters,
  KlassGetCodeAtDateParameters,
  KlassGetCodeForVersionParameters,
  KlassGetCodeParameters,
  KlassGetCorrespondenceParameters,
  KlassGetCorrespondenceResult,
  KlassGetCorrespondenceTableParameters,
  KlassGetDatedCorrespondenceParameters,
  KlassGetDatedCorrespondenceResult,
  KlassGetFixedCorrespondenceParameters,
  KlassGetFixedCorrespondenceResult,
  KlassGetRangeCorrespondenceParameters,
  KlassGetRangeCorrespondenceResult,
  KlassGetVersionParameters,
  KlassLanguage,
  KlassLevel,
  KlassListClassificationsParameters,
  KlassListClassificationsResult,
  KlassListCodeChangesParameters,
  KlassListCodeChangesResult,
  KlassListCodesAtDateParameters,
  KlassListCodesForVersionParameters,
  KlassListCodesInRangeParameters,
  KlassListCodesParameters,
  KlassListCodesResult,
  KlassListCorrespondenceTablesParameters,
  KlassListCorrespondenceTablesResult,
  KlassListVersionsParameters,
  KlassListVersionsResult,
  KlassPagination,
  KlassResolveAdministrativeCodeParameters,
  KlassSearchClassificationsParameters,
  KlassSearchClassificationsResult,
  KlassSearchCodesParameters,
  KlassSearchCodesResult,
  KlassVariantSummary,
  KlassVersion,
  KlassVersionId,
  KlassVersionList,
  KlassVersionStatus,
  KlassVersionSummary,
} from "./providers/ssb-klass/index.js";

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

export { GeonorgeClient } from "./providers/geonorge/index.js";
export type {
  GeonorgeAccess,
  GeonorgeContact,
  GeonorgeDatasetMetadata,
  GeonorgeDatasetSummary,
  GeonorgeDistribution,
  GeonorgeDistributionFormat,
  GeonorgeDistributionKind,
  GeonorgeLicense,
  GeonorgeMetadata,
  GeonorgeMetadataSummary,
  GeonorgeMetadataType,
  GeonorgeReferenceSystem,
  GeonorgeSearchPagination,
  GeonorgeSearchParameters,
  GeonorgeSearchResult,
  GeonorgeServiceMetadata,
  GeonorgeServiceReference,
  GeonorgeServiceSummary,
  GeonorgeUpdateMetadata,
} from "./providers/geonorge/index.js";

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

export { NaturbaseClient } from "./providers/naturbase/index.js";
export type {
  InterventionFreeAreaFeature,
  InterventionFreeAreaProperties,
  InterventionFreeZone,
  NaturbaseAreaGeometry,
  NaturbaseBoundingBoxQuery,
  NaturbaseFeatureQueryOptions,
  NaturbaseFeatureResult,
  NaturbasePointQuery,
  NaturbaseSourceCrs,
  NatureTypeFeature,
  NatureTypeProperties,
  ProposedProtectedAreaFeature,
  ProposedProtectedAreaProperties,
  ProtectedAreaFeature,
  ProtectedAreaProperties,
} from "./providers/naturbase/index.js";

export { NibioClient } from "./providers/nibio/index.js";
export type {
  Ar50AgricultureCode,
  Ar50ForestProductivityCode,
  Ar50LandTypeCode,
  Ar50TreeTypeCode,
  Ar50VegetationCoverCode,
  LandResourceBoundingBoxQuery,
  LandResourceFeature,
  LandResourceGeometry,
  LandResourcePointQuery,
  LandResourceProperties,
  LandResourceResult,
  NibioFeatureQueryOptions,
  NibioSourceCrs,
} from "./providers/nibio/index.js";

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
