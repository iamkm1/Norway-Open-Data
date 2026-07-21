import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import { addressResponseSchema, type RawAddressResponse } from "./schemas.js";
import type { AddressSearchParameters, AddressSearchResult, NorwegianAddress } from "./types.js";

const BASE_URL = "https://ws.geonorge.no/adresser/v1";
const ADDRESS_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RESULTS = 1_000;

const inputSchema = z.object({
  query: z.string().trim().min(1).max(200),
  municipalityCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  countyCode: z
    .string()
    .regex(/^\d{2}$/)
    .optional(),
  postalCode: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  limit: z.number().int().positive().optional(),
});

function normalizeAddress(address: RawAddressResponse["adresser"][number]): NorwegianAddress {
  const point = address.representasjonspunkt;
  const countyCode =
    address.fylkesnummer ??
    (address.kommunenummer == null ? undefined : address.kommunenummer.slice(0, 2));
  return {
    ...(address.adressetekst == null ? {} : { addressText: address.adressetekst }),
    ...(address.adressenavn == null ? {} : { streetName: address.adressenavn }),
    ...(address.nummer == null ? {} : { houseNumber: address.nummer }),
    ...(address.bokstav == null || address.bokstav === "" ? {} : { letter: address.bokstav }),
    ...(address.postnummer == null ? {} : { postalCode: address.postnummer }),
    ...(address.poststed == null ? {} : { postalPlace: address.poststed }),
    ...(address.kommunenummer == null ? {} : { municipalityCode: address.kommunenummer }),
    ...(address.kommunenavn == null ? {} : { municipalityName: address.kommunenavn }),
    ...(countyCode === undefined ? {} : { countyCode }),
    ...(address.fylkesnavn == null ? {} : { countyName: address.fylkesnavn }),
    ...(point?.lat === undefined ? {} : { latitude: point.lat }),
    ...(point?.lon === undefined ? {} : { longitude: point.lon }),
  };
}

/** Client for Kartverket's official address API. */
export class KartverketAddressClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Searches Norway's official address register. */
  async search(
    parameters: AddressSearchParameters,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<AddressSearchResult>> {
    const parsed = inputSchema.safeParse(parameters);
    if (!parsed.success) {
      throw new InputValidationError("Invalid Kartverket address search parameters.", {
        provider: "kartverket",
        cause: parsed.error,
      });
    }
    const limit = Math.min(parsed.data.limit ?? 10, MAX_RESULTS);
    const requestedCount = parsed.data.countyCode === undefined ? limit : MAX_RESULTS;
    const result = await this.#http.request({
      provider: "kartverket",
      url: `${BASE_URL}/sok`,
      query: {
        sok: parsed.data.query,
        kommunenummer: parsed.data.municipalityCode,
        postnummer: parsed.data.postalCode,
        treffPerSide: requestedCount,
      },
      schema: addressResponseSchema,
      options,
      cacheTtlMs: ADDRESS_TTL_MS,
    });
    let items = result.data.adresser.map(normalizeAddress);
    let total: number | undefined = result.data.metadata.totaltAntallTreff;
    if (parsed.data.countyCode !== undefined) {
      const filtered = items.filter((item) => item.countyCode === parsed.data.countyCode);
      total = result.data.metadata.totaltAntallTreff <= MAX_RESULTS ? filtered.length : undefined;
      items = filtered.slice(0, limit);
    }
    return createResponse(
      {
        items,
        ...(total === undefined ? {} : { total }),
      },
      responseSource(providers.kartverket),
      result.data,
      result.cached,
      options,
    );
  }
}
