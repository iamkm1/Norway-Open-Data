import { z } from "zod";

import { createResponse, type HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { boundingBoxToPolygon, type GeoJsonPolygon, parseBoundingBox } from "../../core/geo.js";
import { responseSource } from "../../core/provider.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { barentswatchAisProvider as provider } from "./provider.js";
import {
  aisCoverageAreaSchema,
  aisMessageListSchema,
  aisMessageSchema,
  aisMmsiListSchema,
  aisTrackSchema,
  aisVesselSearchSchema,
  aisVesselSnapshotListSchema,
  type RawAisMessage,
  type RawAisTrackPoint,
  type RawAisVesselMatch,
  type RawAisVesselSnapshot,
} from "./schemas.js";
import type {
  AisAreaSearchParameters,
  AisCoverageArea,
  AisFilter,
  AisLatestPositionsParameters,
  AisMessage,
  AisMessageSelection,
  AisMessageStreamParameters,
  AisPosition,
  AisPositionStreamParameters,
  AisTrack,
  AisTrackParameters,
  AisTrackPoint,
  AisVesselMatch,
  AisVesselSearchParameters,
  AisVesselSnapshot,
  AisVesselSnapshotParameters,
  Mmsi,
} from "./types.js";

const LIVE_URL = "https://live.ais.barentswatch.no/live";
const HISTORIC_URL = "https://historic.ais.barentswatch.no/open";

/**
 * BarentsWatch retains AIS data for 14 days, and `mmsiinarea` accepts at most a
 * seven-day window. Both are enforced before the request so the caller gets a
 * specific message instead of an opaque HTTP 400.
 */
const MAX_AREA_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * An MMSI is nine digits. Values shorter than that occur in AIS for base stations
 * and other non-vessel identities, so the input rule is "digits only, up to nine"
 * rather than "exactly nine".
 */
const mmsiSchema = z
  .string()
  .trim()
  .regex(/^\d{1,9}$/, "An MMSI must be 1-9 digits.");

const isoInstantSchema = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "Expected an ISO-8601 date-time.",
  });

const filterSchema = z.object({
  mmsi: z.array(mmsiSchema).max(500).optional(),
  shipTypes: z.array(z.number().int().nonnegative()).max(100).optional(),
  countryCodes: z.array(z.string().trim().min(1).max(10)).max(100).optional(),
  since: isoInstantSchema.optional(),
});

function invalid(message: string, cause?: unknown): InputValidationError {
  return new InputValidationError(message, {
    provider: provider.id,
    ...(cause === undefined ? {} : { cause }),
  });
}

function parseMmsi(value: Mmsi): number {
  const parsed = mmsiSchema.safeParse(value);
  if (!parsed.success) {
    throw invalid(`Invalid MMSI "${value}". An MMSI must be 1-9 digits.`, parsed.error);
  }
  return Number(parsed.data);
}

/**
 * Converts a transmitted AIS draught to metres.
 *
 * AIS sends draught in tenths of a metre, and 255 means "25.5 m or greater". The
 * transmitted integer is preserved on {@link AisStaticData}
 * so the saturated value stays distinguishable; this converts it for display.
 */
export function draughtMetres(draught: number | undefined): number | undefined {
  return draught === undefined ? undefined : draught / 10;
}

/**
 * Includes a key only when the provider supplied a value.
 *
 * The SDK omits absent optional properties rather than setting them to
 * `undefined`, so a normalized record serializes without empty fields.
 */
function optional<K extends string, T>(key: K, value: T | null | undefined): Record<K, T> | object {
  return value === null || value === undefined ? {} : { [key]: value };
}

/**
 * The provider's own label for each message shape. Anything else is surfaced as
 * `unknown` rather than dropped.
 *
 * Matched case-insensitively, and keyed in lower case for that reason. The live
 * service sends `Staticdata` where the documentation writes `StaticData`, so an
 * exact-match table would classify every static-data message by the numeric
 * fallback below instead of by its label. Comparing case-insensitively accepts
 * both spellings and keeps a future casing change from silently reclassifying a
 * message as `unknown`.
 */
const MESSAGE_KINDS = {
  position: "position",
  staticdata: "static",
  aton: "aid-to-navigation",
  binarybroadcastmessagemethyd: "weather",
  safetyrelated: "safety",
} as const;

/**
 * Numeric AIS message types, used only when the provider omits its `type` label.
 *
 * The label is declared nullable upstream. Falling back to the numeric type keeps
 * a label-less position report from being surfaced as `unknown`, which would drop
 * it from {@link AisClient.streamPositions}.
 */
const POSITION_MESSAGE_TYPES = new Set([1, 2, 3, 9, 18, 19, 27]);
const STATIC_MESSAGE_TYPES = new Set([5, 24]);

function messageKind(message: RawAisMessage): AisMessage["kind"] {
  const label = message.type?.toLowerCase();
  if (label !== null && label !== undefined && label in MESSAGE_KINDS) {
    return MESSAGE_KINDS[label as keyof typeof MESSAGE_KINDS];
  }
  if (POSITION_MESSAGE_TYPES.has(message.messageType)) return "position";
  if (STATIC_MESSAGE_TYPES.has(message.messageType)) return "static";
  if (message.messageType === 21) return "aid-to-navigation";
  if (message.messageType === 8) return "weather";
  if (message.messageType === 12 || message.messageType === 14) return "safety";
  return "unknown";
}

function messageBase(message: RawAisMessage): {
  mmsi: string;
  messageTime: string;
  messageType: number;
  providerType?: string;
  stream?: string;
} {
  return {
    mmsi: String(message.mmsi),
    messageTime: message.msgtime,
    messageType: message.messageType,
    ...optional("providerType", message.type),
    ...optional("stream", message.stream),
  };
}

/** Narrows a validated record to its discriminated SDK shape. */
export function normalizeAisMessage(message: RawAisMessage): AisMessage {
  const base = messageBase(message);
  switch (messageKind(message)) {
    case "position": {
      return {
        ...base,
        kind: "position",
        ...optional("latitude", message.latitude),
        ...optional("longitude", message.longitude),
        ...optional("courseOverGround", message.courseOverGround),
        ...optional("speedOverGround", message.speedOverGround),
        ...optional("trueHeading", message.trueHeading),
        ...optional("rateOfTurn", message.rateOfTurn),
        ...optional("navigationalStatus", message.navigationalStatus),
        ...optional("aisClass", message.aisClass),
        ...optional("altitude", message.altitude),
      };
    }
    case "static": {
      return {
        ...base,
        kind: "static",
        ...optional("name", message.name),
        ...optional("callSign", message.callSign),
        ...(message.imoNumber === null || message.imoNumber === undefined
          ? {}
          : { imoNumber: String(message.imoNumber) }),
        ...optional("destination", message.destination),
        ...optional("eta", message.eta),
        ...optional("draught", message.draught),
        ...optional("shipLength", message.shipLength),
        ...optional("shipWidth", message.shipWidth),
        ...optional("shipType", message.shipType),
        ...optional("dimensionA", message.dimensionA),
        ...optional("dimensionB", message.dimensionB),
        ...optional("dimensionC", message.dimensionC),
        ...optional("dimensionD", message.dimensionD),
        ...optional("positionFixingDeviceType", message.positionFixingDeviceType),
        ...optional("reportClass", message.reportClass),
      };
    }
    case "aid-to-navigation": {
      return {
        ...base,
        kind: "aid-to-navigation",
        ...optional("name", message.name),
        ...optional("latitude", message.latitude),
        ...optional("longitude", message.longitude),
        ...optional("aidType", message.typeOfAidsToNavigation),
        ...optional("electronicFixingDeviceType", message.typeOfElectronicFixingDevice),
        ...optional("dimensionA", message.dimensionA),
        ...optional("dimensionB", message.dimensionB),
        ...optional("dimensionC", message.dimensionC),
        ...optional("dimensionD", message.dimensionD),
      };
    }
    case "weather": {
      // Every published met/hydro field is carried through: a streamed message is
      // the only copy the caller gets, so anything dropped here is lost.
      return {
        ...base,
        kind: "weather",
        ...optional("latitude", message.latitude),
        ...optional("longitude", message.longitude),
        ...optional("functionalId", message.functionalId),
        ...optional("designatedAreaCode", message.designatedAreaCode),
        ...optional("day", message.day),
        ...optional("hour", message.hour),
        ...optional("minute", message.minute),
        ...optional("averageWindSpeed", message.avgWindSpeed),
        ...optional("windGust", message.windGust),
        ...optional("windDirection", message.windDirection),
        ...optional("windGustDirection", message.windGustDirection),
        ...optional("airTemperature", message.airTemperature),
        ...optional("relativeHumidity", message.relativeHumidity),
        ...optional("dewPoint", message.dewPoint),
        ...optional("airPressure", message.airPressure),
        ...optional("airPressureTendency", message.airPressureTendency),
        ...optional("horizontalVisibility", message.horizontalVisibility),
        ...optional("waterLevel", message.waterLevel),
        ...optional("waterLevelTrend", message.waterLevelTrend),
        ...optional("surfaceCurrentSpeed", message.surfaceCurrentSpeed),
        ...optional("surfaceCurrentDirection", message.surfaceCurrentDirection),
        ...optional("currentSpeed2", message.currentSpeed2),
        ...optional("currentDirection2", message.currentDirection2),
        ...optional("currentMeasuringLevel2", message.currentMeasuringLevel2),
        ...optional("currentSpeed3", message.currentSpeed3),
        ...optional("currentDirection3", message.currentDirection3),
        ...optional("currentMeasuringLevel3", message.currentMeasuringLevel3),
        ...optional("significantWaveHeight", message.significantWaveHeight),
        ...optional("wavePeriod", message.wavePeriod),
        ...optional("waveDirection", message.waveDirection),
        ...optional("swellHeight", message.swellHeight),
        ...optional("swellPeriod", message.swellPeriod),
        ...optional("swellDirection", message.swellDirection),
        ...optional("seaState", message.seaState),
        ...optional("waterTemperature", message.waterTemperature),
        ...optional("precipitationType", message.precipitationType),
        ...optional("salinity", message.salinity),
        ...optional("ice", message.ice),
      };
    }
    case "safety": {
      return {
        ...base,
        kind: "safety",
        ...optional("text", message.safetyRelatedText),
        ...optional("sequenceNumber", message.sequenceNumber),
        ...(message.destinationMmsi === null || message.destinationMmsi === undefined
          ? {}
          : { destinationMmsi: String(message.destinationMmsi) }),
      };
    }
    default: {
      return { ...base, kind: "unknown" };
    }
  }
}

function normalizeTrackPoint(point: RawAisTrackPoint): AisTrackPoint {
  return {
    mmsi: String(point.mmsi),
    messageTime: point.msgtime,
    ...optional("latitude", point.latitude),
    ...optional("longitude", point.longitude),
    ...optional("name", point.name),
    ...optional("courseOverGround", point.courseOverGround),
    ...optional("speedOverGround", point.speedOverGround),
    ...optional("trueHeading", point.trueHeading),
    ...optional("rateOfTurn", point.rateOfTurn),
    ...optional("navigationalStatus", point.navigationalStatus),
    ...optional("shipType", point.shipType),
    ...optional("stream", point.stream),
  };
}

function normalizeTrack(mmsi: Mmsi, points: RawAisTrackPoint[]): AisTrack {
  const normalized = points.map(normalizeTrackPoint);
  // Computed from the returned points rather than the requested window: a caller
  // needs to know what the provider actually had, which can be a shorter span or
  // nothing at all.
  const times = normalized.map((point) => point.messageTime).sort();
  return {
    mmsi,
    points: normalized,
    ...optional("from", times[0]),
    ...optional("to", times.at(-1)),
  };
}

function normalizeSnapshot(snapshot: RawAisVesselSnapshot): AisVesselSnapshot {
  return {
    mmsi: String(snapshot.mmsi),
    messageTime: snapshot.msgtime,
    ...optional("staticMessageTime", snapshot.msgtimeStatic),
    ...optional("latitude", snapshot.latitude),
    ...optional("longitude", snapshot.longitude),
    ...optional("courseOverGround", snapshot.courseOverGround),
    ...optional("speedOverGround", snapshot.speedOverGround),
    ...optional("trueHeading", snapshot.trueHeading),
    ...optional("rateOfTurn", snapshot.rateOfTurn),
    ...optional("navigationalStatus", snapshot.navigationalStatus),
    ...optional("name", snapshot.name),
    ...optional("callSign", snapshot.callSign),
    ...(snapshot.imoNumber === null || snapshot.imoNumber === undefined
      ? {}
      : { imoNumber: String(snapshot.imoNumber) }),
    ...optional("destination", snapshot.destination),
    ...optional("eta", snapshot.eta),
    ...optional("draught", snapshot.draught),
    ...optional("shipLength", snapshot.shipLength),
    ...optional("shipWidth", snapshot.shipWidth),
    ...optional("shipType", snapshot.shipType),
    ...optional("altitude", snapshot.altitude),
    ...optional("dimensionA", snapshot.dimensionA),
    ...optional("dimensionB", snapshot.dimensionB),
    ...optional("dimensionC", snapshot.dimensionC),
    ...optional("dimensionD", snapshot.dimensionD),
    ...optional("positionFixingDeviceType", snapshot.positionFixingDeviceType),
    ...optional("reportClass", snapshot.reportClass),
    ...optional("stream", snapshot.stream),
  };
}

function normalizeVesselMatch(match: RawAisVesselMatch): AisVesselMatch {
  return {
    mmsi: String(match.mmsi),
    ...optional("name", match.name),
    ...optional("callSign", match.callSign),
    ...(match.imoNumber === null || match.imoNumber === undefined
      ? {}
      : { imoNumber: String(match.imoNumber) }),
    ...optional("country", match.country),
    ...optional("shipType", match.shipType),
    ...optional("courseOverGround", match.courseOverGround),
    ...optional("heading", match.heading),
    ...optional("messageTime", match.timeStamp),
  };
}

/** The provider's filter body, built from validated caller input. */
type AisFilterBody = {
  geometry?: GeoJsonPolygon;
  mmsi?: number[];
  shipTypes?: number[];
  countryCodes?: string[];
  since?: string;
  includePosition?: boolean;
  includeStatic?: boolean;
  includeAton?: boolean;
  includeSafetyRelated?: boolean;
  includeBinaryBroadcastMetHyd?: boolean;
  downsample?: boolean;
};

function buildFilterBody(filter: AisFilter, selection: AisMessageSelection): AisFilterBody {
  const parsed = filterSchema.safeParse({
    ...optional("mmsi", filter.mmsi === undefined ? undefined : [...filter.mmsi]),
    ...optional("shipTypes", filter.shipTypes === undefined ? undefined : [...filter.shipTypes]),
    ...optional(
      "countryCodes",
      filter.countryCodes === undefined ? undefined : [...filter.countryCodes],
    ),
    ...optional("since", filter.since),
  });
  if (!parsed.success) throw invalid("Invalid AIS filter.", parsed.error);

  return {
    ...(filter.boundingBox === undefined
      ? {}
      : { geometry: boundingBoxToPolygon(parseBoundingBox(filter.boundingBox, provider.id)) }),
    ...(parsed.data.mmsi === undefined ? {} : { mmsi: parsed.data.mmsi.map(Number) }),
    ...optional("shipTypes", parsed.data.shipTypes),
    ...optional("countryCodes", parsed.data.countryCodes),
    ...optional("since", parsed.data.since),
    // Sent explicitly rather than relying on the provider's defaults, so what the
    // SDK asked for is visible in the request and stable if a default changes.
    includePosition: selection.includePosition ?? true,
    includeStatic: selection.includeStatic ?? false,
    includeAton: selection.includeAidToNavigation ?? false,
    includeSafetyRelated: selection.includeSafety ?? false,
    includeBinaryBroadcastMetHyd: selection.includeWeather ?? false,
  };
}

/**
 * Client for BarentsWatch's AIS Live and AIS Historic APIs.
 *
 * Coverage is not global and not complete. BarentsWatch publishes AIS for the
 * Norwegian economic zone plus the protection zones around Svalbard and Jan
 * Mayen, excludes fishing vessels under 15 m and leisure or sailing vessels under
 * 45 m, and retains 14 days. An absent position therefore never means a vessel
 * does not exist; see {@link AisClient.getCoverageArea} for the published area.
 *
 * Data is supplied by the Norwegian Coastal Administration (Kystverket) through
 * BarentsWatch; both must be credited.
 */
export class AisClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Returns every position report the provider holds for one vessel over the last
   * 24 hours.
   *
   * An empty `points` array means the provider recorded nothing for this MMSI in
   * the window, which happens routinely for vessels below the size thresholds or
   * outside the covered area. It is not evidence that the MMSI is unassigned.
   */
  async getTrackLast24Hours(
    mmsi: Mmsi,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisTrack>> {
    const numeric = parseMmsi(mmsi);
    const result = await this.#http.request({
      provider,
      url: `${HISTORIC_URL}/v1/historic/trackslast24hours/${numeric}`,
      query: { modelFormat: "Json" },
      authenticate: true,
      schema: aisTrackSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.track,
      resourceDescription: `AIS track for MMSI ${numeric}`,
    });
    return createResponse(
      normalizeTrack(String(numeric), result.data),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns position reports for one vessel over an explicit window.
   *
   * The provider retains 14 days; older windows return nothing rather than
   * failing. Satellite positions are dropped when terrestrial ones cover the same
   * period unless `filterSatellitePositions` is set to false.
   */
  async getTrack(
    parameters: AisTrackParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisTrack>> {
    const numeric = parseMmsi(parameters.mmsi);
    const { from, to } = this.#window(parameters.from, parameters.to);
    const result = await this.#http.request({
      provider,
      url: `${HISTORIC_URL}/v1/historic/tracks/${numeric}/${encodeURIComponent(from)}/${encodeURIComponent(to)}`,
      query: {
        modelFormat: "Json",
        ...optional("filterSatellitePositions", parameters.filterSatellitePositions),
      },
      authenticate: true,
      schema: aisTrackSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.track,
      resourceDescription: `AIS track for MMSI ${numeric}`,
    });
    return createResponse(
      normalizeTrack(String(numeric), result.data),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Lists the MMSIs seen inside a window of space and time.
   *
   * The provider caps the period at seven days and the area at 500 square
   * kilometres. The period is checked here; an oversized area is rejected upstream,
   * because the SDK cannot compute the provider's own area measure reliably enough
   * to refuse a request it would have accepted.
   */
  async getMmsiInArea(
    parameters: AisAreaSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Mmsi[]>> {
    const box = parseBoundingBox(parameters.boundingBox, provider.id);
    const { from, to } = this.#window(parameters.from, parameters.to);
    if (Date.parse(to) - Date.parse(from) > MAX_AREA_WINDOW_MS) {
      throw invalid("BarentsWatch accepts an area search window of at most seven days.");
    }
    const result = await this.#http.request({
      provider,
      url: `${HISTORIC_URL}/v1/historic/mmsiinarea`,
      method: "POST",
      body: { polygon: boundingBoxToPolygon(box), msgTimeFrom: from, msgTimeTo: to },
      authenticate: true,
      schema: aisMmsiListSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.track,
      resourceDescription: "AIS area search",
    });
    return createResponse(
      result.data.map(String),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Searches recent AIS static data by vessel name.
   *
   * The provider returns at most 30 matches and searches only vessels it has seen
   * recently, so this finds vessels currently in Norwegian waters rather than
   * every vessel with that name.
   */
  async searchVessels(
    parameters: AisVesselSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisVesselMatch[]>> {
    const query = parameters.query.trim();
    if (query.length === 0) throw invalid("An AIS vessel search needs a non-empty query.");
    if (query.length > 100)
      throw invalid("An AIS vessel search query may not exceed 100 characters.");
    const result = await this.#http.request({
      provider,
      url: `${HISTORIC_URL}/v2/historic/search`,
      query: { q: query },
      authenticate: true,
      schema: aisVesselSearchSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.vesselSearch,
      resourceDescription: "AIS vessel search",
    });
    return createResponse(
      result.data.map(normalizeVesselMatch),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns the most recent position per vessel within the last 24 hours.
   *
   * A point-in-time snapshot, not a stream: use {@link AisClient.streamPositions}
   * to follow movement. Unfiltered, this covers every vessel the provider is
   * currently tracking and is a large response; supply a `boundingBox`, `mmsi`
   * list or `since` bound in normal use.
   */
  async getLatestPositions(
    parameters: AisLatestPositionsParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisPosition[]>> {
    // `downsample` is deliberately not set: the provider accepts it only on the
    // streaming filter, not on this snapshot.
    const body = buildFilterBody(parameters, { includePosition: true });
    const result = await this.#http.request({
      provider,
      url: `${LIVE_URL}/v1/latest/ais`,
      method: "POST",
      body,
      authenticate: true,
      schema: aisMessageListSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.latest,
      resourceDescription: "AIS latest positions",
    });
    const positions = result.data
      .map(normalizeAisMessage)
      .filter((message): message is AisPosition => message.kind === "position");
    return createResponse(positions, responseSource(provider), result.data, result.cached, options);
  }

  /**
   * Returns each vessel's latest position merged with its latest static data.
   *
   * This is the operation to use for vessel metadata -- name, call sign, IMO
   * number, dimensions and destination -- because it answers position and identity
   * together. {@link AisClient.getLatestPositions} returns position reports only.
   *
   * As with the position snapshot, supply a filter: unfiltered this covers every
   * vessel the provider currently tracks.
   */
  async getVesselSnapshots(
    parameters: AisVesselSnapshotParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisVesselSnapshot[]>> {
    const filter = buildFilterBody(parameters, { includePosition: true });
    const result = await this.#http.request({
      provider,
      url: `${LIVE_URL}/v1/latest/combined`,
      method: "POST",
      body: {
        ...optional("geometry", filter.geometry),
        ...optional("mmsi", filter.mmsi),
        ...optional("shipTypes", filter.shipTypes),
        ...optional("countryCodes", filter.countryCodes),
        ...optional("since", filter.since),
        // `Full` is what carries the identity fields; `Simple` would return the
        // same shape as a plain position report.
        modelType: "Full",
        modelFormat: "Json",
      },
      authenticate: true,
      schema: aisVesselSnapshotListSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.latest,
      resourceDescription: "AIS vessel snapshots",
    });
    return createResponse(
      result.data.map(normalizeSnapshot),
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Returns one vessel's latest position and identity.
   *
   * Resolves to `undefined` when the provider has nothing for this MMSI in its
   * window. That is not evidence the MMSI is unassigned; see the class
   * documentation for what the coverage excludes.
   */
  async getVesselSnapshot(
    mmsi: Mmsi,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AisVesselSnapshot | undefined>> {
    const numeric = parseMmsi(mmsi);
    const response = await this.getVesselSnapshots({ mmsi: [String(numeric)] }, options);
    return {
      ...response,
      data: response.data.find((snapshot) => snapshot.mmsi === String(numeric)),
    };
  }

  /**
   * Returns the sea area in which BarentsWatch publishes open AIS data.
   *
   * Use this to tell "no AIS data for this vessel" apart from "this location is
   * outside the published coverage area".
   */
  async getCoverageArea(options?: RequestOptions): Promise<OpenDataResponse<AisCoverageArea>> {
    const result = await this.#http.request({
      provider,
      url: `${LIVE_URL}/v1/openaisarea`,
      authenticate: true,
      schema: aisCoverageAreaSchema,
      options,
      cacheTtlMs: provider.cacheTtlMs.coverage,
      resourceDescription: "open AIS area",
    });
    return createResponse(
      { type: "MultiPolygon", coordinates: result.data.coordinates },
      responseSource(provider),
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Streams live vessel position reports until the caller stops iterating.
   *
   * ```ts
   * const controller = new AbortController();
   * for await (const position of norway.ais.streamPositions({
   *   boundingBox: { south: 58.8, west: 4.5, north: 60.0, east: 6.5 },
   *   signal: controller.signal,
   * })) {
   *   console.log(position.mmsi, position.latitude, position.longitude);
   * }
   * ```
   *
   * The connection opens on the first iteration, not when the iterator is created.
   * Leaving the loop with `break`, `return` or `throw`, or aborting `signal`,
   * closes it. There is no automatic reconnection: when the provider ends the
   * stream, iteration ends, and reopening is the caller's decision because only
   * the caller knows whether a gap in coverage is acceptable.
   *
   * Only position reports are yielded. Use {@link AisClient.streamMessages} for
   * static data, aids to navigation, safety broadcasts and weather reports.
   */
  async *streamPositions(
    parameters: AisPositionStreamParameters = {},
  ): AsyncGenerator<AisPosition, void, undefined> {
    for await (const message of this.#stream(
      { ...parameters, includePosition: true },
      "AIS position stream",
    )) {
      if (message.kind === "position") yield message;
    }
  }

  /**
   * Streams every selected AIS message kind until the caller stops iterating.
   *
   * Position reports are included unless `includePosition` is set to false. The
   * yielded union is discriminated by `kind`; a message shape this SDK version does
   * not model arrives as `kind: "unknown"` with its common fields rather than
   * being dropped or failing the stream.
   *
   * The cancellation and reconnection behaviour is the same as
   * {@link AisClient.streamPositions}.
   */
  async *streamMessages(
    parameters: AisMessageStreamParameters = {},
  ): AsyncGenerator<AisMessage, void, undefined> {
    yield* this.#stream(parameters, "AIS message stream");
  }

  async *#stream(
    parameters: AisMessageStreamParameters,
    description: string,
  ): AsyncGenerator<AisMessage, void, undefined> {
    const body: AisFilterBody = {
      ...buildFilterBody(parameters, parameters),
      downsample: parameters.downsample ?? false,
    };
    const records = this.#http.stream({
      provider,
      url: `${LIVE_URL}/v1/ais`,
      method: "POST",
      body,
      authenticate: true,
      schema: aisMessageSchema,
      rateLimitKey: "stream",
      description,
      ...(parameters.signal === undefined ? {} : { options: { signal: parameters.signal } }),
      ...optional("maxRecordSize", parameters.maxRecordSize),
    });
    for await (const record of records) yield normalizeAisMessage(record);
  }

  /** Validates a time window and returns it in the provider's expected form. */
  #window(from: string, to: string): { from: string; to: string } {
    const parsed = z
      .object({ from: isoInstantSchema, to: isoInstantSchema })
      .safeParse({ from, to });
    if (!parsed.success) throw invalid("Invalid AIS time window.", parsed.error);
    if (Date.parse(parsed.data.to) < Date.parse(parsed.data.from)) {
      throw invalid("An AIS time window must end at or after it starts.");
    }
    return parsed.data;
  }
}
