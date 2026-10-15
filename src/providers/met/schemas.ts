import { z } from "zod";

import { nullableGeoJsonGeometrySchema } from "../../core/geojson.js";

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

const isoTimestampSchema = z.iso.datetime({ offset: true });

/** A GeoJSON point geometry: longitude, latitude and an optional altitude. */
const pointGeometrySchema = z
  .object({
    coordinates: z
      .array(z.number())
      .min(2)
      .max(3)
      .superRefine((coordinates, context) => {
        const [longitude, latitude] = coordinates;
        if (longitude === undefined || longitude < -180 || longitude > 180) {
          context.addIssue({ code: "custom", message: "Invalid MET Norway longitude." });
        }
        if (latitude === undefined || latitude < -90 || latitude > 90) {
          context.addIssue({ code: "custom", message: "Invalid MET Norway latitude." });
        }
      }),
  })
  .loose();

/** `"2; yellow; Moderate"`: level, risk colour and CAP severity word. */
export const AWARENESS_LEVEL_PATTERN =
  /^\s*([1-4])\s*;\s*(green|yellow|orange|red)\s*;\s*(\S(?:.*\S)?)\s*$/i;
/** `"1; Wind"`: MeteoAlarm awareness-type number and name. */
export const AWARENESS_TYPE_PATTERN = /^\s*(\d{1,2})\s*;\s*(\S(?:.*\S)?)\s*$/;

const riskColorSchema = z
  .string()
  .transform((value) => value.trim().toLowerCase())
  .pipe(z.enum(["green", "yellow", "orange", "red"]));

const warningResourceSchema = z
  .object({
    description: z.string().nullable().optional(),
    mimeType: z.string().nullable().optional(),
    uri: z.string().min(1),
  })
  .loose();

const warningPropertiesSchema = z
  .object({
    id: z.string().min(1),
    event: z.string().min(1),
    eventAwarenessName: z.string().nullable().optional(),
    title: z.string().min(1),
    area: z.string(),
    description: z.string(),
    instruction: z.string().nullable().optional(),
    consequences: z.string().nullable().optional(),
    awareness_level: z.string().regex(AWARENESS_LEVEL_PATTERN),
    awareness_type: z.string().regex(AWARENESS_TYPE_PATTERN).nullable().optional(),
    awarenessResponse: z.string().nullable().optional(),
    awarenessSeriousness: z.string().nullable().optional(),
    riskMatrixColor: riskColorSchema.nullable().optional(),
    severity: z.string().min(1),
    certainty: z.string().min(1),
    status: z.string().min(1),
    type: z.string().min(1),
    triggerLevel: z.string().nullable().optional(),
    geographicDomain: z.enum(["land", "marine"]).nullable().optional(),
    county: z
      .array(z.string().regex(/^\d{1,2}$/))
      .nullable()
      .optional(),
    municipality: z
      .array(z.string().regex(/^\d{4}$/))
      .nullable()
      .optional(),
    incidentName: z.string().nullable().optional(),
    eventEndingTime: isoTimestampSchema.nullable().optional(),
    contact: z.string().nullable().optional(),
    web: z.string().nullable().optional(),
    resources: z.array(warningResourceSchema).nullable().optional(),
  })
  .loose();

const warningFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: nullableGeoJsonGeometrySchema,
    properties: warningPropertiesSchema,
    when: z
      .object({ interval: z.array(isoTimestampSchema).min(1).max(2) })
      .loose()
      .optional(),
  })
  .loose();

/** MetAlerts 2.0 `current.json` feature collection. */
export const warningCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(warningFeatureSchema),
    lang: z.string().optional(),
    lastChange: isoTimestampSchema.optional(),
  })
  .loose();

export type RawWarningCollection = z.infer<typeof warningCollectionSchema>;
export type RawWarningFeature = RawWarningCollection["features"][number];

const nowcastDetailsSchema = z
  .object({
    air_temperature: z.number().optional(),
    apparent_air_temperature: z.number().optional(),
    precipitation_rate: z.number().nonnegative().optional(),
    relative_humidity: z.number().min(0).max(100).optional(),
    ultraviolet_index_clear_sky: z.number().nonnegative().optional(),
    wind_from_direction: z.number().min(0).max(360).optional(),
    wind_speed: z.number().nonnegative().optional(),
    wind_speed_of_gust: z.number().nonnegative().optional(),
  })
  .loose();

/** Nowcast 2.0 `complete` response, or `null` for a point outside the radar area. */
export const nowcastResponseSchema = z
  .object({
    geometry: pointGeometrySchema,
    properties: z
      .object({
        meta: z
          .object({
            updated_at: isoTimestampSchema.optional(),
            radar_coverage: z.string().min(1).optional(),
          })
          .loose(),
        timeseries: z.array(
          z
            .object({
              time: isoTimestampSchema,
              data: z
                .object({
                  instant: z.object({ details: nowcastDetailsSchema }).loose(),
                  next_1_hours: periodSchema.optional(),
                })
                .loose(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose()
  .nullable();

export type RawNowcast = NonNullable<z.infer<typeof nowcastResponseSchema>>;

const celestialEventSchema = z
  .object({
    time: isoTimestampSchema.nullable(),
    azimuth: z.number().min(0).max(360).nullable().optional(),
  })
  .loose();

const celestialPositionSchema = z
  .object({
    time: isoTimestampSchema.nullable(),
    disc_centre_elevation: z.number().min(-90).max(90).nullable().optional(),
    visible: z.boolean().nullable().optional(),
  })
  .loose();

const celestialResponseShape = {
  geometry: pointGeometrySchema,
  when: z
    .object({ interval: z.array(isoTimestampSchema).length(2) })
    .loose()
    .optional(),
};

/** Sunrise 3.0 `sun` response. */
export const sunResponseSchema = z
  .object({
    ...celestialResponseShape,
    properties: z
      .object({
        body: z.literal("Sun"),
        sunrise: celestialEventSchema.nullable().optional(),
        sunset: celestialEventSchema.nullable().optional(),
        solarnoon: celestialPositionSchema.nullable().optional(),
        solarmidnight: celestialPositionSchema.nullable().optional(),
      })
      .loose(),
  })
  .loose();

export type RawSun = z.infer<typeof sunResponseSchema>;

/** Sunrise 3.0 `moon` response. */
export const moonResponseSchema = z
  .object({
    ...celestialResponseShape,
    properties: z
      .object({
        body: z.literal("Moon"),
        moonrise: celestialEventSchema.nullable().optional(),
        moonset: celestialEventSchema.nullable().optional(),
        high_moon: celestialPositionSchema.nullable().optional(),
        low_moon: celestialPositionSchema.nullable().optional(),
        moonphase: z.number().min(0).max(360).nullable().optional(),
      })
      .loose(),
  })
  .loose();

export type RawMoon = z.infer<typeof moonResponseSchema>;

const oceanDetailsSchema = z
  .object({
    sea_surface_wave_from_direction: z.number().min(0).max(360).optional(),
    sea_surface_wave_height: z.number().nonnegative().optional(),
    sea_water_speed: z.number().nonnegative().optional(),
    sea_water_temperature: z.number().optional(),
    sea_water_to_direction: z.number().min(0).max(360).optional(),
  })
  .loose();

/** Oceanforecast 2.0 `complete` response, or `null` outside every model area. */
export const oceanForecastResponseSchema = z
  .object({
    geometry: pointGeometrySchema,
    properties: z
      .object({
        meta: z
          .object({
            updated_at: isoTimestampSchema.optional(),
            error: z.string().optional(),
          })
          .loose(),
        timeseries: z.array(
          z
            .object({
              time: isoTimestampSchema,
              data: z
                .object({ instant: z.object({ details: oceanDetailsSchema }).loose() })
                .loose(),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose()
  .nullable();

export type RawOceanForecast = NonNullable<z.infer<typeof oceanForecastResponseSchema>>;

const decimalStringSchema = z
  .string()
  .regex(/^-?\d+(?:\.\d+)?$/)
  .transform(Number);

const airQualityLocationSchema = z
  .object({
    name: z.string().min(1),
    areaclass: z.string().min(1),
    longitude: decimalStringSchema.pipe(z.number().min(-180).max(180)),
    latitude: decimalStringSchema.pipe(z.number().min(-90).max(90)),
    path: z.string().optional(),
    areacode: z.string().min(1),
    superareacode: z.string().optional(),
  })
  .loose();

/** Airqualityforecast 0.1 response, or `null` for a location the model does not know. */
export const airQualityResponseSchema = z
  .object({
    meta: z
      .object({
        reftime: isoTimestampSchema,
        location: airQualityLocationSchema,
        superlocation: airQualityLocationSchema.optional(),
      })
      .loose(),
    data: z
      .object({
        time: z.array(
          z
            .object({
              from: isoTimestampSchema,
              to: isoTimestampSchema,
              variables: z.record(
                z.string(),
                z.object({ value: z.number(), units: z.string() }).loose(),
              ),
            })
            .loose(),
        ),
      })
      .loose(),
  })
  .loose()
  .nullable();

export type RawAirQuality = NonNullable<z.infer<typeof airQualityResponseSchema>>;
