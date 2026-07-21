import { z } from "zod";

const numericDetailsSchema = z
  .object({
    air_temperature: z.number().optional(),
    wind_speed: z.number().nonnegative().optional(),
    wind_from_direction: z.number().min(0).max(360).optional(),
    relative_humidity: z.number().min(0).max(100).optional(),
    air_pressure_at_sea_level: z.number().positive().optional(),
    cloud_area_fraction: z.number().min(0).max(100).optional(),
    precipitation_amount: z.number().nonnegative().optional(),
  })
  .loose();

const periodSchema = z
  .object({
    summary: z
      .object({
        symbol_code: z.string().optional(),
      })
      .loose()
      .optional(),
    details: numericDetailsSchema.optional(),
  })
  .loose();

export const forecastResponseSchema = z
  .object({
    geometry: z
      .object({
        coordinates: z
          .array(z.number())
          .min(2)
          .max(3)
          .superRefine((coordinates, context) => {
            const [longitude, latitude] = coordinates;
            if (longitude === undefined || longitude < -180 || longitude > 180) {
              context.addIssue({ code: "custom", message: "Invalid MET longitude." });
            }
            if (latitude === undefined || latitude < -90 || latitude > 90) {
              context.addIssue({ code: "custom", message: "Invalid MET latitude." });
            }
          }),
      })
      .loose(),
    properties: z
      .object({
        meta: z
          .object({
            updated_at: z.iso.datetime({ offset: true }).optional(),
          })
          .loose(),
        timeseries: z
          .array(
            z
              .object({
                time: z.iso.datetime({ offset: true }),
                data: z
                  .object({
                    instant: z
                      .object({
                        details: numericDetailsSchema,
                      })
                      .loose(),
                    next_1_hours: periodSchema.optional(),
                    next_6_hours: periodSchema.optional(),
                  })
                  .loose(),
              })
              .loose(),
          )
          .min(1),
      })
      .loose(),
  })
  .loose();

export type RawForecast = z.infer<typeof forecastResponseSchema>;
