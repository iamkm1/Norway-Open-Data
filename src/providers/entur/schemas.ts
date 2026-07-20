import { z } from "zod";

const nullableString = z.string().nullable().optional();
const nullableBoolean = z.boolean().nullable().optional();

export const autocompleteResponseSchema = z
  .object({
    features: z.array(
      z
        .object({
          geometry: z
            .object({
              coordinates: z.array(z.number()).min(2),
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
    aimedDepartureTime: nullableString,
    expectedDepartureTime: nullableString,
    aimedArrivalTime: nullableString,
    expectedArrivalTime: nullableString,
    quay: quaySchema.nullable().optional(),
  })
  .loose();

const graphQlErrorSchema = z
  .object({
    message: z.string(),
  })
  .loose();

export const departuresResponseSchema = z
  .object({
    data: z
      .object({
        stopPlace: z
          .object({
            id: z.string(),
            name: z.string(),
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
                  startTime: nullableString,
                  endTime: nullableString,
                  duration: z.number().nullable().optional(),
                  legs: z.array(
                    z
                      .object({
                        mode: nullableString,
                        distance: z.number().nullable().optional(),
                        expectedStartTime: nullableString,
                        expectedEndTime: nullableString,
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
