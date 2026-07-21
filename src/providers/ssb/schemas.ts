import { z } from "zod";

const categorySchema = z
  .object({
    index: z.union([z.record(z.string(), z.number().int().nonnegative()), z.array(z.string())]),
    label: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const dimensionSchema = z
  .object({
    label: z.string().optional(),
    category: categorySchema,
  })
  .loose();

export const jsonStatSchema = z
  .object({
    version: z.literal("2.0"),
    class: z.literal("dataset"),
    label: z.string().optional(),
    updated: z.string().optional(),
    id: z.array(z.string()).min(1),
    size: z.array(z.number().int().nonnegative()).min(1),
    dimension: z.record(z.string(), dimensionSchema),
    value: z.union([z.array(z.number().nullable()), z.record(z.string(), z.number().nullable())]),
  })
  .loose();

export type RawJsonStat = z.infer<typeof jsonStatSchema>;
