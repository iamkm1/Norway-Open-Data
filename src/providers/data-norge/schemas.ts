import { z } from "zod";

export const localizedStringsSchema = z
  .object({
    nb: z.string().nullable().optional(),
    nn: z.string().nullable().optional(),
    no: z.string().nullable().optional(),
    en: z.string().nullable().optional(),
  })
  .loose();

export const catalogPublisherSummarySchema = z
  .object({
    id: z.string().nullable().optional(),
    uri: z.string().nullable().optional(),
    orgPath: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    title: localizedStringsSchema.nullable().optional(),
    prefLabel: localizedStringsSchema.nullable().optional(),
  })
  .loose();

const referenceDataSchema = z
  .object({
    uri: z.string().nullable().optional(),
    code: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    prefLabel: localizedStringsSchema.nullable().optional(),
  })
  .loose();

const resourceLinkSchema = z.union([
  z.string(),
  referenceDataSchema,
  z.array(z.union([z.string(), referenceDataSchema])),
]);

const distributionSchema = z
  .object({
    title: localizedStringsSchema.nullable().optional(),
    accessURL: resourceLinkSchema.nullable().optional(),
    downloadURL: resourceLinkSchema.nullable().optional(),
    fdkFormat: z.array(referenceDataSchema).nullable().optional(),
    format: z.array(referenceDataSchema).nullable().optional(),
    license: z
      .union([referenceDataSchema, z.array(referenceDataSchema)])
      .nullable()
      .optional(),
  })
  .loose();

export const catalogSearchHitSchema = z
  .object({
    id: z.string().min(1),
    uri: z.string().nullable().optional(),
    searchType: z.enum([
      "CONCEPT",
      "DATASET",
      "DATA_SERVICE",
      "INFORMATION_MODEL",
      "SERVICE",
      "EVENT",
    ]),
    title: localizedStringsSchema.nullable().optional(),
    description: localizedStringsSchema.nullable().optional(),
    organization: catalogPublisherSummarySchema.nullable().optional(),
    accessRights: referenceDataSchema.nullable().optional(),
  })
  .loose();

const pageSchema = z
  .object({
    currentPage: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    totalElements: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  })
  .loose();

const aggregationBucketSchema = z
  .object({
    key: z.union([z.string(), z.number(), z.boolean()]),
    count: z.number().int().nonnegative(),
  })
  .loose();

export const catalogSearchResponseSchema = z
  .object({
    hits: z.array(catalogSearchHitSchema),
    aggregations: z.record(z.string(), z.array(aggregationBucketSchema)),
    page: pageSchema,
  })
  .loose();

export const catalogResourceResponseSchema = z
  .object({
    id: z.string().min(1),
    uri: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    title: localizedStringsSchema.nullable().optional(),
    description: localizedStringsSchema.nullable().optional(),
    publisher: catalogPublisherSummarySchema.nullable().optional(),
    accessRights: referenceDataSchema.nullable().optional(),
    license: referenceDataSchema.nullable().optional(),
    landingPage: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    page: z
      .union([z.string(), z.array(z.string())])
      .nullable()
      .optional(),
    distribution: z.array(distributionSchema).nullable().optional(),
  })
  .loose();

export const publisherTurtleSchema = z.string().trim().min(1);

export type RawCatalogSearchHit = z.infer<typeof catalogSearchHitSchema>;
export type RawCatalogSearchResponse = z.infer<typeof catalogSearchResponseSchema>;
export type RawCatalogResource = z.infer<typeof catalogResourceResponseSchema>;
