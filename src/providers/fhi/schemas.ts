import { z } from "zod";

export const sourceListSchema = z.array(
  z
    .object({
      id: z.string().min(1),
      title: z.string(),
      description: z.string().nullish(),
      aboutUrl: z.string().nullish(),
      publishedBy: z.string().nullish(),
    })
    .loose(),
);

export const tableListSchema = z.array(
  z
    .object({
      tableId: z.number().int().nonnegative(),
      title: z.string(),
      publishedAt: z.string().nullish(),
      modifiedAt: z.string().nullish(),
    })
    .loose(),
);

export const tableMetadataSchema = z
  .object({
    name: z.string(),
    isOfficialStatistics: z.boolean().nullish(),
    paragraphs: z
      .array(
        z
          .object({
            header: z.string().nullish(),
            content: z.string().nullish(),
          })
          .loose(),
      )
      .nullish(),
  })
  .loose();

export type RawDimensionCategory = {
  value: string;
  label?: string | null | undefined;
  children?: RawDimensionCategory[] | null | undefined;
  [key: string]: unknown;
};

const dimensionCategorySchema: z.ZodType<RawDimensionCategory> = z
  .object({
    value: z.string(),
    label: z.string().nullish(),
    children: z.lazy(() => z.array(dimensionCategorySchema).nullish()),
  })
  .loose();

export const tableDimensionsSchema = z
  .object({
    dimensions: z.array(
      z
        .object({
          code: z.string().min(1),
          label: z.string().nullish(),
          categories: z.array(dimensionCategorySchema),
        })
        .loose(),
    ),
  })
  .loose();

const jsonStatCategorySchema = z
  .object({
    index: z.union([z.record(z.string(), z.number().int().nonnegative()), z.array(z.string())]),
    label: z.record(z.string(), z.string()).optional(),
  })
  .loose();

const jsonStatDimensionSchema = z
  .object({
    label: z.string().nullish(),
    category: jsonStatCategorySchema,
  })
  .loose();

const jsonStatCellSchema = z.union([z.number(), z.string(), z.null()]);

/**
 * FHI's JSON-stat2 payload. Unlike SSB, observations may be flag symbols
 * (strings), several nullable metadata fields are null rather than absent, and
 * the flag legend arrives in `extension.flags`.
 */
export const fhiJsonStatSchema = z
  .object({
    version: z.literal("2.0"),
    class: z.literal("dataset"),
    label: z.string().nullish(),
    updated: z.string().nullish(),
    id: z.array(z.string()).min(1),
    size: z.array(z.number().int().nonnegative()).min(1),
    dimension: z.record(z.string(), jsonStatDimensionSchema),
    value: z.union([z.array(jsonStatCellSchema), z.record(z.string(), jsonStatCellSchema)]),
    extension: z
      .object({
        flags: z
          .object({
            index: z.array(z.string()).optional(),
            label: z.record(z.string(), z.string()).optional(),
          })
          .loose()
          .nullish(),
      })
      .loose()
      .nullish(),
  })
  .loose();

export type RawFhiJsonStat = z.infer<typeof fhiJsonStatSchema>;
