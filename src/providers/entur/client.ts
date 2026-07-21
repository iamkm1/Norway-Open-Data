import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import {
  ConfigurationError,
  InputValidationError,
  NotFoundError,
  ProviderError,
  ResponseValidationError,
} from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { DEPARTURES_QUERY, JOURNEYS_QUERY } from "./queries.js";
import {
  autocompleteResponseSchema,
  departuresResponseSchema,
  journeysResponseSchema,
  type RawAutocomplete,
  type RawDepartures,
  type RawJourneys,
} from "./schemas.js";
import type {
  AutocompleteParameters,
  AutocompletePlace,
  Departure,
  DepartureParameters,
  Journey,
  JourneyLeg,
  JourneyLocationInput,
  JourneyParameters,
  JourneyPlace,
} from "./types.js";

const GRAPHQL_URL = "https://api.entur.io/journey-planner/v3/graphql";
const GEOCODER_URL = "https://api.entur.io/geocoder/v1/autocomplete";
const AUTOCOMPLETE_TTL_MS = 5 * 60 * 1_000;
const REALTIME_TTL_MS = 20 * 1_000;

const dateTimeSchema = z.union([z.date(), z.iso.datetime({ offset: true })]).optional();

const autocompleteSchema = z
  .object({
    text: z.string().trim().min(1).max(200),
    language: z.enum(["no", "en"]).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    limit: z.number().int().positive().optional(),
  })
  .refine(
    ({ latitude, longitude }) =>
      (latitude === undefined && longitude === undefined) ||
      (latitude !== undefined && longitude !== undefined),
    "latitude and longitude must be supplied together.",
  );

const departureSchema = z.object({
  stopPlaceId: z.string().trim().min(1),
  dateTime: dateTimeSchema,
  limit: z.number().int().positive().optional(),
});

const locationSchema = z
  .object({
    placeId: z.string().trim().min(1).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
  })
  .refine(
    ({ placeId, latitude, longitude }) =>
      placeId !== undefined || (latitude !== undefined && longitude !== undefined),
    "A placeId or both latitude and longitude are required.",
  )
  .refine(
    ({ latitude, longitude }) =>
      (latitude === undefined && longitude === undefined) ||
      (latitude !== undefined && longitude !== undefined),
    "latitude and longitude must be supplied together.",
  );

const journeySchema = z.object({
  from: locationSchema,
  to: locationSchema,
  dateTime: dateTimeSchema,
  arriveBy: z.boolean().optional(),
  limit: z.number().int().positive().optional(),
});

function isoDateTime(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return new Date(value).toISOString();
}

function assertGraphQlSuccess(raw: { errors?: Array<{ message: string }> }): void {
  if (raw.errors !== undefined && raw.errors.length > 0) {
    throw new ProviderError("Entur GraphQL returned one or more query errors.", {
      provider: "entur",
      statusCode: 200,
    });
  }
}

function normalizeAutocomplete(raw: RawAutocomplete): AutocompletePlace[] {
  return raw.features.flatMap((feature) => {
    const name = feature.properties.name ?? feature.properties.label;
    if (name == null) return [];
    const [longitude, latitude] = feature.geometry?.coordinates ?? [];
    const category = feature.properties.category;
    return [
      {
        name,
        ...(feature.properties.id == null && feature.properties.gid == null
          ? {}
          : { id: feature.properties.id ?? feature.properties.gid ?? undefined }),
        ...(feature.properties.label == null ? {} : { label: feature.properties.label }),
        ...(category == null
          ? {}
          : { category: Array.isArray(category) ? category.join(",") : category }),
        ...(latitude === undefined ? {} : { latitude }),
        ...(longitude === undefined ? {} : { longitude }),
      },
    ];
  });
}

function normalizeDepartures(raw: RawDepartures): Departure[] {
  const stopPlace = raw.data?.stopPlace;
  if (stopPlace == null) {
    throw new NotFoundError("Entur stop place was not found.", {
      provider: "entur",
      statusCode: 404,
    });
  }
  return stopPlace.estimatedCalls.map((call) => {
    const line = call.serviceJourney?.journeyPattern?.line;
    return {
      stopPlaceId: stopPlace.id,
      stopName: stopPlace.name,
      ...(call.aimedDepartureTime == null ? {} : { aimedDepartureTime: call.aimedDepartureTime }),
      ...(call.expectedDepartureTime == null
        ? {}
        : { expectedDepartureTime: call.expectedDepartureTime }),
      ...(call.destinationDisplay?.frontText == null
        ? {}
        : { destinationDisplay: call.destinationDisplay.frontText }),
      ...(call.realtime == null ? {} : { realtime: call.realtime }),
      ...(call.cancellation == null ? {} : { cancelled: call.cancellation }),
      ...(line?.transportMode == null ? {} : { transportMode: line.transportMode }),
      ...(line == null
        ? {}
        : {
            line: {
              ...(line.id == null ? {} : { id: line.id }),
              ...(line.publicCode == null ? {} : { publicCode: line.publicCode }),
              ...(line.name == null ? {} : { name: line.name }),
            },
          }),
    };
  });
}

function callPlace(
  call:
    | NonNullable<
        NonNullable<RawJourneys["data"]>["trip"]
      >["tripPatterns"][number]["legs"][number]["fromEstimatedCall"]
    | undefined,
): JourneyPlace | undefined {
  if (call?.quay == null) return undefined;
  return {
    ...(call.quay.id == null ? {} : { id: call.quay.id }),
    ...(call.quay.name == null ? {} : { name: call.quay.name }),
  };
}

function normalizeLeg(
  leg: NonNullable<
    NonNullable<RawJourneys["data"]>["trip"]
  >["tripPatterns"][number]["legs"][number],
): JourneyLeg {
  const from = leg.fromEstimatedCall;
  const to = leg.toEstimatedCall;
  const line = leg.line;
  return {
    ...(leg.mode == null ? {} : { mode: leg.mode }),
    ...(leg.distance == null ? {} : { distance: leg.distance }),
    ...(callPlace(from ?? undefined) === undefined ? {} : { origin: callPlace(from ?? undefined) }),
    ...(callPlace(to ?? undefined) === undefined
      ? {}
      : { destination: callPlace(to ?? undefined) }),
    ...(from?.aimedDepartureTime == null ? {} : { scheduledStartTime: from.aimedDepartureTime }),
    ...(leg.expectedStartTime == null && from?.expectedDepartureTime == null
      ? {}
      : { expectedStartTime: leg.expectedStartTime ?? from?.expectedDepartureTime ?? undefined }),
    ...(to?.aimedArrivalTime == null ? {} : { scheduledEndTime: to.aimedArrivalTime }),
    ...(leg.expectedEndTime == null && to?.expectedArrivalTime == null
      ? {}
      : { expectedEndTime: leg.expectedEndTime ?? to?.expectedArrivalTime ?? undefined }),
    ...(from?.realtime == null && to?.realtime == null
      ? {}
      : { realtime: from?.realtime === true || to?.realtime === true }),
    ...(from?.cancellation == null && to?.cancellation == null
      ? {}
      : { cancelled: from?.cancellation === true || to?.cancellation === true }),
    ...(line == null
      ? {}
      : {
          line: {
            ...(line.id == null ? {} : { id: line.id }),
            ...(line.publicCode == null ? {} : { publicCode: line.publicCode }),
            ...(line.name == null ? {} : { name: line.name }),
            ...(line.transportMode == null ? {} : { transportMode: line.transportMode }),
          },
        }),
  };
}

function normalizeJourneys(raw: RawJourneys): Journey[] {
  const patterns = raw.data?.trip?.tripPatterns ?? [];
  return patterns.map((pattern) => {
    const legs = pattern.legs.map(normalizeLeg);
    const transitLegs = legs.filter((leg) => leg.line !== undefined);
    const transportModes = [
      ...new Set(legs.flatMap((leg) => (leg.mode === undefined ? [] : [leg.mode]))),
    ];
    return {
      ...(pattern.startTime == null && legs[0]?.expectedStartTime === undefined
        ? {}
        : { startTime: pattern.startTime ?? legs[0]?.expectedStartTime }),
      ...(pattern.endTime == null && legs.at(-1)?.expectedEndTime === undefined
        ? {}
        : { endTime: pattern.endTime ?? legs.at(-1)?.expectedEndTime }),
      ...(pattern.duration == null ? {} : { duration: pattern.duration }),
      numberOfTransfers: Math.max(0, transitLegs.length - 1),
      ...(legs[0]?.origin === undefined ? {} : { origin: legs[0].origin }),
      ...(legs.at(-1)?.destination === undefined ? {} : { destination: legs.at(-1)?.destination }),
      legs,
      transportModes,
      realtime: legs.some((leg) => leg.realtime === true),
    };
  });
}

function graphQlLocation(location: JourneyLocationInput): Record<string, unknown> {
  if (location.placeId !== undefined) return { place: location.placeId };
  return {
    coordinates: {
      latitude: location.latitude,
      longitude: location.longitude,
    },
  };
}

/** Client for Entur geocoding, departure-board, and journey-planning APIs. */
export class EnturClient {
  readonly #http: HttpClient;
  readonly #applicationName?: string;

  /** @internal */
  constructor(http: HttpClient, applicationName?: string) {
    this.#http = http;
    this.#applicationName = applicationName;
  }

  /** Autocompletes stops, addresses, and points of interest through Entur. */
  async autocomplete(
    parameters: AutocompleteParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AutocompletePlace[]>> {
    const applicationName = this.#requireApplicationName();
    const parsed = autocompleteSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Entur autocomplete parameters.", {
        provider: "entur",
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: "entur",
      url: GEOCODER_URL,
      query: {
        text: parsed.data.text,
        lang: parsed.data.language ?? "no",
        size: Math.min(parsed.data.limit ?? 10, 100),
        "focus.point.lat": parsed.data.latitude,
        "focus.point.lon": parsed.data.longitude,
      },
      headers: { "ET-Client-Name": applicationName },
      schema: autocompleteResponseSchema,
      options,
      cacheTtlMs: AUTOCOMPLETE_TTL_MS,
    });
    return createResponse(
      normalizeAutocomplete(result.data),
      responseSource(providers.entur),
      result.data,
      result.cached,
      options,
    );
  }

  /** Fetches departures from an Entur stop place. */
  async departures(
    parameters: DepartureParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Departure[]>> {
    const applicationName = this.#requireApplicationName();
    const parsed = departureSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Entur departure parameters.", {
        provider: "entur",
        cause: parsed.error,
      });
    }
    const result = await this.#http.graphql({
      provider: "entur",
      url: GRAPHQL_URL,
      queryDocument: DEPARTURES_QUERY,
      variables: {
        id: parsed.data.stopPlaceId,
        startTime: isoDateTime(parsed.data.dateTime),
        limit: Math.min(parsed.data.limit ?? 10, 50),
      },
      headers: { "ET-Client-Name": applicationName },
      schema: departuresResponseSchema,
      transform: (data) => {
        assertGraphQlSuccess(data);
        const stopPlace = data.data?.stopPlace;
        if (stopPlace === null) normalizeDepartures(data);
        if (stopPlace !== undefined && stopPlace?.id !== parsed.data.stopPlaceId) {
          throw new ResponseValidationError(
            "Entur returned a different stop place than requested.",
            {
              provider: "entur",
            },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: REALTIME_TTL_MS,
    });
    assertGraphQlSuccess(result.data);
    return createResponse(
      normalizeDepartures(result.data),
      responseSource(providers.entur),
      result.data,
      result.cached,
      options,
    );
  }

  /** Plans normalized public-transport journeys between places or coordinates. */
  async journeys(
    parameters: JourneyParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Journey[]>> {
    const applicationName = this.#requireApplicationName();
    const parsed = journeySchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Entur journey parameters.", {
        provider: "entur",
        cause: parsed.error,
      });
    }
    const result = await this.#http.graphql({
      provider: "entur",
      url: GRAPHQL_URL,
      queryDocument: JOURNEYS_QUERY,
      variables: {
        from: graphQlLocation(parsed.data.from),
        to: graphQlLocation(parsed.data.to),
        dateTime: isoDateTime(parsed.data.dateTime),
        arriveBy: parsed.data.arriveBy ?? false,
        limit: Math.min(parsed.data.limit ?? 5, 10),
      },
      headers: { "ET-Client-Name": applicationName },
      schema: journeysResponseSchema,
      transform: (data) => {
        assertGraphQlSuccess(data);
        return data;
      },
      options,
      cacheTtlMs: REALTIME_TTL_MS,
    });
    assertGraphQlSuccess(result.data);
    return createResponse(
      normalizeJourneys(result.data),
      responseSource(providers.entur),
      result.data,
      result.cached,
      options,
    );
  }

  #requireApplicationName(): string {
    if (this.#applicationName === undefined) {
      throw new ConfigurationError(
        "Entur requests require applicationName (normally company-application) for ET-Client-Name.",
        { provider: "entur" },
      );
    }
    return this.#applicationName;
  }
}
