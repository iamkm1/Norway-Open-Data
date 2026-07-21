import { z } from "zod";

const nullableString = z.string().nullable().optional();
const nullableNumber = z.number().nullable().optional();
const isoDateTimeSchema = z.iso.datetime({ local: true, offset: true });
const nullableIsoDateTime = isoDateTimeSchema.nullable().optional();
const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

export const reservoirStatisticsSchema = z.array(
  z
    .object({
      dato_Id: z.iso.date(),
      omrType: z.string(),
      omrnr: z.number().int().nonnegative(),
      iso_aar: z.number().int().min(1900).max(2100),
      iso_uke: z.number().int().min(1).max(53),
      fyllingsgrad: z.number().min(0).max(1),
      kapasitet_TWh: z.number().nonnegative(),
      fylling_TWh: z.number().nonnegative(),
      neste_Publiseringsdato: nullableIsoDateTime,
      fyllingsgrad_forrige_uke: z.number().min(0).max(1).nullable().optional(),
      endring_fyllingsgrad: z.number().min(-1).max(1).nullable().optional(),
    })
    .loose(),
);

export const hydropowerPlantsSchema = z.array(
  z
    .object({
      VannKraftverkID: z.number().int().positive(),
      Navn: z.string(),
      Kommune: nullableString,
      KommuneNr: z.union([z.string(), z.number()]).nullable().optional(),
      // NVE publishes negative capacity and mean-production figures for some
      // plants (pumped storage reports net values), so these stay unbounded.
      MaksYtelse: z.number().nullable().optional(),
      MidProd_91_20: z.number().nullable().optional(),
      Kraftverkstatus: nullableString,
      ErIDrift: z.boolean().nullable().optional(),
    })
    .loose(),
);

export const windPowerPlantsSchema = z.array(
  z
    .object({
      VindkraftAnleggId: z.number().int().positive(),
      Navn: z.string(),
      Kommune: nullableString,
      Kommunenummer: z.union([z.string(), z.number()]).nullable().optional(),
      // Same NVE convention as the hydropower dataset, which publishes negative
      // capacity and production figures for some plants.
      InstallertEffekt_MW: z.number().nullable().optional(),
      NormalAArsproduksjon_GWh: z.number().nullable().optional(),
      IdriftsettelseForsteByggetrinn: nullableIsoDateTime,
    })
    .loose(),
);

const namedRegionSchema = z
  .object({
    Id: z.union([z.string(), z.number()]).optional(),
    Name: z.string(),
  })
  .loose();

export const warningsSchema = z.array(
  z
    .object({
      RegId: z.union([z.string(), z.number()]).nullable().optional(),
      RegionId: z.union([z.string(), z.number()]).nullable().optional(),
      RegionName: nullableString,
      DangerLevel: z.union([z.string(), z.number()]).nullable().optional(),
      DangerLevelName: nullableString,
      MainText: nullableString,
      ValidFrom: isoDateTimeSchema,
      ValidTo: isoDateTimeSchema,
      CountyList: z.array(namedRegionSchema).nullable().optional(),
      MunicipalityList: z.array(namedRegionSchema).nullable().optional(),
      Latitude: latitudeSchema.nullable().optional(),
      Longitude: longitudeSchema.nullable().optional(),
    })
    .loose(),
);

export const hydrologyStationsSchema = z
  .object({
    itemCount: z.number().int().nonnegative(),
    data: z
      .array(
        z
          .object({
            stationId: z.string().regex(/^\d+\.\d+\.\d+$/),
            stationName: nullableString,
            latitude: latitudeSchema.nullable().optional(),
            longitude: longitudeSchema.nullable().optional(),
            masl: nullableNumber,
            riverName: nullableString,
            councilNumber: nullableString,
            councilName: nullableString,
            countyName: nullableString,
            stationStatusName: nullableString,
          })
          .loose(),
      )
      .nullable()
      .optional(),
  })
  .superRefine((response, context) => {
    const returned = response.data?.length ?? 0;
    if (
      (response.itemCount === 0 && returned !== 0) ||
      (response.itemCount > 0 && returned === 0)
    ) {
      context.addIssue({ code: "custom", message: "Inconsistent HydAPI station count." });
    }
  })
  .loose();

export const hydrologyObservationsSchema = z
  .object({
    itemCount: z.number().int().nonnegative(),
    data: z
      .array(
        z
          .object({
            time: isoDateTimeSchema,
            value: z.number().nullable(),
          })
          .loose(),
      )
      .nullable()
      .optional(),
  })
  .superRefine((response, context) => {
    const returned = response.data?.length ?? 0;
    if (
      (response.itemCount === 0 && returned !== 0) ||
      (response.itemCount > 0 && returned === 0)
    ) {
      context.addIssue({ code: "custom", message: "Inconsistent HydAPI observation count." });
    }
  })
  .loose();

export type RawReservoirStatistics = z.infer<typeof reservoirStatisticsSchema>;
export type RawHydropowerPlants = z.infer<typeof hydropowerPlantsSchema>;
export type RawWindPowerPlants = z.infer<typeof windPowerPlantsSchema>;
export type RawWarnings = z.infer<typeof warningsSchema>;
export type RawHydrologyStations = z.infer<typeof hydrologyStationsSchema>;
export type RawHydrologyObservations = z.infer<typeof hydrologyObservationsSchema>;
