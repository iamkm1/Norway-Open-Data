import { z } from "zod";

export const csvTextSchema = z.string().min(1);

const dateStringSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Expected a valid ISO calendar date.");

export const exchangeRateInputSchema = z
  .object({
    from: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    to: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    date: dateStringSchema.optional(),
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.date !== undefined &&
      (value.startDate !== undefined || value.endDate !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        message: "date cannot be combined with startDate or endDate.",
      });
    }
    if (
      value.startDate !== undefined &&
      value.endDate !== undefined &&
      value.startDate > value.endDate
    ) {
      context.addIssue({ code: "custom", message: "startDate must not be after endDate." });
    }
    if (value.from === (value.to ?? "NOK")) {
      context.addIssue({ code: "custom", message: "from and to currencies must differ." });
    }
  });

export const timeSeriesInputSchema = z
  .object({
    startDate: dateStringSchema.optional(),
    endDate: dateStringSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.startDate !== undefined &&
      value.endDate !== undefined &&
      value.startDate > value.endDate
    ) {
      context.addIssue({ code: "custom", message: "startDate must not be after endDate." });
    }
  });

const decimalStringSchema = z.string().regex(/^-?(?:\d+(?:\.\d+)?|\.\d+)$/);
const integerStringSchema = z.string().regex(/^-?\d+$/);

export const exchangeRateRowSchema = z
  .object({
    FREQ: z.literal("B"),
    BASE_CUR: z.string().regex(/^[A-Z]{3}$/),
    QUOTE_CUR: z.literal("NOK"),
    TENOR: z.literal("SP"),
    DECIMALS: integerStringSchema,
    CALCULATED: z.enum(["true", "false"]),
    UNIT_MULT: integerStringSchema,
    COLLECTION: z.string(),
    TIME_PERIOD: dateStringSchema,
    OBS_VALUE: decimalStringSchema,
  })
  .loose();

export const policyRateRowSchema = z
  .object({
    FREQ: z.literal("B"),
    INSTRUMENT_TYPE: z.literal("KPRA"),
    TENOR: z.literal("SD"),
    UNIT_MEASURE: z.literal("R"),
    DECIMALS: integerStringSchema,
    COLLECTION: z.string(),
    TIME_PERIOD: dateStringSchema,
    OBS_VALUE: decimalStringSchema,
    CALC_METHOD: z.string(),
  })
  .loose();

export const nowaRowSchema = z
  .object({
    FREQ: z.literal("B"),
    INSTRUMENT_TYPE: z.literal("NOWA"),
    TENOR: z.literal("ON"),
    UNIT_MEASURE: z.literal("R"),
    COLLECTION: z.string(),
    DECIMALS: integerStringSchema,
    TIME_PERIOD: dateStringSchema,
    OBS_VALUE: decimalStringSchema,
    CALC_METHOD: z.string(),
  })
  .loose();

export type RawExchangeRateRow = z.infer<typeof exchangeRateRowSchema>;
