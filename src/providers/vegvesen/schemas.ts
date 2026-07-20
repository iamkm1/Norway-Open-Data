import { z } from "zod";

const unitSchema = z
  .object({
    navn: z.string().optional(),
    kortnavn: z.string().optional(),
  })
  .loose();

const categorySchema = z
  .object({
    id: z.number().int().optional(),
    navn: z.string(),
    primærkategori: z.boolean().optional(),
  })
  .loose();

const roadObjectPropertyTypeSchema = z
  .object({
    id: z.number().int().positive(),
    navn: z.string(),
    beskrivelse: z.string().nullable().optional(),
    egenskapstype: z.string().optional(),
    obligatorisk_verdi: z.boolean().optional(),
    sensitivitet: z.number().int().nonnegative().optional(),
    enhet: unitSchema.nullable().optional(),
  })
  .loose();

export const roadObjectTypeSchema = z
  .object({
    id: z.number().int().positive(),
    navn: z.string(),
    kortnavn: z.string().nullable().optional(),
    beskrivelse: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    sensitiv: z.boolean(),
    kategorier: z.array(categorySchema).optional(),
    egenskapstyper: z.array(roadObjectPropertyTypeSchema).optional(),
  })
  .loose();

export const roadObjectTypeListSchema = z.array(roadObjectTypeSchema);

const geometrySchema = z
  .object({
    wkt: z.string().optional(),
    geojson: z.unknown().optional(),
    geoJson: z.unknown().optional(),
    srid: z.number().int().optional(),
  })
  .loose();

const roadReferenceSchema = z
  .object({
    kortform: z.string().optional(),
  })
  .loose();

const roadObjectLocationSchema = z
  .object({
    kommuner: z.array(z.union([z.number().int(), z.string()])).optional(),
    fylker: z.array(z.union([z.number().int(), z.string()])).optional(),
    vegsystemreferanser: z.array(roadReferenceSchema).optional(),
    geometri: geometrySchema.optional(),
  })
  .loose();

const roadObjectPropertySchema = z
  .object({
    id: z.number().int().positive().optional(),
    navn: z.string(),
    verdi: z.unknown().optional(),
    innhold: z.unknown().optional(),
    enhet: unitSchema.nullable().optional(),
  })
  .loose();

export const roadObjectSchema = z
  .object({
    id: z.number().int().positive(),
    metadata: z
      .object({
        type: z
          .object({
            id: z.number().int().positive(),
            navn: z.string().optional(),
          })
          .loose(),
        versjon: z.number().int().positive().optional(),
      })
      .loose(),
    egenskaper: z.array(roadObjectPropertySchema),
    geometri: geometrySchema.optional(),
    lokasjon: roadObjectLocationSchema.optional(),
  })
  .loose();

const nextPageSchema = z
  .object({
    start: z.string(),
    href: z.url(),
  })
  .loose();

const pageMetadataSchema = z
  .object({
    antall: z.number().int().nonnegative().optional(),
    returnert: z.number().int().nonnegative(),
    sidestørrelse: z.number().int().nonnegative(),
    neste: nextPageSchema.nullable().optional(),
  })
  .loose();

export const roadObjectSearchResponseSchema = z
  .object({
    objekter: z.array(roadObjectSchema),
    metadata: pageMetadataSchema,
  })
  .loose();

const networkRoadReferenceSchema = z
  .object({
    kortform: z.string().optional(),
  })
  .loose();

export const roadNetworkSegmentSchema = z
  .object({
    veglenkesekvensid: z.number().int().positive(),
    veglenkenummer: z.number().int().nonnegative().optional(),
    segmentnummer: z.number().int().nonnegative().optional(),
    startposisjon: z.number().min(0).max(1).optional(),
    sluttposisjon: z.number().min(0).max(1).optional(),
    lengde: z.number().nonnegative().optional(),
    typeVeg: z.string().optional(),
    detaljnivå: z.string().optional(),
    kommune: z.union([z.number().int(), z.string()]).optional(),
    fylke: z.union([z.number().int(), z.string()]).optional(),
    vegsystemreferanse: networkRoadReferenceSchema.nullable().optional(),
    geometri: geometrySchema.optional(),
  })
  .loose();

export const roadNetworkResponseSchema = z
  .object({
    objekter: z.array(roadNetworkSegmentSchema),
    metadata: pageMetadataSchema,
  })
  .loose();

export type RawRoadObjectType = z.infer<typeof roadObjectTypeSchema>;
export type RawRoadObject = z.infer<typeof roadObjectSchema>;
export type RawRoadObjectSearchResponse = z.infer<typeof roadObjectSearchResponseSchema>;
export type RawRoadNetworkSegment = z.infer<typeof roadNetworkSegmentSchema>;
export type RawRoadNetworkResponse = z.infer<typeof roadNetworkResponseSchema>;
