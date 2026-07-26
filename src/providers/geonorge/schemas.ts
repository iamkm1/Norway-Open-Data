import { z } from "zod";

const nullableString = z.string().nullable().optional();
const providerDateTimeSchema = z.iso.datetime({ local: true, offset: true });
const nullableStringArray = z.array(z.string()).nullable().optional();

const geonorgeSearchServiceSchema = z
  .object({
    Uuid: nullableString,
    Title: nullableString,
    DistributionProtocol: nullableString,
    GetCapabilitiesUrl: nullableString,
  })
  .strict();

const geonorgeSearchSeriesSchema = z
  .object({
    Uuid: nullableString,
    Title: nullableString,
    DistributionProtocol: nullableString,
    GetCapabilitiesUrl: nullableString,
    TypeName: nullableString,
    Theme: nullableString,
    Organization: nullableString,
    DistributionUrl: nullableString,
    AccessIsRestricted: z.boolean().nullable().optional(),
    AccessIsOpendata: z.boolean().nullable().optional(),
  })
  .strict();

type GeonorgeFacetResult = {
  Name: string;
  Count: number;
  NameTranslated?: string | null;
  FacetResults?: GeonorgeFacetResult[];
};

const geonorgeFacetResultSchema: z.ZodType<GeonorgeFacetResult> = z.lazy(() =>
  z
    .object({
      Name: z.string(),
      Count: z.number().int().nonnegative(),
      NameTranslated: nullableString,
      FacetResults: z.array(geonorgeFacetResultSchema).optional(),
    })
    .strict(),
);

const geonorgeFacetSchema = z
  .object({
    FacetField: z.string(),
    Name: z.string(),
    FacetResults: z.array(geonorgeFacetResultSchema),
    NameTranslated: nullableString,
  })
  .strict();

export const geonorgeSearchHitSchema = z
  .object({
    Uuid: z.string().trim().min(1),
    Title: z.string().trim().min(1),
    Abstract: nullableString,
    Type: z.string().trim().min(1),
    Theme: nullableString,
    Organization: nullableString,
    DistributionUrl: nullableString,
    DistributionProtocol: nullableString,
    DistributionName: nullableString,
    GetCapabilitiesUrl: nullableString,
    IsOpenData: z.boolean().nullable().optional(),
    AccessIsOpendata: z.boolean().nullable().optional(),
    AccessIsRestricted: z.boolean(),
    AccessIsProtected: z.boolean(),
    Date: providerDateTimeSchema.nullable().optional(),
    SpatialScope: nullableString,
    AccessConstraint: nullableString,
    DataAccess: nullableString,
    DatasetServices: nullableStringArray,
    DatasetServicesWithShowMapLink: z.array(geonorgeSearchServiceSchema).nullable().optional(),
    Distributions: nullableStringArray,
    IsDokData: z.boolean().nullable().optional(),
    LegendDescriptionUrl: nullableString,
    OrganizationLogo: nullableString,
    OrganizationUrl: nullableString,
    Organizations: nullableStringArray,
    OtherConstraintsAccess: nullableString,
    ProductSheetUrl: nullableString,
    ProductSpecificationUrl: nullableString,
    Serie: geonorgeSearchSeriesSchema.nullable().optional(),
    ServiceDatasets: nullableStringArray,
    ServiceDistributionUrlForDataset: nullableString,
    ServiceUuid: nullableString,
    ServiceWfsDistributionUrlForDataset: nullableString,
    ShowDetailsUrl: nullableString,
    ShowMapLink: z.boolean().nullable().optional(),
    ThumbnailUrl: nullableString,
    TypeTranslated: nullableString,
  })
  .strict();

export const geonorgeSearchResponseSchema = z
  .object({
    NumFound: z.number().int().nonnegative(),
    Limit: z.number().int().positive(),
    /** Geonorge uses a one-based item offset, despite calling this an offset. */
    Offset: z.number().int().positive(),
    Results: z.array(geonorgeSearchHitSchema).nullable(),
    Facets: z.array(geonorgeFacetSchema).optional(),
    Type: z.string().optional(),
  })
  .superRefine((response, context) => {
    const returned = response.Results?.length ?? 0;
    const remaining = Math.max(0, response.NumFound - (response.Offset - 1));
    const expected = Math.min(response.Limit, remaining);
    if (returned !== expected) {
      context.addIssue({
        code: "custom",
        message: "Inconsistent Geonorge returned-item count.",
        path: ["Results"],
      });
    }
  })
  .strict();

const geonorgeContactSchema = z
  .object({
    Email: nullableString,
    Name: nullableString,
    Organization: nullableString,
    OrganizationEnglish: nullableString,
    Role: nullableString,
  })
  .strict();

const geonorgeBoundingBoxSchema = z
  .object({
    EastBoundLongitude: z.string().trim().min(1),
    NorthBoundLatitude: z.string().trim().min(1),
    SouthBoundLatitude: z.string().trim().min(1),
    WestBoundLongitude: z.string().trim().min(1),
  })
  .strict();

const geonorgeConstraintsSchema = z
  .object({
    AccessConstraints: nullableString,
    OtherConstraints: nullableString,
    OtherConstraintsLink: nullableString,
    OtherConstraintsLinkText: nullableString,
    SecurityConstraints: nullableString,
    SecurityConstraintsNote: nullableString,
    UseConstraints: nullableString,
    UseLimitations: nullableString,
    OtherConstraintsAccess: nullableString,
  })
  .strict();

const geonorgeKeywordSchema = z
  .object({
    EnglishKeyword: nullableString,
    KeywordLink: nullableString,
    KeywordValue: nullableString,
    Thesaurus: nullableString,
    Type: nullableString,
  })
  .strict();

const geonorgeReferenceSystemSchema = z
  .object({
    CoordinateSystem: nullableString,
    CoordinateSystemUrl: nullableString,
    Namespace: nullableString,
  })
  .strict();

const geonorgeDistributionSchema = z
  .object({
    FormatName: nullableString,
    FormatVersion: nullableString,
    URL: nullableString,
    Protocol: nullableString,
    Name: nullableString,
    Organization: nullableString,
    UnitsOfDistribution: nullableString,
    EnglishUnitsOfDistribution: nullableString,
    ProtocolName: nullableString,
  })
  .refine(
    (distribution) =>
      [distribution.FormatName, distribution.URL, distribution.Protocol, distribution.Name].some(
        (value) => value != null && value.trim().length > 0,
      ),
    "A Geonorge distribution must contain a format, URL, protocol, or name.",
  )
  .strict();

const geonorgeDistributionDetailsSchema = z
  .object({
    Name: nullableString,
    Protocol: nullableString,
    ProtocolName: nullableString,
    URL: nullableString,
  })
  .refine(
    (distribution) =>
      [distribution.Name, distribution.Protocol, distribution.URL].some(
        (value) => value != null && value.trim().length > 0,
      ),
    "Geonorge distribution details must contain a name, protocol, or URL.",
  )
  .strict();

const geonorgeDatasetServiceSchema = z
  .object({
    Uuid: nullableString,
    Title: nullableString,
    DistributionProtocol: nullableString,
    GetCapabilitiesUrl: nullableString,
  })
  .refine(
    (service) =>
      [service.Uuid, service.Title, service.DistributionProtocol, service.GetCapabilitiesUrl].some(
        (value) => value != null && value.trim().length > 0,
      ),
    "A related Geonorge service must contain an identifier, title, protocol, or URL.",
  )
  .strict();

const geonorgeFormatSummarySchema = z
  .object({
    Name: z.string().trim().min(1),
    Version: nullableString,
  })
  .strict();

const geonorgeGroupedFormatSchema = z
  .object({
    FormatName: z.string().trim().min(1),
    FormatVersion: nullableString,
  })
  .strict();

const geonorgeGroupedDistributionSchema = z
  .object({
    EnglishUnitsOfDistribution: nullableString,
    Formats: z.array(geonorgeGroupedFormatSchema),
    Name: nullableString,
    Organization: nullableString,
    Protocol: nullableString,
    ProtocolDescription: nullableString,
    ProtocolName: nullableString,
    URL: z.array(z.string()),
    UnitsOfDistribution: nullableString,
  })
  .strict();

const geonorgeRelatedDistributionSchema = z
  .object({
    AccessIsOpendata: z.boolean().nullable().optional(),
    AccessIsProtected: z.boolean().nullable().optional(),
    AccessIsRestricted: z.boolean().nullable().optional(),
    CanShowDownloadService: z.boolean().nullable().optional(),
    CanShowDownloadUrl: z.boolean().nullable().optional(),
    CanShowMapUrl: z.boolean().nullable().optional(),
    CanShowServiceMapUrl: z.boolean().nullable().optional(),
    DataAccess: nullableString,
    DistributionFormats: z.array(geonorgeFormatSummarySchema).nullable().optional(),
    DistributionName: nullableString,
    DistributionUrl: nullableString,
    GetCapabilitiesUrl: nullableString,
    MapUrl: nullableString,
    Organization: nullableString,
    Organizations: nullableStringArray,
    Protocol: nullableString,
    RemoveDetailsUrl: z.boolean().nullable().optional(),
    ServiceDistributionAccessConstraint: nullableString,
    ServiceUuid: nullableString,
    ShowDetailsUrl: nullableString,
    ThumbnailUrl: nullableString,
    Title: nullableString,
    Type: nullableString,
    TypeName: nullableString,
    TypeTranslated: nullableString,
    Uuid: nullableString,
  })
  .strict();

const relatedDistributions = z.array(geonorgeRelatedDistributionSchema);

const geonorgeDistributionsSchema = z
  .object({
    SelfDistribution: relatedDistributions,
    RelatedDataset: relatedDistributions,
    RelatedSerieDatasets: relatedDistributions,
    RelatedDatasetSerie: relatedDistributions,
    RelatedApplications: relatedDistributions,
    RelatedServices: relatedDistributions,
    RelatedServiceLayer: relatedDistributions,
    RelatedViewServices: relatedDistributions,
    RelatedDownloadServices: relatedDistributions,
    ShowRelatedDataset: z.boolean(),
    ShowRelatedSerieDatasets: z.boolean(),
    ShowRelatedDatasetSerie: z.boolean(),
    ShowRelatedApplications: z.boolean(),
    ShowRelatedServices: z.boolean(),
    ShowRelatedServiceLayer: z.boolean(),
    ShowRelatedViewServices: z.boolean(),
    ShowRelatedDownloadServices: z.boolean(),
    ShowSelfDistributions: z.boolean(),
  })
  .strict();

const geonorgeQualitySpecificationSchema = z
  .object({
    Date: providerDateTimeSchema.nullable().optional(),
    DateType: nullableString,
    Explanation: nullableString,
    QuantitativeResult: nullableString,
    Result: z.boolean().nullable().optional(),
    Title: nullableString,
  })
  .strict();

const geonorgeQuantitativeResultSchema = z
  .object({
    Coverage: nullableString,
    FAIR: nullableString,
  })
  .strict();

const geonorgeContentInformationSchema = z
  .object({
    CloudCoverPercentage: z.number().nullable().optional(),
  })
  .strict();

const geonorgeThumbnailSchema = z
  .object({
    Type: nullableString,
    URL: nullableString,
  })
  .strict();

const geonorgeOperationSchema = z.object({}).strict();

export const geonorgeMetadataSchema = z
  .object({
    Uuid: z.string().trim().min(1),
    Title: z.string().trim().min(1),
    Type: z.string().trim().min(1),
    Abstract: nullableString,
    EnglishAbstract: nullableString,
    EnglishTitle: nullableString,
    NorwegianTitle: nullableString,
    Organization: nullableString,
    OrganizationEnglish: nullableString,
    OrganizationLogoUrl: nullableString,
    TopicCategories: z.array(z.string()).nullable().optional(),
    TopicCategory: nullableString,
    KeywordsTheme: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsNationalTheme: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsAdministrativeUnits: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsConcept: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsHighValueDatasetCategories: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsInspire: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsInspirePriorityDataset: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsNationalInitiative: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsOther: z.array(geonorgeKeywordSchema).nullable().optional(),
    KeywordsPlace: z.array(geonorgeKeywordSchema).nullable().optional(),
    SpatialScope: nullableString,
    SpatialRepresentation: nullableString,
    BoundingBox: geonorgeBoundingBoxSchema.nullable().optional(),
    ReferenceSystem: geonorgeReferenceSystemSchema.nullable().optional(),
    ReferenceSystems: z.array(geonorgeReferenceSystemSchema).nullable().optional(),
    ContactMetadata: geonorgeContactSchema.nullable().optional(),
    ContactOwner: geonorgeContactSchema.nullable().optional(),
    ContactOwners: z.array(geonorgeContactSchema).nullable().optional(),
    ContactPublisher: geonorgeContactSchema.nullable().optional(),
    Constraints: geonorgeConstraintsSchema.nullable().optional(),
    AccessIsOpendata: z.boolean(),
    AccessIsRestricted: z.boolean(),
    AccessIsProtected: z.boolean(),
    DataAccess: nullableString,
    CanShowDownloadService: z.boolean().nullable().optional(),
    CanShowDownloadUrl: z.boolean().nullable().optional(),
    CanShowMapUrl: z.boolean().nullable().optional(),
    CanShowServiceMapUrl: z.boolean().nullable().optional(),
    CanShowWebsiteUrl: z.boolean().nullable().optional(),
    DateCreated: providerDateTimeSchema.nullable().optional(),
    DatePublished: providerDateTimeSchema.nullable().optional(),
    DateUpdated: providerDateTimeSchema.nullable().optional(),
    DateMetadataUpdated: providerDateTimeSchema.nullable().optional(),
    DateMetadataValidFrom: providerDateTimeSchema.nullable().optional(),
    DateMetadataValidTo: providerDateTimeSchema.nullable().optional(),
    MaintenanceFrequency: nullableString,
    Status: nullableString,
    ContentInformation: geonorgeContentInformationSchema.nullable().optional(),
    CoverageGridUrl: nullableString,
    CoverageUrl: nullableString,
    DatasetLanguage: nullableString,
    DistributionFormats: z.array(geonorgeFormatSummarySchema).nullable().optional(),
    DistributionFormatsGrouped: z.array(geonorgeGroupedDistributionSchema).nullable().optional(),
    DistributionProtocol: nullableString,
    DistributionUrl: nullableString,
    Distributions: geonorgeDistributionsSchema.nullable().optional(),
    DistributionsFormats: z.array(geonorgeDistributionSchema).nullable().optional(),
    DistributionDetails: geonorgeDistributionDetailsSchema.nullable().optional(),
    DownloadUrl: nullableString,
    HelpUrl: nullableString,
    HierarchyLevel: nullableString,
    LegendDescriptionUrl: nullableString,
    MapLink: nullableString,
    MapOnlyWms: z.boolean().nullable().optional(),
    MetMetadata: z.boolean().nullable().optional(),
    MetadataEditUrl: nullableString,
    MetadataLanguage: nullableString,
    MetadataStandard: nullableString,
    MetadataStandardVersion: nullableString,
    MetadataXmlUrl: nullableString,
    Operations: z.array(geonorgeOperationSchema).nullable().optional(),
    OrderingInstructions: nullableString,
    OrderingInstructionsLinkText: nullableString,
    ProcessHistory: nullableString,
    ProductPageUrl: nullableString,
    ProductSheetUrl: nullableString,
    ProductSpecificationUrl: nullableString,
    Protocol: nullableString,
    Purpose: nullableString,
    QualitySpecifications: z.array(geonorgeQualitySpecificationSchema).nullable().optional(),
    QuantitativeResult: geonorgeQuantitativeResultSchema.nullable().optional(),
    ResolutionScale: nullableString,
    ResourceReferenceCode: nullableString,
    ResourceReferenceCodespace: nullableString,
    DatasetServicesWithShowMapLink: z.array(geonorgeDatasetServiceSchema).nullable().optional(),
    ServiceDistributionAccessConstraint: nullableString,
    ServiceDistributionNameForDataset: nullableString,
    ServiceUuid: nullableString,
    ServiceDistributionUrlForDataset: nullableString,
    ServiceDistributionProtocolForDataset: nullableString,
    ServiceWfsDistributionUrlForDataset: nullableString,
    ServiceLink: nullableString,
    OperatesOn: z.array(z.string()).nullable().optional(),
    ServiceType: nullableString,
    SpecificUsage: nullableString,
    SupplementalDescription: nullableString,
    SurveyAreaMapUrl: nullableString,
    Thumbnails: z.array(geonorgeThumbnailSchema).nullable().optional(),
    TypeName: nullableString,
    TypeTranslated: nullableString,
    UnitsOfDistribution: nullableString,
  })
  .strict();

export type RawGeonorgeSearchHit = z.infer<typeof geonorgeSearchHitSchema>;
export type RawGeonorgeSearchResponse = z.infer<typeof geonorgeSearchResponseSchema>;
export type RawGeonorgeMetadata = z.infer<typeof geonorgeMetadataSchema>;
export type RawGeonorgeDistribution = z.infer<typeof geonorgeDistributionSchema>;
