import { z } from "zod";

import {
  geoJsonCrsDeclarationSchema,
  geoJsonFeatureIdSchema,
  geoJsonMultiPolygonSchema,
  geoJsonPolygonSchema,
} from "../../core/geojson.js";

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const nullableInteger = z.number().int().nullable().optional();
const nullableBooleanCode = z
  .union([z.literal(0), z.literal(1)])
  .nullable()
  .optional();
const nullableEpochMilliseconds = z
  .number()
  .int()
  .refine(Number.isSafeInteger)
  .nullable()
  .optional();
const areaGeometrySchema = z.union([geoJsonPolygonSchema, geoJsonMultiPolygonSchema]).nullable();

function arcGisFeatureSchema<Properties extends z.ZodType>(
  properties: Properties,
): z.ZodObject<{
  type: z.ZodLiteral<"Feature">;
  id: typeof geoJsonFeatureIdSchema;
  geometry: typeof areaGeometrySchema;
  properties: Properties;
}> {
  return z
    .object({
      type: z.literal("Feature"),
      id: geoJsonFeatureIdSchema,
      geometry: areaGeometrySchema,
      properties,
    })
    .strict();
}

function arcGisCollectionSchema<Feature extends z.ZodType>(
  feature: Feature,
): z.ZodObject<{
  type: z.ZodLiteral<"FeatureCollection">;
  features: z.ZodArray<Feature>;
  crs: z.ZodOptional<z.ZodNullable<typeof geoJsonCrsDeclarationSchema>>;
  exceededTransferLimit: z.ZodOptional<z.ZodBoolean>;
}> {
  return z
    .object({
      type: z.literal("FeatureCollection"),
      features: z.array(feature),
      crs: geoJsonCrsDeclarationSchema.nullable().optional(),
      exceededTransferLimit: z.boolean().optional(),
    })
    .strict();
}

const protectedAreaPropertiesSchema = z
  .object({
    OBJECTID: z.number().int(),
    naturvernId: z.string().trim().min(1),
    cddaId: nullableString,
    navn: nullableString,
    offisieltNavn: nullableString,
    faktaark: nullableString,
    verneform: nullableString,
    verneformAggregert: nullableString,
    verneforskrift: nullableString,
    vernedato: nullableEpochMilliseconds,
    foerstegangVernet: nullableEpochMilliseconds,
    verneplan: nullableString,
    kommune: nullableString,
    forvaltningsmyndighet: nullableString,
    forvaltningsmyndighetType: nullableString,
    iucn: nullableString,
    revisjon: nullableString,
    truetVurdering: nullableString,
    majorEcosystemType: nullableString,
  })
  .strict();

const proposedProtectedAreaPropertiesSchema = z
  .object({
    OBJECTID: z.number().int(),
    foreslattVernId: z.string().trim().min(1),
    navn: nullableString,
    verneform: nullableString,
    verneplan: nullableString,
    kommune: nullableString,
    faktaark: nullableString,
    objekttype: nullableString,
    datafangstdato: nullableEpochMilliseconds,
    maalemetode: nullableString,
    noeyaktighet: nullableNumber,
  })
  .strict();

const natureTypePropertiesSchema = z
  .object({
    OBJECTID: z.number().int(),
    NiNID: z.string().trim().min(1),
    Områdenavn: nullableString,
    Kommuner: nullableString,
    Naturtype: nullableString,
    Naturtypekode: nullableString,
    Lokalitetskvalitet: nullableInteger,
    Tilstand: nullableInteger,
    Tilstandbeskrivelse: nullableString,
    Naturmangfold: nullableInteger,
    Naturmangfoldbeskrivelse: nullableString,
    Hovedøkosystem: nullableString,
    Mosaikk: nullableBooleanCode,
    Nøyaktighet: nullableInteger,
    Usikkerhet: nullableInteger,
    Usikkerhetsbeskrivelse: nullableString,
    Kartleggingsdato: nullableEpochMilliseconds,
    Kartleggingsår: nullableInteger,
    Oppdragsgiver: nullableString,
    Kartlegger: nullableString,
    Oppdragstaker: nullableString,
    Kartleggingsinstruks: nullableString,
    Prosjektnavn: nullableString,
    NiNKartleggingsenheter: nullableString,
    NiNBeskrivelsesvariabler: nullableString,
    Faktaark: nullableString,
    UK_Truet: nullableBooleanCode,
    UK_NærTruet: nullableBooleanCode,
    UK_SpesieltDårligKartlagt: nullableBooleanCode,
    UK_SentralØkosystemFunksjon: nullableBooleanCode,
    UK_SeBekrivelseNaturtype: nullableBooleanCode,
    UK_IngenStatus: nullableBooleanCode,
  })
  .strict();

export const protectedAreaResponseSchema = arcGisCollectionSchema(
  arcGisFeatureSchema(protectedAreaPropertiesSchema),
);
export const proposedProtectedAreaResponseSchema = arcGisCollectionSchema(
  arcGisFeatureSchema(proposedProtectedAreaPropertiesSchema),
);
export const natureTypeResponseSchema = arcGisCollectionSchema(
  arcGisFeatureSchema(natureTypePropertiesSchema),
);

const interventionFreeAreaPropertiesSchema = z
  .object({
    inonid: z.number().int().nonnegative(),
    vsone: z.enum(["1", "2", "v"]),
    arealkm2: z.number().nonnegative().nullable().optional(),
  })
  .strict();

const interventionFreeAreaFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    id: z.string().trim().min(1),
    geometry: areaGeometrySchema,
    geometry_name: z.literal("geom").optional(),
    properties: interventionFreeAreaPropertiesSchema,
  })
  .strict();

const matchedCountSchema = z.union([z.number().int().nonnegative(), z.literal("unknown")]);

export const interventionFreeAreaResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(interventionFreeAreaFeatureSchema),
    crs: geoJsonCrsDeclarationSchema.nullable().optional(),
    numberMatched: matchedCountSchema.optional(),
    totalFeatures: matchedCountSchema.optional(),
    numberReturned: z.number().int().nonnegative().optional(),
    timeStamp: z.string().optional(),
  })
  .superRefine((response, context) => {
    if (
      response.numberReturned !== undefined &&
      response.numberReturned !== response.features.length
    ) {
      context.addIssue({
        code: "custom",
        message: "numberReturned does not match the GeoJSON feature count.",
        path: ["numberReturned"],
      });
    }
  })
  .strict();

export type RawProtectedAreaResponse = z.infer<typeof protectedAreaResponseSchema>;
export type RawProposedProtectedAreaResponse = z.infer<typeof proposedProtectedAreaResponseSchema>;
export type RawNatureTypeResponse = z.infer<typeof natureTypeResponseSchema>;
export type RawInterventionFreeAreaResponse = z.infer<typeof interventionFreeAreaResponseSchema>;
