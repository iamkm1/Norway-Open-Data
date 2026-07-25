/**
 * Runtime schemas for the BarentsWatch AIS APIs.
 *
 * Every field mirrors the provider's published OpenAPI documents for
 * `live.ais.barentswatch.no` and `historic.ais.barentswatch.no`. A field is
 * optional here only where the provider declares it nullable.
 */
import { z } from "zod";

/** AIS transmits MMSI and IMO as 32-bit integers. */
const identifierSchema = z.number().int().nonnegative();

/**
 * One record from an AIS stream or snapshot.
 *
 * The provider's AIS endpoints return a union of five message shapes -- position,
 * static and voyage data, aid-to-navigation, a met/hyd binary broadcast, and a
 * safety-related broadcast -- distinguished by the `type` label. They are
 * validated here as one flat shape, with the five fields common to all of them
 * required and every shape-specific field optional, because the provider declares
 * each of those nullable in its own schemas.
 *
 * A Zod union would be the obvious alternative and is wrong for this payload:
 * object schemas strip unknown keys, the shapes differ only by which optional
 * fields they add, so a static-data message would validate as a position message
 * and silently lose its name, call sign and IMO number. One flat shape cannot lose
 * a field. The type of every field is still checked, the always-present fields are
 * still required, and {@link AisClient} narrows a validated
 * record to a discriminated {@link AisMessage} using the
 * provider's own label.
 *
 * No field name is shared between two shapes with a different meaning:
 * `latitude`, `longitude` and `name` appear in several and mean the same thing in
 * each.
 */
export const aisMessageSchema = z.object({
  // Present on every message shape.
  type: z.string().nullish(),
  messageType: z.number().int(),
  mmsi: identifierSchema,
  msgtime: z.string().min(1),
  stream: z.string().nullish(),

  // Position reports (AIS types 1, 2, 3, 9, 18, 19, 27), also used by
  // aid-to-navigation and met/hyd broadcasts for their own coordinates.
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  courseOverGround: z.number().nullish(),
  speedOverGround: z.number().nullish(),
  trueHeading: z.number().int().nullish(),
  rateOfTurn: z.number().nullish(),
  navigationalStatus: z.number().int().nullish(),
  aisClass: z.string().nullish(),
  altitude: z.number().int().nullish(),

  // Static and voyage data (AIS types 5, 24).
  name: z.string().nullish(),
  callSign: z.string().nullish(),
  imoNumber: identifierSchema.nullish(),
  destination: z.string().nullish(),
  eta: z.string().nullish(),
  draught: z.number().int().nullish(),
  shipLength: z.number().int().nullish(),
  shipWidth: z.number().int().nullish(),
  shipType: z.number().int().nullish(),
  dimensionA: z.number().int().nullish(),
  dimensionB: z.number().int().nullish(),
  dimensionC: z.number().int().nullish(),
  dimensionD: z.number().int().nullish(),
  positionFixingDeviceType: z.number().int().nullish(),
  reportClass: z.string().nullish(),

  // Aid-to-navigation (AIS type 21).
  typeOfAidsToNavigation: z.number().int().nullish(),
  typeOfElectronicFixingDevice: z.number().int().nullish(),

  // Meteorological and hydrological binary broadcast (AIS type 8).
  //
  // The provider publishes all 36 payload fields, so all 36 are validated here.
  // Validating a subset would strip the rest, and this message has no other
  // representation: a streamed message is not accompanied by a raw payload.
  functionalId: z.number().int().nullish(),
  designatedAreaCode: z.number().int().nullish(),
  day: z.number().int().nullish(),
  hour: z.number().int().nullish(),
  minute: z.number().int().nullish(),
  avgWindSpeed: z.number().int().nullish(),
  windGust: z.number().int().nullish(),
  windDirection: z.number().int().nullish(),
  windGustDirection: z.number().int().nullish(),
  airTemperature: z.number().nullish(),
  relativeHumidity: z.number().int().nullish(),
  dewPoint: z.number().nullish(),
  airPressure: z.number().int().nullish(),
  horizontalVisibility: z.number().nullish(),
  waterLevel: z.number().nullish(),
  surfaceCurrentSpeed: z.number().nullish(),
  surfaceCurrentDirection: z.number().int().nullish(),
  currentSpeed2: z.number().nullish(),
  currentDirection2: z.number().int().nullish(),
  currentMeasuringLevel2: z.number().int().nullish(),
  currentSpeed3: z.number().nullish(),
  currentDirection3: z.number().int().nullish(),
  currentMeasuringLevel3: z.number().int().nullish(),
  significantWaveHeight: z.number().nullish(),
  wavePeriod: z.number().int().nullish(),
  waveDirection: z.number().int().nullish(),
  swellHeight: z.number().nullish(),
  swellPeriod: z.number().int().nullish(),
  swellDirection: z.number().int().nullish(),
  waterTemperature: z.number().nullish(),
  salinity: z.number().nullish(),
  /**
   * Enumerated met/hydro fields, kept as plain strings.
   *
   * The provider declares each as a closed enum -- `MetHydTrend`,
   * `MetHydBeaufortScale`, `MetHydPrecipitation` and `MetHydIce` -- and every one
   * of them already reserves members for future use. Pinning the members here
   * would fail an entire stream the day one is filled in, which is a poor trade
   * for a label the SDK passes through untouched.
   */
  airPressureTendency: z.string().nullish(),
  waterLevelTrend: z.string().nullish(),
  seaState: z.string().nullish(),
  precipitationType: z.string().nullish(),
  ice: z.string().nullish(),

  // Safety-related broadcast (AIS types 12, 14).
  safetyRelatedText: z.string().nullish(),
  sequenceNumber: z.number().int().nullish(),
  destinationMmsi: identifierSchema.nullish(),
});

/** @internal */
export type RawAisMessage = z.infer<typeof aisMessageSchema>;

/** A snapshot of the latest message per MMSI. */
export const aisMessageListSchema = z.array(aisMessageSchema);

/**
 * A merged position-and-static record (`AisComboFull`).
 *
 * Its own contract, not a variant of the message shapes: it carries two
 * timestamps -- one per source message -- and no `messageType`, because it is
 * assembled by the provider rather than transmitted as a single AIS message.
 */
export const aisVesselSnapshotSchema = z.object({
  mmsi: identifierSchema,
  msgtime: z.string().min(1),
  msgtimeStatic: z.string().nullish(),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  courseOverGround: z.number().nullish(),
  speedOverGround: z.number().nullish(),
  trueHeading: z.number().int().nullish(),
  rateOfTurn: z.number().nullish(),
  navigationalStatus: z.number().int().nullish(),
  altitude: z.number().int().nullish(),
  name: z.string().nullish(),
  callSign: z.string().nullish(),
  imoNumber: identifierSchema.nullish(),
  destination: z.string().nullish(),
  eta: z.string().nullish(),
  draught: z.number().int().nullish(),
  shipLength: z.number().int().nullish(),
  shipWidth: z.number().int().nullish(),
  shipType: z.number().int().nullish(),
  dimensionA: z.number().int().nullish(),
  dimensionB: z.number().int().nullish(),
  dimensionC: z.number().int().nullish(),
  dimensionD: z.number().int().nullish(),
  positionFixingDeviceType: z.number().int().nullish(),
  reportClass: z.string().nullish(),
  stream: z.string().nullish(),
});

/** @internal */
export type RawAisVesselSnapshot = z.infer<typeof aisVesselSnapshotSchema>;

/** The combined-latest endpoint returns a bare array of snapshots. */
export const aisVesselSnapshotListSchema = z.array(aisVesselSnapshotSchema);

/**
 * A point from the historic tracks endpoints (`AisComboSimple`).
 *
 * A genuinely different contract from the live messages: it merges position
 * fields with the vessel's name and type, and carries no `messageType`. Reusing
 * the live schema here would have to make `messageType` optional and weaken
 * validation for both.
 */
export const aisTrackPointSchema = z.object({
  mmsi: identifierSchema,
  msgtime: z.string().min(1),
  latitude: z.number().nullish(),
  longitude: z.number().nullish(),
  name: z.string().nullish(),
  courseOverGround: z.number().nullish(),
  speedOverGround: z.number().nullish(),
  trueHeading: z.number().int().nullish(),
  rateOfTurn: z.number().nullish(),
  navigationalStatus: z.number().int().nullish(),
  shipType: z.number().int().nullish(),
  stream: z.string().nullish(),
});

/** @internal */
export type RawAisTrackPoint = z.infer<typeof aisTrackPointSchema>;

/** The historic tracks endpoints return a bare array of points. */
export const aisTrackSchema = z.array(aisTrackPointSchema);

/** `AisVesselSearchResult` from the historic name search. */
export const aisVesselMatchSchema = z.object({
  mmsi: identifierSchema,
  name: z.string().nullish(),
  imoNumber: identifierSchema.nullish(),
  callSign: z.string().nullish(),
  country: z.string().nullish(),
  shipType: z.number().int().nullish(),
  courseOverGround: z.number().nullish(),
  heading: z.number().nullish(),
  timeStamp: z.string().nullish(),
});

/** @internal */
export type RawAisVesselMatch = z.infer<typeof aisVesselMatchSchema>;

/** The vessel search returns a bare array of matches. */
export const aisVesselSearchSchema = z.array(aisVesselMatchSchema);

/** `mmsiinarea` returns a bare array of MMSI integers. */
export const aisMmsiListSchema = z.array(identifierSchema);

/** A GeoJSON position, `[longitude, latitude]`. */
const geoJsonPositionSchema = z.tuple([z.number(), z.number()]);

/** The published open-AIS coverage area, a GeoJSON MultiPolygon. */
export const aisCoverageAreaSchema = z.object({
  type: z.literal("MultiPolygon"),
  coordinates: z.array(z.array(z.array(geoJsonPositionSchema))),
});

/** @internal */
export type RawAisCoverageArea = z.infer<typeof aisCoverageAreaSchema>;
