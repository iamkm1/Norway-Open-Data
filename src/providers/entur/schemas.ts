import { z } from "zod";

const nullableString = z.string().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();
const nullableDateTime = z.iso.datetime({ offset: true }).nullable().optional();
const coordinatesSchema = z
  .array(z.number())
  .min(2)
  .max(3)
  .superRefine((coordinates, context) => {
    const [longitude, latitude] = coordinates;
    if (longitude === undefined || longitude < -180 || longitude > 180) {
      context.addIssue({ code: "custom", message: "Invalid longitude." });
    }
    if (latitude === undefined || latitude < -90 || latitude > 90) {
      context.addIssue({ code: "custom", message: "Invalid latitude." });
    }
  });

export const autocompleteResponseSchema = z
  .object({
    features: z.array(
      z
        .object({
          geometry: z
            .object({
              coordinates: coordinatesSchema,
            })
            .loose()
            .optional(),
          properties: z
            .object({
              id: nullableString,
              gid: nullableString,
              name: nullableString,
              label: nullableString,
              category: z
                .union([z.string(), z.array(z.string())])
                .nullable()
                .optional(),
            })
            .refine(
              (value) =>
                (value.name?.trim().length ?? 0) > 0 || (value.label?.trim().length ?? 0) > 0,
              { message: "Autocomplete feature omitted its name." },
            )
            .loose(),
        })
        .loose(),
    ),
  })
  .loose();

const lineSchema = z
  .object({
    id: nullableString,
    publicCode: nullableString,
    name: nullableString,
    transportMode: nullableString,
  })
  .loose();

const quaySchema = z
  .object({
    id: nullableString,
    name: nullableString,
  })
  .loose();

const estimatedCallSchema = z
  .object({
    realtime: nullableBoolean,
    cancellation: nullableBoolean,
    aimedDepartureTime: nullableDateTime,
    expectedDepartureTime: nullableDateTime,
    aimedArrivalTime: nullableDateTime,
    expectedArrivalTime: nullableDateTime,
    quay: quaySchema.nullable().optional(),
  })
  .loose();

const graphQlErrorSchema = z
  .object({
    message: z.string().min(1),
  })
  .loose();

export const departuresResponseSchema = z
  .object({
    data: z
      .object({
        stopPlace: z
          .object({
            id: z.string().min(1),
            name: z.string().min(1),
            estimatedCalls: z.array(
              estimatedCallSchema.extend({
                destinationDisplay: z
                  .object({
                    frontText: nullableString,
                  })
                  .loose()
                  .nullable()
                  .optional(),
                serviceJourney: z
                  .object({
                    journeyPattern: z
                      .object({
                        line: lineSchema.nullable().optional(),
                      })
                      .loose()
                      .nullable()
                      .optional(),
                  })
                  .loose()
                  .nullable()
                  .optional(),
              }),
            ),
          })
          .loose()
          .nullable(),
      })
      .loose()
      .optional(),
    errors: z.array(graphQlErrorSchema).optional(),
  })
  .loose()
  .refine((value) => value.data !== undefined || (value.errors?.length ?? 0) > 0, {
    message: "Entur GraphQL response must include data or errors.",
  });

export const journeysResponseSchema = z
  .object({
    data: z
      .object({
        trip: z
          .object({
            tripPatterns: z.array(
              z
                .object({
                  startTime: nullableDateTime,
                  endTime: nullableDateTime,
                  duration: z.number().nonnegative().nullable().optional(),
                  legs: z.array(
                    z
                      .object({
                        mode: nullableString,
                        distance: z.number().nonnegative().nullable().optional(),
                        expectedStartTime: nullableDateTime,
                        expectedEndTime: nullableDateTime,
                        line: lineSchema.nullable().optional(),
                        fromEstimatedCall: estimatedCallSchema.nullable().optional(),
                        toEstimatedCall: estimatedCallSchema.nullable().optional(),
                      })
                      .loose(),
                  ),
                })
                .loose(),
            ),
          })
          .loose()
          .nullable(),
      })
      .loose()
      .optional(),
    errors: z.array(graphQlErrorSchema).optional(),
  })
  .loose()
  .refine((value) => value.data !== undefined || (value.errors?.length ?? 0) > 0, {
    message: "Entur GraphQL response must include data or errors.",
  });

export type RawAutocomplete = z.infer<typeof autocompleteResponseSchema>;
export type RawDepartures = z.infer<typeof departuresResponseSchema>;
export type RawJourneys = z.infer<typeof journeysResponseSchema>;
