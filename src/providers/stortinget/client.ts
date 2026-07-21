import { z } from "zod";

import { createResponse, HttpClient } from "../../core/client.js";
import { InputValidationError, NotFoundError, ResponseValidationError } from "../../core/errors.js";
import { providers, responseSource } from "../../core/metadata.js";
import { paginatePages, type PaginateOptions } from "../../core/paginate.js";
import type { OpenDataResponse, RequestOptions } from "../../core/types.js";
import {
  casesResponseSchema,
  meetingsResponseSchema,
  parliamentaryCaseSchema,
  partiesResponseSchema,
  questionsResponseSchema,
  representativeListResponseSchema,
  representativeSchema,
  type RawMeetingsResponse,
  type RawParliamentaryCase,
  type RawQuestionsResponse,
  type RawRepresentative,
  type RawVotesResponse,
  votesResponseSchema,
} from "./schemas.js";
import type {
  ParliamentMeetingsParameters,
  ParliamentPartiesParameters,
  ParliamentQuestionsParameters,
  ParliamentRepresentativesParameters,
  ParliamentaryCase,
  ParliamentaryCaseSearchParameters,
  ParliamentaryCaseSearchResult,
  ParliamentaryCaseStatus,
  ParliamentaryCaseType,
  ParliamentaryMeeting,
  ParliamentaryParty,
  ParliamentaryPersonReference,
  ParliamentaryQuestion,
  ParliamentaryVote,
  Representative,
} from "./types.js";

const BASE_URL = "https://data.stortinget.no/eksport";
const PEOPLE_TTL_MS = 6 * 60 * 60 * 1_000;
const PARLIAMENTARY_DATA_TTL_MS = 15 * 60 * 1_000;
const DEFAULT_LOCAL_PAGE_SIZE = 20;
const MAX_LOCAL_PAGE_SIZE = 100;

const STORTINGET_SOURCE = responseSource(providers.stortinget);

const sessionIdSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(?:\d{2}|\d{4})$/, "Use an official Storting session identifier.");
const periodIdSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(?:\d{2}|\d{4})$/, "Use an official parliamentary period identifier.");
const personIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(50)
  .regex(/^[\p{L}\d_-]+$/u, "Invalid Storting person identifier.");
const caseIdSchema = z.union([
  z.number().int().positive(),
  z
    .string()
    .trim()
    .regex(/^[1-9]\d*$/),
]);

const representativesParametersSchema = z
  .object({
    periodId: periodIdSchema.optional(),
    includeDeputies: z.boolean().optional(),
  })
  .refine((value) => value.includeDeputies !== true || value.periodId !== undefined, {
    message: "A periodId is required when requesting all deputy representatives.",
  });

const partiesParametersSchema = z
  .object({
    sessionId: sessionIdSchema.optional(),
    periodId: periodIdSchema.optional(),
  })
  .refine((value) => value.sessionId === undefined || value.periodId === undefined, {
    message: "Specify either sessionId or periodId, not both.",
  });

const caseStatusSchema = z.enum([
  "varslet",
  "mottatt",
  "til_behandling",
  "behandlet",
  "trukket",
  "bortfalt",
  "ikke_spesifisert",
]);
const caseTypeSchema = z.enum(["budsjett", "lovsak", "alminneligsak", "ikke_spesifisert"]);
const caseSearchParametersSchema = z.object({
  query: z.string().trim().min(1).optional(),
  sessionId: sessionIdSchema.optional(),
  status: caseStatusSchema.optional(),
  type: caseTypeSchema.optional(),
  page: z.number().int().nonnegative().optional(),
  size: z.number().int().positive().max(MAX_LOCAL_PAGE_SIZE).optional(),
});

const questionStatusSchema = z.enum([
  "ikke_spesifisert",
  "besvart",
  "bortfalt",
  "til_behandling",
  "trukket",
  "venter_utsatt",
  "alle",
]);
const questionsParametersSchema = z.object({
  sessionId: sessionIdSchema.optional(),
  category: z.enum(["question-time", "interpellation", "written"]).optional(),
  status: questionStatusSchema.optional(),
});
const meetingsParametersSchema = z.object({ sessionId: sessionIdSchema.optional() });

const CASE_STATUS_BY_CODE: Readonly<Record<number, ParliamentaryCaseStatus>> = {
  0: "ikke_spesifisert",
  1: "behandlet",
  2: "til_behandling",
  3: "mottatt",
  4: "varslet",
  5: "trukket",
  6: "bortfalt",
};
const CASE_TYPE_BY_CODE: Readonly<Record<number, ParliamentaryCaseType>> = {
  0: "ikke_spesifisert",
  1: "budsjett",
  2: "alminneligsak",
  3: "lovsak",
};
const QUESTION_STATUS_BY_CODE: Readonly<Record<number, string>> = {
  0: "ikke_spesifisert",
  1: "besvart",
  2: "bortfalt",
  3: "til_behandling",
  4: "trukket",
  5: "venter_utsatt",
};
const QUESTION_TYPE_BY_CODE: Readonly<Record<number, string>> = {
  0: "ikke_spesifisert",
  1: "sporretime_sporsmal",
  2: "muntlig_sporsmal",
  3: "til_presidentskapet",
  4: "ved_motets_slutt",
  5: "skriftlig_sporsmal",
  6: "interpellasjon",
};
const CHAMBER_BY_CODE: Readonly<Record<number, string>> = {
  0: "ikke_spesifisert",
  1: "storting",
  2: "odelsting",
  3: "lagting",
};
const QUESTION_ENDPOINT_BY_CATEGORY = {
  "question-time": "sporretimesporsmal",
  interpellation: "interpellasjoner",
  written: "skriftligesporsmal",
} as const;

function invalidInput(message: string, cause: z.ZodError): InputValidationError {
  return new InputValidationError(message, { provider: "stortinget", cause });
}

function normalizedCaseId(value: string | number): string {
  const parsed = caseIdSchema.safeParse(value);
  if (!parsed.success) throw invalidInput("Invalid Storting case identifier.", parsed.error);
  return String(parsed.data);
}

/** Converts Stortinget's Microsoft JSON date representation into an ISO-8601 instant. */
export function normalizeStortingetDate(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const match = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value);
  if (match?.[1] === undefined) return undefined;
  const milliseconds = Number(match[1]);
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() <= 1) return undefined;
  return date.toISOString();
}

function trimmedString(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function normalizeRepresentative(raw: RawRepresentative): Representative {
  if (raw.id == null) {
    throw new ResponseValidationError("Stortinget returned a representative without an ID.", {
      provider: "stortinget",
    });
  }
  const firstName = trimmedString(raw.fornavn);
  const lastName = trimmedString(raw.etternavn);
  const fullName = [firstName, lastName]
    .filter((name): name is string => name !== undefined)
    .join(" ");
  if (fullName.length === 0) {
    throw new ResponseValidationError("Stortinget returned a representative without a name.", {
      provider: "stortinget",
    });
  }
  const party =
    raw.parti == null || (raw.parti.id == null && raw.parti.navn == null)
      ? undefined
      : {
          ...(raw.parti.id == null ? {} : { id: raw.parti.id }),
          ...(raw.parti.navn == null ? {} : { name: raw.parti.navn }),
        };
  return {
    id: raw.id,
    ...(firstName === undefined ? {} : { firstName }),
    ...(lastName === undefined ? {} : { lastName }),
    fullName,
    ...(party === undefined ? {} : { party }),
    ...(raw.fylke?.navn == null ? {} : { county: raw.fylke.navn }),
  };
}

function mappedValue(map: Readonly<Record<number, string>>, value: number): string {
  return map[value] ?? `unknown(${value})`;
}

function normalizeCase(raw: RawParliamentaryCase, fallbackSession?: string): ParliamentaryCase {
  const submittedAt = normalizeStortingetDate(raw.dato);
  const session = raw.sak_sesjon ?? fallbackSession;
  const committee =
    raw.komite == null || (raw.komite.id == null && raw.komite.navn == null)
      ? undefined
      : {
          ...(raw.komite.id == null ? {} : { id: raw.komite.id }),
          ...(raw.komite.navn == null ? {} : { name: raw.komite.navn }),
        };
  return {
    id: String(raw.id),
    title: raw.tittel,
    status: mappedValue(CASE_STATUS_BY_CODE, raw.status),
    type: mappedValue(CASE_TYPE_BY_CODE, raw.type),
    ...(session == null ? {} : { session }),
    ...(submittedAt === undefined ? {} : { submittedAt }),
    ...(committee === undefined ? {} : { committees: [committee] }),
  };
}

function normalizeNonnegativeCount(value: number | null | undefined): number | undefined {
  return value != null && value >= 0 ? value : undefined;
}

function normalizeVote(raw: RawVotesResponse["sak_votering_liste"][number]): ParliamentaryVote {
  const date = normalizeStortingetDate(raw.votering_tid);
  const resultText = raw.votering_resultat_type_tekst?.trim();
  const forCount = normalizeNonnegativeCount(raw.antall_for);
  const againstCount = normalizeNonnegativeCount(raw.antall_mot);
  const absentCount = normalizeNonnegativeCount(raw.antall_ikke_tilstede);
  return {
    id: String(raw.votering_id),
    caseId: String(raw.sak_id),
    ...(date === undefined ? {} : { date }),
    result:
      resultText === undefined || resultText.length === 0
        ? raw.vedtatt
          ? "vedtatt"
          : "forkastet"
        : resultText,
    ...(forCount === undefined ? {} : { forCount }),
    ...(againstCount === undefined ? {} : { againstCount }),
    ...(absentCount === undefined ? {} : { absentCount }),
  };
}

function normalizePersonReference(
  raw: RawQuestionsResponse["sporsmal_liste"][number]["sporsmal_fra"],
): ParliamentaryPersonReference | undefined {
  if (raw == null) return undefined;
  const fullName = [raw.fornavn?.trim(), raw.etternavn?.trim()].filter(Boolean).join(" ");
  if (raw.id == null && fullName.length === 0) return undefined;
  return {
    ...(raw.id == null ? {} : { id: raw.id }),
    ...(fullName.length === 0 ? {} : { fullName }),
  };
}

function normalizeQuestion(
  raw: RawQuestionsResponse["sporsmal_liste"][number],
): ParliamentaryQuestion {
  const datedAt = normalizeStortingetDate(raw.datert_dato);
  const sentAt = normalizeStortingetDate(raw.sendt_dato);
  const answeredAt = normalizeStortingetDate(raw.besvart_dato);
  const askedBy = normalizePersonReference(raw.sporsmal_fra);
  const answeredBy = normalizePersonReference(raw.besvart_av);
  return {
    id: String(raw.id),
    ...(raw.legacy_id == null ? {} : { legacyId: String(raw.legacy_id) }),
    ...(raw.sporsmal_nummer == null ? {} : { number: raw.sporsmal_nummer }),
    title: raw.tittel,
    type: mappedValue(QUESTION_TYPE_BY_CODE, raw.type),
    status: mappedValue(QUESTION_STATUS_BY_CODE, raw.status),
    session: raw.sesjon_id,
    ...(datedAt === undefined ? {} : { datedAt }),
    ...(sentAt === undefined ? {} : { sentAt }),
    ...(answeredAt === undefined ? {} : { answeredAt }),
    ...(askedBy === undefined ? {} : { askedBy }),
    ...(answeredBy === undefined ? {} : { answeredBy }),
  };
}

function normalizeMeeting(
  raw: RawMeetingsResponse["moter_liste"][number],
  session: string,
): ParliamentaryMeeting {
  const date = normalizeStortingetDate(raw.mote_dato_tid);
  const note = raw.merknad ?? raw.ikke_motedag_tekst ?? undefined;
  return {
    id: String(raw.id),
    session,
    ...(date === undefined ? {} : { date }),
    chamber: mappedValue(CHAMBER_BY_CODE, raw.mote_ting),
    ...(raw.mote_rekkefolge == null ? {} : { sequence: raw.mote_rekkefolge }),
    ...(raw.dagsorden_nummer == null ? {} : { agendaNumber: raw.dagsorden_nummer }),
    ...(raw.referat_id == null ? {} : { transcriptId: raw.referat_id }),
    ...(note === undefined ? {} : { note }),
    isMeeting: raw.id !== -1 && raw.mote_ting !== 0,
  };
}

/** Client for Stortinget's anonymous public parliamentary data exports. */
export class StortingetClient {
  readonly #http: HttpClient;

  /** @internal */
  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** Gets elected representatives for the current or a specified parliamentary period. */
  async getRepresentatives(
    parameters: ParliamentRepresentativesParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Representative[]>> {
    const parsed = representativesParametersSchema.safeParse(parameters);
    if (!parsed.success) throw invalidInput("Invalid representative parameters.", parsed.error);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/${parsed.data.periodId === undefined ? "dagensrepresentanter" : "representanter"}`,
      query: {
        format: "json",
        stortingsperiodeid: parsed.data.periodId,
        vararepresentanter:
          parsed.data.periodId === undefined ? undefined : parsed.data.includeDeputies,
      },
      schema: representativeListResponseSchema,
      transform: (data) => {
        const representatives = data.representanter_liste ?? data.dagensrepresentanter_liste;
        if (representatives === undefined) {
          throw new ResponseValidationError("Stortinget returned no representative list.", {
            provider: "stortinget",
          });
        }
        representatives.map(normalizeRepresentative);
        if (
          parsed.data.periodId !== undefined &&
          data.stortingsperiode_id != null &&
          data.stortingsperiode_id !== parsed.data.periodId
        ) {
          throw new ResponseValidationError(
            "Stortinget returned a different parliamentary period than requested.",
            { provider: "stortinget" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PEOPLE_TTL_MS,
    });
    const representatives =
      result.data.representanter_liste ?? result.data.dagensrepresentanter_liste;
    if (representatives === undefined) {
      throw new ResponseValidationError("Stortinget returned no representative list.", {
        provider: "stortinget",
      });
    }
    return createResponse(
      representatives.map(normalizeRepresentative),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets basic public person data for one representative identifier. */
  async getRepresentative(
    representativeId: string,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<Representative>> {
    const parsed = personIdSchema.safeParse(representativeId);
    if (!parsed.success) throw invalidInput("Invalid representative identifier.", parsed.error);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/person`,
      query: { format: "json", personid: parsed.data },
      schema: representativeSchema,
      transform: (data) => {
        if (data.id == null) {
          throw new NotFoundError("Stortinget representative was not found.", {
            provider: "stortinget",
          });
        }
        if (data.id !== parsed.data) {
          throw new ResponseValidationError(
            "Stortinget returned a different representative than requested.",
            { provider: "stortinget" },
          );
        }
        normalizeRepresentative(data);
        return data;
      },
      options,
      cacheTtlMs: PEOPLE_TTL_MS,
    });
    if (result.data.id == null) {
      throw new NotFoundError("Stortinget representative was not found.", {
        provider: "stortinget",
      });
    }
    return createResponse(
      normalizeRepresentative(result.data),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets parties represented in the current or a specified session/period. */
  async getParties(
    parameters: ParliamentPartiesParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryParty[]>> {
    const parsed = partiesParametersSchema.safeParse(parameters);
    if (!parsed.success) throw invalidInput("Invalid party parameters.", parsed.error);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/partier`,
      query: {
        format: "json",
        sesjonid: parsed.data.sessionId,
        stortingsperiodeid: parsed.data.periodId,
      },
      schema: partiesResponseSchema,
      options,
      cacheTtlMs: PEOPLE_TTL_MS,
    });
    return createResponse(
      result.data.partier_liste.map((party) => ({ id: party.id, name: party.navn })),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /**
   * Searches cases by fetching one official full-session export and filtering it locally.
   * Stortinget does not expose server-side case search or pagination parameters.
   */
  async searchCases(
    parameters: ParliamentaryCaseSearchParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryCaseSearchResult>> {
    const parsed = caseSearchParametersSchema.safeParse(parameters);
    if (!parsed.success) throw invalidInput("Invalid parliamentary case search.", parsed.error);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/saker`,
      query: { format: "json", sesjonid: parsed.data.sessionId },
      schema: casesResponseSchema,
      transform: (data) => {
        if (parsed.data.sessionId !== undefined && data.sesjon_id !== parsed.data.sessionId) {
          throw new ResponseValidationError(
            "Stortinget returned a different parliamentary session than requested.",
            { provider: "stortinget" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PARLIAMENTARY_DATA_TTL_MS,
    });
    const query = parsed.data.query?.toLocaleLowerCase("nb-NO");
    const filtered = result.data.saker_liste.filter((item) => {
      const normalizedStatus = mappedValue(CASE_STATUS_BY_CODE, item.status);
      const normalizedType = mappedValue(CASE_TYPE_BY_CODE, item.type);
      if (parsed.data.status !== undefined && normalizedStatus !== parsed.data.status) return false;
      if (parsed.data.type !== undefined && normalizedType !== parsed.data.type) return false;
      if (query === undefined) return true;
      return [item.tittel, item.korttittel, item.henvisning]
        .filter((value): value is string => value != null)
        .some((value) => value.toLocaleLowerCase("nb-NO").includes(query));
    });
    const page = parsed.data.page ?? 0;
    const size = parsed.data.size ?? DEFAULT_LOCAL_PAGE_SIZE;
    const start = page * size;
    const data: ParliamentaryCaseSearchResult = {
      items: filtered
        .slice(start, start + size)
        .map((item) => normalizeCase(item, result.data.sesjon_id)),
      pagination: {
        page,
        size,
        totalItems: filtered.length,
        totalPages: Math.ceil(filtered.length / size),
      },
    };
    return createResponse(data, STORTINGET_SOURCE, result.data, result.cached, options);
  }

  /**
   * Iterates every matching parliamentary case.
   *
   * Paging is local to one cached session export, so this walks the filtered
   * result set without issuing a request per page.
   */
  async *searchCasesAll(
    parameters: ParliamentaryCaseSearchParameters = {},
    options?: RequestOptions & PaginateOptions,
  ): AsyncGenerator<ParliamentaryCase, void, undefined> {
    yield* paginatePages(
      async (page) => {
        const result = await this.searchCases({ ...parameters, page }, options);
        return { items: result.data.items, totalPages: result.data.pagination.totalPages };
      },
      parameters.page ?? 0,
      options ?? {},
    );
  }

  /** Gets detailed information about one parliamentary case. */
  async getCase(
    caseId: string | number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryCase>> {
    const normalizedId = normalizedCaseId(caseId);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/sak`,
      query: { format: "json", sakid: normalizedId },
      schema: parliamentaryCaseSchema,
      transform: (data) => {
        if (String(data.id) !== normalizedId) {
          throw new ResponseValidationError(
            "Stortinget returned a different case than requested.",
            {
              provider: "stortinget",
            },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PARLIAMENTARY_DATA_TTL_MS,
    });
    return createResponse(
      normalizeCase(result.data),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets all official votes associated with one parliamentary case. */
  async getVotes(
    caseId: string | number,
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryVote[]>> {
    const normalizedId = normalizedCaseId(caseId);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/voteringer`,
      query: { format: "json", sakid: normalizedId },
      schema: votesResponseSchema,
      transform: (data) => {
        if (
          String(data.sak_id) !== normalizedId ||
          data.sak_votering_liste.some((vote) => String(vote.sak_id) !== normalizedId)
        ) {
          throw new ResponseValidationError(
            "Stortinget returned votes for a different case than requested.",
            { provider: "stortinget" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PARLIAMENTARY_DATA_TTL_MS,
    });
    return createResponse(
      result.data.sak_votering_liste.map(normalizeVote),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets a question list. Defaults to all written questions in the current session. */
  async getQuestions(
    parameters: ParliamentQuestionsParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryQuestion[]>> {
    const parsed = questionsParametersSchema.safeParse(parameters);
    if (!parsed.success)
      throw invalidInput("Invalid parliamentary question parameters.", parsed.error);
    const category = parsed.data.category ?? "written";
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/${QUESTION_ENDPOINT_BY_CATEGORY[category]}`,
      query: {
        format: "json",
        sesjonid: parsed.data.sessionId,
        status: parsed.data.status ?? "alle",
      },
      schema: questionsResponseSchema,
      transform: (data) => {
        if (parsed.data.sessionId !== undefined && data.sesjon_id !== parsed.data.sessionId) {
          throw new ResponseValidationError(
            "Stortinget returned questions for a different session than requested.",
            { provider: "stortinget" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PARLIAMENTARY_DATA_TTL_MS,
    });
    return createResponse(
      result.data.sporsmal_liste.map(normalizeQuestion),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }

  /** Gets meetings for the current or a specified parliamentary session. */
  async getMeetings(
    parameters: ParliamentMeetingsParameters = {},
    options?: RequestOptions,
  ): Promise<OpenDataResponse<ParliamentaryMeeting[]>> {
    const parsed = meetingsParametersSchema.safeParse(parameters);
    if (!parsed.success)
      throw invalidInput("Invalid parliamentary meeting parameters.", parsed.error);
    const result = await this.#http.request({
      provider: "stortinget",
      url: `${BASE_URL}/moter`,
      query: { format: "json", sesjonid: parsed.data.sessionId },
      schema: meetingsResponseSchema,
      transform: (data) => {
        if (parsed.data.sessionId !== undefined && data.sesjon_id !== parsed.data.sessionId) {
          throw new ResponseValidationError(
            "Stortinget returned meetings for a different session than requested.",
            { provider: "stortinget" },
          );
        }
        return data;
      },
      options,
      cacheTtlMs: PARLIAMENTARY_DATA_TTL_MS,
    });
    return createResponse(
      result.data.moter_liste.map((meeting) => normalizeMeeting(meeting, result.data.sesjon_id)),
      STORTINGET_SOURCE,
      result.data,
      result.cached,
      options,
    );
  }
}
