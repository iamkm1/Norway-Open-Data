import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { placeResponseSchema, type RawPlaceResponse } from "./schemas.js";
import type {
  NearbyPlaceParameters,
  PlaceName,
  PlaceSearchParameters,
  PlaceSearchResult,
} from "./types.js";

const BASE_URL = "https://ws.geonorge.no/stedsnavn/v1";
const PLACE_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESULTS = 500;
const MAX_RADIUS_METERS = 5_000;

const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const searchSchema = z.object({
  query: z.string().trim().min(1).max(100),
  municipalityCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  countyCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  limit: z.number().int().positive().optional(),
});

const nearbySchema = coordinateSchema.extend({
  radiusMeters: z.number().positive().optional(),
  limit: z.number().int().positive().optional(),
});

function normalizePlace(place: RawPlaceResponse["navn"][number]): PlaceName | undefined {
  const name = place.skrivemåte ?? place.stedsnavn?.[0]?.skrivemåte;
  if (name === undefined) return undefined;
  const municipality = place.kommuner?.[0];
  const county = place.fylker?.[0];
  const point = place.representasjonspunkt;
  return {
    name,
    ...(place.navneobjekttype == null ? {} : { type: place.navneobjekttype }),
    ...(municipality?.kommunenummer === undefined
      ? {}
      : { municipalityCode: municipality.kommunenummer }),
    ...(municipality?.kommunenavn === undefined
      ? {}
      : { municipalityName: municipality.kommunenavn }),
    ...(county?.fylkesnummer === undefined ? {} : { countyCode: county.fylkesnummer }),
    ...(county?.fylkesnavn === undefined ? {} : { countyName: county.fylkesnavn }),
    ...(point?.nord === undefined ? {} : { latitude: point.nord }),
    ...(point?.øst === undefined && point?.ost === undefined
      ? {}
      : { longitude: point.øst ?? point.ost }),
  };
}

function normalizePlaces(raw: RawPlaceResponse): PlaceSearchResult {
  return {
    items: raw.navn.map(normalizePlace).filter((place): place is PlaceName => place !== undefined),
    total: raw.metadata.totaltAntallTreff,
  };
}

/** Client for Kartverket's official place-name API. */
export class KartverketPlaceClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Searches official Norwegian place names. */
  async search(
    parameters: PlaceSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<PlaceSearchResult>> {
    const parsed = searchSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Kartverket place search parameters.", {
        provider: "kartverket",
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: "kartverket",
      url: `${BASE_URL}/navn`,
      query: {
        sok: parsed.data.query,
        knr: parsed.data.municipalityCode,
        fnr: parsed.data.countyCode,
        treffPerSide: Math.min(parsed.data.limit ?? 10, MAX_RESULTS),
      },
      schema: placeResponseSchema,
      options,
      cacheTtlMs: PLACE_TTL_MS,
    });
    return createResponse(
      normalizePlaces(result.data),
      responseSource(providers.kartverket),
      result.data,
      result.cached,
      options,
    );
  }

  /** Finds official place names near a WGS84 coordinate. */
  async nearby(
    parameters: NearbyPlaceParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<PlaceSearchResult>> {
    const parsed = nearbySchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Kartverket nearby-place parameters.", {
        provider: "kartverket",
        cause: parsed.error,
      });
    }
    const result = await this.#http.request({
      provider: "kartverket",
      url: `${BASE_URL}/punkt`,
      query: {
        nord: parsed.data.latitude,
        ost: parsed.data.longitude,
        koordsys: 4258,
        radius: Math.min(parsed.data.radiusMeters ?? 500, MAX_RADIUS_METERS),
        treffPerSide: Math.min(parsed.data.limit ?? 10, MAX_RESULTS),
      },
      schema: placeResponseSchema,
      options,
      cacheTtlMs: PLACE_TTL_MS,
    });
    return createResponse(
      normalizePlaces(result.data),
      responseSource(providers.kartverket),
      result.data,
      result.cached,
      options,
    );
  }
}
