/**
 * Frost JSON-LD response schemas, following the models in Frost's published
 * Swagger document (https://frost.met.no/swagger.json).
 *
 * Every envelope is nullable: Frost answers HTTP 404 ("no data was found") and,
 * for observations, HTTP 412 ("no available time series") when a query matches
 * nothing, and the client declares those as absences.
 */
import { z } from "zod";

const pointSchema = z
  .object({
    coordinates: z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
  })
  .loose();

const levelSchema = z
  .object({
    levelType: z.string().optional(),
    unit: z.string().optional(),
    value: z.number().optional(),
  })
  .loose();

/** Fields every Frost JSON-LD response envelope carries around its `data`. */
const envelopeShape = {
  "@type": z.string().optional(),
  apiVersion: z.string().optional(),
  license: z.string().optional(),
  createdAt: z.string().optional(),
  totalItemCount: z.number().int().nonnegative().optional(),
};

/**
 * A Frost source.
 *
 * `stationHolders` names the organizations -- and for some volunteer-run
 * stations potentially people -- responsible for a station. It is removed here,
 * at the validation boundary, so it reaches neither callers, `raw` nor the cache.
 */
const sourceSchema = z
  .object({
    "@type": z.string().optional(),
    id: z.string().min(1),
    name: z.string().min(1),
    shortName: z.string().optional(),
    countryCode: z.string().optional(),
    wmoId: z.number().int().optional(),
    geometry: pointSchema.optional(),
    distance: z.number().nonnegative().optional(),
    masl: z.number().optional(),
    validFrom: z.string().optional(),
    validTo: z.string().optional(),
    county: z.string().optional(),
    countyId: z.number().int().optional(),
    municipality: z.string().optional(),
    municipalityId: z.number().int().optional(),
    externalIds: z.array(z.string()).optional(),
    icaoCodes: z.array(z.string()).optional(),
    wigosId: z.string().optional(),
  })
  .loose()
  .transform((source) => {
    const withheld = { ...source };
    delete withheld["stationHolders"];
    return withheld;
  });

export const sourceResponseSchema = z
  .object({ ...envelopeShape, data: z.array(sourceSchema) })
  .loose()
  .nullable();
export type RawSource = z.infer<typeof sourceSchema>;

const timeSeriesSchema = z
  .object({
    sourceId: z.string().min(1),
    geometry: pointSchema.optional(),
    level: levelSchema.optional(),
    validFrom: z.string().optional(),
    validTo: z.string().nullable().optional(),
    timeOffset: z.string().optional(),
    timeResolution: z.string().optional(),
    timeSeriesId: z.number().int().optional(),
    elementId: z.string().min(1),
    unit: z.string().optional(),
    performanceCategory: z.string().optional(),
    exposureCategory: z.string().optional(),
    status: z.string().optional(),
  })
  .loose();

export const timeSeriesResponseSchema = z
  .object({ ...envelopeShape, data: z.array(timeSeriesSchema) })
  .loose()
  .nullable();
export type RawTimeSeries = z.infer<typeof timeSeriesSchema>;

const observationSchema = z
  .object({
    elementId: z.string().min(1),
    value: z.union([z.number(), z.string().min(1)]),
    unit: z.string().optional(),
    codeTable: z.string().optional(),
    level: levelSchema.optional(),
    timeOffset: z.string().optional(),
    timeResolution: z.string().optional(),
    timeSeriesId: z.number().int().optional(),
    performanceCategory: z.string().optional(),
    exposureCategory: z.string().optional(),
    qualityCode: z.number().int().optional(),
  })
  .loose();

const observationRecordSchema = z
  .object({
    sourceId: z.string().min(1),
    geometry: pointSchema.optional(),
    referenceTime: z.iso.datetime({ offset: true }),
    observations: z.array(observationSchema),
  })
  .loose();

export const observationResponseSchema = z
  .object({ ...envelopeShape, data: z.array(observationRecordSchema) })
  .loose()
  .nullable();
export type RawObservationRecord = z.infer<typeof observationRecordSchema>;

const climateNormalSchema = z
  .object({
    sourceId: z.string().min(1),
    elementId: z.string().min(1),
    period: z.string().min(1),
    month: z.number().int().min(0).max(12).optional(),
    day: z.number().int().min(1).max(31).optional(),
    normal: z.number().optional(),
  })
  .loose();

export const climateNormalResponseSchema = z
  .object({ ...envelopeShape, data: z.array(climateNormalSchema) })
  .loose()
  .nullable();
export type RawClimateNormal = z.infer<typeof climateNormalSchema>;
