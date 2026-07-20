import { z } from "zod";

const numericDetailsSchema = z
  .object({
    air_temperature: z.number().optional(),
    wind_speed: z.number().optional(),
    wind_from_direction: z.number().optional(),
    relative_humidity: z.number().optional(),
    air_pressure_at_sea_level: z.number().optional(),
    cloud_area_fraction: z.number().optional(),
    precipitation_amount: z.number().optional(),
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
        coordinates: z.array(z.number()).min(2),
      })
      .loose(),
    properties: z
      .object({
        meta: z
          .object({
            updated_at: z.string().optional(),
          })
          .loose(),
        timeseries: z.array(
          z
            .object({
              time: z.string(),
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
        ),
      })
      .loose(),
  })
  .loose();

export type RawForecast = z.infer<typeof forecastResponseSchema>;
