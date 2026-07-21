import { z } from "zod";

// Nordic day-ahead prices can legitimately be zero or negative during periods
// of surplus production, so price fields are deliberately unbounded.
export const electricityPricesSchema = z
  .array(
    z
      .object({
        NOK_per_kWh: z.number(),
        EUR_per_kWh: z.number(),
        EXR: z.number().positive(),
        time_start: z.iso.datetime({ offset: true }),
        time_end: z.iso.datetime({ offset: true }),
      })
      .loose(),
  )
  .min(1);

export type RawElectricityPrices = z.infer<typeof electricityPricesSchema>;
