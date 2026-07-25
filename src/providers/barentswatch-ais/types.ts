import type { BoundingBox } from "../../core/geo.js";

/**
 * A Maritime Mobile Service Identity.
 *
 * Accepted as a string throughout the SDK even though AIS transmits it as an
 * integer: an MMSI is an identifier, not a quantity, and callers routinely hold
 * one as a nine-character string that must not lose a leading zero.
 */
export type Mmsi = string;

/** Fields carried by every AIS message this SDK surfaces. */
export type AisMessageBase = {
  /** MMSI of the transmitting station, as a string. */
  mmsi: Mmsi;
  /** Provider-reported message time, ISO-8601. */
  messageTime: string;
  /** Numeric AIS message type, e.g. 1 for a Class A position report. */
  messageType: number;
  /** Provider's own label for the message shape, preserved verbatim. */
  providerType?: string;
  /**
   * Which receiver network the provider took this message from, verbatim.
   *
   * Terrestrial and satellite reception differ in coverage and update rate, so
   * this is kept rather than dropped; the historic API exposes the same
   * distinction through `filterSatellitePositions`.
   */
  stream?: string;
};

/**
 * A vessel position report.
 *
 * Derived from AIS message types 1, 2, 3, 9, 18, 19 and 27. Latitude and
 * longitude are optional because a station can transmit a position report whose
 * coordinate fields are unavailable.
 */
export type AisPosition = AisMessageBase & {
  kind: "position";
  latitude?: number;
  longitude?: number;
  /** Degrees true, 0-359.9. */
  courseOverGround?: number;
  /** Knots. */
  speedOverGround?: number;
  /** Degrees true. */
  trueHeading?: number;
  /** Degrees per minute. */
  rateOfTurn?: number;
  /** Raw AIS navigational-status code; not normalized to text. */
  navigationalStatus?: number;
  /** `A` or `B`, when the provider states the AIS class. */
  aisClass?: string;
  /** Metres, for airborne SAR stations only. */
  altitude?: number;
};

/**
 * Static and voyage-related data for a vessel.
 *
 * Derived from AIS message types 5 and 24. `draught` is preserved in the
 * provider's own tenths-of-a-metre integer form; see {@link draughtMetres}.
 */
export type AisStaticData = AisMessageBase & {
  kind: "static";
  name?: string;
  callSign?: string;
  /** IMO number as a string, for the same reason as {@link Mmsi}. */
  imoNumber?: string;
  destination?: string;
  /** Provider-supplied ETA text; AIS transmits no year, so this is not a date. */
  eta?: string;
  /** Tenths of a metre, as transmitted. 255 means 25.5 m or greater. */
  draught?: number;
  /** Metres. */
  shipLength?: number;
  /** Metres. */
  shipWidth?: number;
  /** Raw AIS ship-type code; not normalized to text. */
  shipType?: number;
  /**
   * AIS reference-point dimensions, as transmitted.
   *
   * The four distances locate the transmitting antenna within the vessel's
   * outline. The provider publishes them under these names without stating which
   * edge each one measures to, so they are passed through under its own names
   * rather than renamed to an interpretation this SDK cannot source.
   */
  dimensionA?: number;
  dimensionB?: number;
  dimensionC?: number;
  dimensionD?: number;
  /** Raw AIS electronic position-fixing device code. */
  positionFixingDeviceType?: number;
  /** Provider's report-class label, e.g. `A`. */
  reportClass?: string;
};

/** An aid-to-navigation report, from AIS message type 21. */
export type AisAidToNavigation = AisMessageBase & {
  kind: "aid-to-navigation";
  name?: string;
  latitude?: number;
  longitude?: number;
  /** Raw AIS aid-to-navigation type code. */
  aidType?: number;
  /** Raw AIS electronic position-fixing device code for the aid. */
  electronicFixingDeviceType?: number;
  /** AIS reference-point dimensions, as transmitted; see {@link AisStaticData}. */
  dimensionA?: number;
  dimensionB?: number;
  dimensionC?: number;
  dimensionD?: number;
};

/**
 * Meteorological and hydrological data broadcast in an AIS binary message.
 *
 * From AIS message type 8. Every field the provider publishes is surfaced, because
 * a streamed message has no accompanying raw payload to fall back on.
 *
 * Values are passed through exactly as received. BarentsWatch documents no units
 * for this payload and its OpenAPI carries no field descriptions, so this SDK does
 * not state units it cannot source and performs no conversion. The payload is the
 * IMO met/hydro binary message (SN.1/Circ.289); consult that definition for the
 * unit and sentinel value of each field. `day`, `hour` and `minute` are the UTC
 * observation time as transmitted, which is not necessarily `messageTime`.
 *
 * The enumerated fields -- `airPressureTendency`, `waterLevelTrend`, `seaState`,
 * `precipitationType` and `ice` -- are the provider's own labels, preserved
 * verbatim rather than pinned to a fixed set, so a newly published member arrives
 * intact instead of failing the stream.
 */
export type AisWeatherReport = AisMessageBase & {
  kind: "weather";
  latitude?: number;
  longitude?: number;
  /** Application identifier of the binary payload. */
  functionalId?: number;
  /** Designated area code of the binary payload. */
  designatedAreaCode?: number;
  /** UTC day of observation, as transmitted. */
  day?: number;
  /** UTC hour of observation, as transmitted. */
  hour?: number;
  /** UTC minute of observation, as transmitted. */
  minute?: number;
  averageWindSpeed?: number;
  windGust?: number;
  windDirection?: number;
  windGustDirection?: number;
  airTemperature?: number;
  relativeHumidity?: number;
  dewPoint?: number;
  airPressure?: number;
  airPressureTendency?: string;
  horizontalVisibility?: number;
  waterLevel?: number;
  waterLevelTrend?: string;
  surfaceCurrentSpeed?: number;
  surfaceCurrentDirection?: number;
  /** Speed of the second measured current layer. */
  currentSpeed2?: number;
  /** Direction of the second measured current layer. */
  currentDirection2?: number;
  /** Depth of the second current measurement. */
  currentMeasuringLevel2?: number;
  /** Speed of the third measured current layer. */
  currentSpeed3?: number;
  /** Direction of the third measured current layer. */
  currentDirection3?: number;
  /** Depth of the third current measurement. */
  currentMeasuringLevel3?: number;
  significantWaveHeight?: number;
  wavePeriod?: number;
  waveDirection?: number;
  swellHeight?: number;
  swellPeriod?: number;
  swellDirection?: number;
  /** Provider's Beaufort-scale label for the sea state. */
  seaState?: string;
  waterTemperature?: number;
  /** Provider's label for the precipitation type. */
  precipitationType?: string;
  salinity?: number;
  /** Provider's label for the presence of ice. */
  ice?: string;
};

/** A safety-related broadcast, from AIS message type 12 or 14. */
export type AisSafetyMessage = AisMessageBase & {
  kind: "safety";
  text?: string;
  /** Sequence number of an addressed safety message. */
  sequenceNumber?: number;
  /**
   * MMSI this message was addressed to, for the addressed variant (type 12).
   *
   * Absent on a broadcast (type 14).
   */
  destinationMmsi?: Mmsi;
};

/**
 * A message whose provider label this SDK version does not model.
 *
 * BarentsWatch states that further AIS message types may be added. Rejecting an
 * unrecognized type would break a running stream on the day one is introduced, so
 * the fields common to every message are validated and the message is surfaced
 * under this kind instead. It is never silently dropped.
 */
export type AisUnknownMessage = AisMessageBase & {
  kind: "unknown";
};

/** Any AIS message surfaced by {@link AisClient.streamMessages}. */
export type AisMessage =
  | AisPosition
  | AisStaticData
  | AisAidToNavigation
  | AisWeatherReport
  | AisSafetyMessage
  | AisUnknownMessage;

/**
 * One point in a vessel's recorded track.
 *
 * The historic API returns a combined shape carrying the vessel's name and type
 * alongside each position, so those are kept rather than dropped.
 */
export type AisTrackPoint = {
  mmsi: Mmsi;
  messageTime: string;
  latitude?: number;
  longitude?: number;
  name?: string;
  courseOverGround?: number;
  speedOverGround?: number;
  trueHeading?: number;
  rateOfTurn?: number;
  navigationalStatus?: number;
  shipType?: number;
  /** Receiver network the point came from; see {@link AisMessageBase.stream}. */
  stream?: string;
};

/** A vessel's recorded track over a bounded window. */
export type AisTrack = {
  mmsi: Mmsi;
  /** Points as returned by the provider, oldest first. */
  points: AisTrackPoint[];
  /** Earliest `messageTime` in `points`, absent when the track is empty. */
  from?: string;
  /** Latest `messageTime` in `points`, absent when the track is empty. */
  to?: string;
};

/**
 * A vessel's latest position and latest static data, merged by the provider.
 *
 * The two arrive in different AIS messages at different times, so the position and
 * the identity each carry their own timestamp. A vessel that has transmitted a
 * position but no static data since the provider's window began has a snapshot
 * with no `name` or `callSign`.
 */
export type AisVesselSnapshot = {
  mmsi: Mmsi;
  /** Time of the position report, ISO-8601. */
  messageTime: string;
  /** Time of the static-data message, ISO-8601, when one was received. */
  staticMessageTime?: string;
  latitude?: number;
  longitude?: number;
  courseOverGround?: number;
  speedOverGround?: number;
  trueHeading?: number;
  rateOfTurn?: number;
  navigationalStatus?: number;
  name?: string;
  callSign?: string;
  imoNumber?: string;
  destination?: string;
  /** Provider-supplied ETA text; AIS transmits no year, so this is not a date. */
  eta?: string;
  /** Tenths of a metre, as transmitted. 255 means 25.5 m or greater. */
  draught?: number;
  shipLength?: number;
  shipWidth?: number;
  shipType?: number;
  /** Metres, for airborne SAR stations only. */
  altitude?: number;
  /** AIS reference-point dimensions, as transmitted; see {@link AisStaticData}. */
  dimensionA?: number;
  dimensionB?: number;
  dimensionC?: number;
  dimensionD?: number;
  /** Raw AIS electronic position-fixing device code. */
  positionFixingDeviceType?: number;
  /** Provider's report-class label, e.g. `A`. */
  reportClass?: string;
  /** Receiver network the position came from; see {@link AisMessageBase.stream}. */
  stream?: string;
};

/** Parameters for {@link AisClient.getVesselSnapshots}. */
export type AisVesselSnapshotParameters = AisFilter;

/** A vessel identity matched by an AIS name search. */
export type AisVesselMatch = {
  mmsi: Mmsi;
  name?: string;
  callSign?: string;
  imoNumber?: string;
  /** Provider-reported flag or country label, preserved verbatim. */
  country?: string;
  shipType?: number;
  courseOverGround?: number;
  heading?: number;
  /** Time of the AIS message this identity came from. */
  messageTime?: string;
};

/** Filters shared by the AIS snapshot and streaming operations. */
export type AisFilter = {
  /** Restricts results to messages inside this window. */
  boundingBox?: BoundingBox;
  /** Restricts results to these MMSIs. */
  mmsi?: readonly Mmsi[];
  /** Restricts results to these raw AIS ship-type codes. */
  shipTypes?: readonly number[];
  /** Restricts results to these provider-defined country codes. */
  countryCodes?: readonly string[];
  /** Only messages newer than this ISO-8601 instant. */
  since?: string;
};

/** Which message kinds a stream or snapshot should include. */
export type AisMessageSelection = {
  /** Position reports. Defaults to true. */
  includePosition?: boolean;
  /** Static and voyage data. Defaults to false. */
  includeStatic?: boolean;
  /** Aid-to-navigation reports. Defaults to false. */
  includeAidToNavigation?: boolean;
  /** Safety-related broadcasts. Defaults to false. */
  includeSafety?: boolean;
  /** Meteorological and hydrological broadcasts. Defaults to false. */
  includeWeather?: boolean;
};

/** Parameters for {@link AisClient.streamPositions}. */
export type AisPositionStreamParameters = AisFilter & {
  /**
   * Asks the provider to send at most one message per minute per vessel.
   * Reduces volume substantially in busy areas. Defaults to false.
   */
  downsample?: boolean;
  /** Stops the stream and releases the connection. */
  signal?: AbortSignal;
  /** Overrides the maximum characters buffered for a single record. */
  maxRecordSize?: number;
};

/** Parameters for {@link AisClient.streamMessages}. */
export type AisMessageStreamParameters = AisPositionStreamParameters & AisMessageSelection;

/** Parameters for {@link AisClient.getLatestPositions}. */
export type AisLatestPositionsParameters = AisFilter;

/** Parameters for {@link AisClient.getTrack}. */
export type AisTrackParameters = {
  mmsi: Mmsi;
  /** Start of the window, ISO-8601. */
  from: string;
  /** End of the window, ISO-8601. */
  to: string;
  /**
   * Drops satellite-sourced positions when terrestrial ones are available for the
   * same period. Defaults to the provider's own default of true.
   */
  filterSatellitePositions?: boolean;
};

/** Parameters for {@link AisClient.getMmsiInArea}. */
export type AisAreaSearchParameters = {
  boundingBox: BoundingBox;
  /** Start of the window, ISO-8601. Maximum span is seven days. */
  from: string;
  /** End of the window, ISO-8601. */
  to: string;
};

/** Parameters for {@link AisClient.searchVessels}. */
export type AisVesselSearchParameters = {
  /** Vessel name or fragment. The provider returns at most 30 matches. */
  query: string;
};

/**
 * The sea area in which BarentsWatch publishes open AIS data.
 *
 * Coordinates are GeoJSON `MultiPolygon` rings in `[longitude, latitude]` order.
 */
export type AisCoverageArea = {
  type: "MultiPolygon";
  coordinates: [number, number][][][];
};
