import stortingetCase from "../fixtures/stortinget-case.json" with { type: "json" };
import stortingetCases from "../fixtures/stortinget-cases.json" with { type: "json" };
import stortingetMeetings from "../fixtures/stortinget-meetings.json" with { type: "json" };
import stortingetParties from "../fixtures/stortinget-parties.json" with { type: "json" };
import stortingetQuestions from "../fixtures/stortinget-questions.json" with { type: "json" };
import stortingetRepresentative from "../fixtures/stortinget-representative.json" with { type: "json" };
import stortingetRepresentatives from "../fixtures/stortinget-representatives.json" with { type: "json" };
import stortingetVotes from "../fixtures/stortinget-votes.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import {
  InputValidationError,
  NotFoundError,
  ResponseValidationError,
} from "../../src/core/errors.js";
import {
  normalizeStortingetDate,
  StortingetClient,
} from "../../src/providers/stortinget/client.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

function makeClient(fetch: typeof globalThis.fetch, cacheEnabled = false): StortingetClient {
  return new StortingetClient(
    new HttpClient({
      timeoutMs: 1_000,
      retries: 0,
      fetch,
      cache: { enabled: cacheEnabled, maxEntries: 20 },
      credentials: { nve: {} },
    }),
  );
}

describe("StortingetClient", () => {
  it("constructs representative requests and normalizes elected representatives", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetRepresentatives));
    const response = await makeClient(fetch).getRepresentatives(
      { periodId: "2025-2029", includeDeputies: true },
      { includeRaw: true },
    );

    expect(response.data[0]).toEqual({
      id: "TESTREP1",
      firstName: "Eksempel",
      lastName: "Representant",
      fullName: "Eksempel Representant",
      party: { id: "TP", name: "Testpartiet" },
      county: "Testfylke",
    });
    expect(response.raw).toEqual({
      stortingsperiode_id: "2025-2029",
      representanter_liste: stortingetRepresentatives.representanter_liste.map(
        ({ id, fornavn, etternavn, parti, fylke }) => ({ id, fornavn, etternavn, parti, fylke }),
      ),
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/eksport/representanter");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("stortingsperiodeid")).toBe("2025-2029");
    expect(url.searchParams.get("vararepresentanter")).toBe("true");
  });

  it("gets one representative through the public person export", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetRepresentative));
    const response = await makeClient(fetch).getRepresentative(" TESTREP1 ", { includeRaw: true });

    expect(response.data).toEqual({
      id: "TESTREP1",
      firstName: "Eksempel",
      lastName: "Representant",
      fullName: "Eksempel Representant",
    });
    expect(response.raw).toEqual({
      id: "TESTREP1",
      fornavn: "Eksempel",
      etternavn: "Representant",
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/eksport/person");
    expect(url.searchParams.get("personid")).toBe("TESTREP1");
  });

  it("strips sensitive representative and question fields from normalized and raw output", async () => {
    const sensitiveMarker = "SENSITIVE-STORTINGET-MARKER";
    const representativePayload = {
      ...stortingetRepresentative,
      epostadresse: sensitiveMarker,
      foedselsdato: sensitiveMarker,
      kjoenn: sensitiveMarker,
      telefonnummer: sensitiveMarker,
      kontaktinformasjon: { epost: sensitiveMarker },
    };
    const questionPayload = {
      ...stortingetQuestions,
      sporsmal_liste: stortingetQuestions.sporsmal_liste.map((question) => ({
        ...question,
        sporsmal_fra: {
          ...question.sporsmal_fra,
          epostadresse: sensitiveMarker,
          foedselsdato: sensitiveMarker,
          kjoenn: sensitiveMarker,
        },
        besvart_av: {
          ...question.besvart_av,
          epostadresse: sensitiveMarker,
          telefonnummer: sensitiveMarker,
        },
      })),
    };
    const { fetch } = sequenceFetch(
      jsonResponse(representativePayload),
      jsonResponse(questionPayload),
    );
    const client = makeClient(fetch);

    const representative = await client.getRepresentative("TESTREP1", { includeRaw: true });
    const questions = await client.getQuestions({}, { includeRaw: true });
    const serialized = JSON.stringify({ representative, questions });

    expect(serialized).not.toContain(sensitiveMarker);
    for (const field of [
      "epostadresse",
      "foedselsdato",
      "kjoenn",
      "telefonnummer",
      "kontaktinformasjon",
    ]) {
      expect(serialized).not.toContain(field);
    }
  });

  it("does not expose sensitive provider markers through validation errors or logs", async () => {
    const sensitiveMarker = "SENSITIVE-STORTINGET-ERROR-MARKER";
    const consoleSpies = [
      vi.spyOn(console, "debug").mockImplementation(() => undefined),
      vi.spyOn(console, "error").mockImplementation(() => undefined),
      vi.spyOn(console, "info").mockImplementation(() => undefined),
      vi.spyOn(console, "log").mockImplementation(() => undefined),
      vi.spyOn(console, "warn").mockImplementation(() => undefined),
    ];

    try {
      const { fetch } = sequenceFetch(
        jsonResponse({
          id: 7,
          fornavn: "Eksempel",
          etternavn: "Representant",
          epostadresse: sensitiveMarker,
        }),
      );
      let thrown: unknown;

      try {
        await makeClient(fetch).getRepresentative("TESTREP1");
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(ResponseValidationError);
      const serializedError = JSON.stringify({
        message: thrown instanceof Error ? thrown.message : thrown,
        cause: thrown instanceof Error ? thrown.cause : undefined,
      });
      const serializedLogs = JSON.stringify(consoleSpies.flatMap((spy) => spy.mock.calls));
      expect(serializedError).not.toContain(sensitiveMarker);
      expect(serializedLogs).not.toContain(sensitiveMarker);
    } finally {
      for (const spy of consoleSpies) spy.mockRestore();
    }
  });

  it("converts Stortinget's null-person response into NotFoundError", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        id: null,
        fornavn: null,
        etternavn: null,
        foedselsdato: "/Date(-62135596800000)/",
      }),
    );
    await expect(makeClient(fetch).getRepresentative("MISSING")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("gets current or scoped parties and rejects ambiguous scope", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetParties));
    const response = await makeClient(fetch).getParties({ sessionId: "2025-2026" });

    expect(response.data).toEqual([
      { id: "A", name: "Arbeiderpartiet" },
      { id: "H", name: "Høyre" },
      { id: "FrP", name: "Fremskrittspartiet" },
    ]);
    expect(new URL(String(mock.mock.calls[0]?.[0])).searchParams.get("sesjonid")).toBe("2025-2026");

    const invalidFetch = vi.fn(async () => jsonResponse(stortingetParties));
    await expect(
      makeClient(invalidFetch as typeof globalThis.fetch).getParties({
        sessionId: "2025-2026",
        periodId: "2025-2029",
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(invalidFetch).not.toHaveBeenCalled();
  });

  it("filters and paginates a full-session case export locally", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(stortingetCases),
      jsonResponse(stortingetCases),
    );
    const client = makeClient(fetch);
    const filtered = await client.searchCases(
      { query: "bane nor", sessionId: "2025-2026", status: "mottatt" },
      { includeRaw: true },
    );

    expect(filtered.data.items).toHaveLength(1);
    expect(filtered.data.items[0]).toMatchObject({
      id: "200386",
      status: "mottatt",
      type: "alminneligsak",
      session: "2025-2026",
    });
    expect(filtered.raw).toEqual({
      sesjon_id: stortingetCases.sesjon_id,
      saker_liste: stortingetCases.saker_liste,
    });
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/eksport/saker");
    expect(url.searchParams.has("page")).toBe(false);
    expect(url.searchParams.has("size")).toBe(false);

    const secondPage = await client.searchCases({ page: 1, size: 1 });
    expect(secondPage.data.items[0]?.id).toBe("63033");
    expect(secondPage.data.pagination).toEqual({
      page: 1,
      size: 1,
      totalItems: 3,
      totalPages: 3,
    });
  });

  it("derives exact local pagination when the full export has no pagination metadata", async () => {
    const mock = vi.fn(async () => jsonResponse(stortingetCases));
    const client = makeClient(mock as typeof globalThis.fetch);

    const first = await client.searchCases({ page: 0, size: 1 });
    const middle = await client.searchCases({ page: 1, size: 1 });
    const final = await client.searchCases({ page: 2, size: 1 });
    const outOfRange = await client.searchCases({ page: 3, size: 1 });
    const empty = await client.searchCases({ query: "no-local-match", page: 0, size: 1 });

    expect(first.data.items).toHaveLength(1);
    expect(middle.data.items).toHaveLength(1);
    expect(final.data.items).toHaveLength(1);
    expect(outOfRange.data.items).toEqual([]);
    expect(empty.data.items).toEqual([]);
    expect(first.data.pagination).toEqual({ page: 0, size: 1, totalItems: 3, totalPages: 3 });
    expect(middle.data.pagination).toEqual({ page: 1, size: 1, totalItems: 3, totalPages: 3 });
    expect(final.data.pagination).toEqual({ page: 2, size: 1, totalItems: 3, totalPages: 3 });
    expect(outOfRange.data.pagination).toEqual({
      page: 3,
      size: 1,
      totalItems: 3,
      totalPages: 3,
    });
    expect(empty.data.pagination).toEqual({ page: 0, size: 1, totalItems: 0, totalPages: 0 });
    expect(mock).toHaveBeenCalledTimes(5);
  });

  it("gets and normalizes one detailed case", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetCase));
    const response = await makeClient(fetch).getCase("63033");

    expect(response.data).toEqual({
      id: "63033",
      title: "Representantforslag om endring i eierseksjonsloven",
      status: "behandlet",
      type: "alminneligsak",
      session: "2014-2015",
      committees: [{ id: "KOMMFORV", name: "Kommunal- og forvaltningskomiteen" }],
    });
    expect(new URL(String(mock.mock.calls[0]?.[0])).searchParams.get("sakid")).toBe("63033");
  });

  it("normalizes votes, dates, result text, and unavailable counts", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetVotes));
    const response = await makeClient(fetch).getVotes(63033);

    expect(response.data[0]).toEqual({
      id: "7523",
      caseId: "63033",
      date: "2016-06-07T18:35:56.977Z",
      result: "forkastet",
      forCount: 45,
      againstCount: 59,
      absentCount: 65,
    });
    expect(response.data[1]).toMatchObject({ result: "Enstemmig vedtatt" });
    expect(response.data[1]).not.toHaveProperty("forCount");
    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe("/eksport/voteringer");
  });

  it("routes question categories and normalizes the current ID/date fields", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetQuestions));
    const response = await makeClient(fetch).getQuestions({
      sessionId: "2025-2026",
      category: "interpellation",
      status: "til_behandling",
    });

    expect(response.data[0]).toMatchObject({
      id: "900001",
      legacyId: "800001",
      number: 42,
      type: "skriftlig_sporsmal",
      status: "besvart",
      session: "2025-2026",
      askedBy: { id: "TESTASK1", fullName: "Eksempel Spørrer" },
      answeredBy: { id: "TESTANS1", fullName: "Eksempel Svarperson" },
    });
    expect(response.data[0]?.sentAt).toMatch(/^2026-/);
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/eksport/interpellasjoner");
    expect(url.searchParams.get("status")).toBe("til_behandling");
  });

  it("defaults questions to the official all-written-questions export", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetQuestions));
    await makeClient(fetch).getQuestions();
    const url = new URL(String(mock.mock.calls[0]?.[0]));
    expect(url.pathname).toBe("/eksport/skriftligesporsmal");
    expect(url.searchParams.get("status")).toBe("alle");
    expect(url.searchParams.has("sesjonid")).toBe(false);
  });

  it("normalizes meetings while retaining provider-declared non-meeting days", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetMeetings));
    const response = await makeClient(fetch).getMeetings({ sessionId: "2025-2026" });

    expect(response.data[0]).toEqual({
      id: "11513",
      session: "2025-2026",
      date: "2025-10-01T11:00:00.000Z",
      chamber: "storting",
      sequence: 1,
      agendaNumber: 1,
      transcriptId: "refs-202526-10-01",
      note: "Stortingsmøte",
      isMeeting: true,
    });
    expect(response.data[1]).toMatchObject({
      id: "-1",
      chamber: "ikke_spesifisert",
      isMeeting: false,
      note: "Ingen møte denne dagen",
    });
    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe("/eksport/moter");
  });

  it("validates identifiers and pagination before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const client = makeClient(fetch as typeof globalThis.fetch);

    await expect(client.getCase("not-an-id")).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getVotes(0)).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getRepresentative("bad id")).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.searchCases({ page: -1 })).rejects.toBeInstanceOf(InputValidationError);
    await expect(client.getMeetings({ sessionId: "2025" })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed provider payloads", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ partier_liste: [{ id: "A" }] }));
    await expect(makeClient(fetch).getParties()).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("uses provider TTL caching for stable party data", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(stortingetParties));
    const client = makeClient(fetch, true);
    const first = await client.getParties();
    const second = await client.getParties();

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("does not cache semantically invalid representative responses", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse({ ...stortingetRepresentatives, stortingsperiode_id: "2021-2025" }),
      jsonResponse(stortingetRepresentatives),
    );
    const client = makeClient(fetch, true);

    await expect(client.getRepresentatives({ periodId: "2025-2029" })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    const valid = await client.getRepresentatives({ periodId: "2025-2029" });
    const cached = await client.getRepresentatives({ periodId: "2025-2029" });

    expect(valid.cached).toBe(false);
    expect(cached.cached).toBe(true);
    expect(cached.data[0]?.id).toBe("TESTREP1");
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("preserves sparse optional data and labels unknown provider enum additions", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse({
        dagensrepresentanter_liste: [
          {
            id: "ONLYLAST",
            fornavn: null,
            etternavn: "Etternavn",
            parti: { id: null, navn: "Uavhengig" },
            fylke: null,
          },
          {
            id: "ONLYFIRST",
            fornavn: "Fornavn",
            etternavn: null,
            parti: null,
            fylke: null,
          },
        ],
        stortingsperiode_id: "2025-2029",
      }),
      jsonResponse({
        id: 999,
        tittel: "Ny sakstype",
        korttittel: null,
        henvisning: null,
        status: 99,
        type: 98,
        sak_sesjon: null,
        komite: { id: null, navn: "Ny komité" },
      }),
      jsonResponse({
        sesjon_id: "2025-2026",
        sporsmal_liste: [
          {
            id: 999,
            legacy_id: null,
            sporsmal_nummer: null,
            tittel: "Nytt spørsmål",
            type: 99,
            status: 98,
            sesjon_id: "2025-2026",
            datert_dato: null,
            sendt_dato: null,
            besvart_dato: null,
            sporsmal_fra: null,
            besvart_av: { id: null, fornavn: null, etternavn: null },
          },
        ],
      }),
      jsonResponse({
        sesjon_id: "2025-2026",
        moter_liste: [
          {
            id: -1,
            mote_dato_tid: null,
            mote_ting: 99,
            mote_rekkefolge: null,
            dagsorden_nummer: null,
            referat_id: null,
            merknad: null,
            ikke_motedag_tekst: null,
          },
        ],
      }),
    );
    const client = makeClient(fetch);

    const representatives = await client.getRepresentatives();
    expect(representatives.data).toEqual([
      {
        id: "ONLYLAST",
        lastName: "Etternavn",
        fullName: "Etternavn",
        party: { name: "Uavhengig" },
      },
      { id: "ONLYFIRST", firstName: "Fornavn", fullName: "Fornavn" },
    ]);
    expect(new URL(String(mock.mock.calls[0]?.[0])).pathname).toBe("/eksport/dagensrepresentanter");
    await expect(client.getCase(999)).resolves.toMatchObject({
      data: {
        id: "999",
        status: "unknown(99)",
        type: "unknown(98)",
        committees: [{ name: "Ny komité" }],
      },
    });
    await expect(client.getQuestions()).resolves.toMatchObject({
      data: [{ id: "999", type: "unknown(99)", status: "unknown(98)" }],
    });
    await expect(client.getMeetings()).resolves.toMatchObject({
      data: [{ id: "-1", chamber: "unknown(99)", isMeeting: false }],
    });
  });

  it("rejects representative list entries that omit identity fields", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        dagensrepresentanter_liste: [{ id: null, fornavn: "Navn", etternavn: "Person" }],
      }),
      jsonResponse({
        dagensrepresentanter_liste: [{ id: "NONAME", fornavn: null, etternavn: null }],
      }),
    );
    const client = makeClient(fetch);

    await expect(client.getRepresentatives()).rejects.toBeInstanceOf(ResponseValidationError);
    await expect(client.getRepresentatives()).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("rejects malformed representative and question filters before fetch", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const client = makeClient(fetch as typeof globalThis.fetch);

    await expect(client.getRepresentatives({ periodId: "2025" })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(client.getRepresentatives({ includeDeputies: true })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(client.getQuestions({ status: "invalid" as never })).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes Microsoft dates and discards the provider's year-one sentinel", () => {
    expect(normalizeStortingetDate("/Date(1465324556977+0200)/")).toBe("2016-06-07T18:35:56.977Z");
    expect(normalizeStortingetDate("/Date(-62135596800000)/")).toBeUndefined();
    expect(normalizeStortingetDate("invalid")).toBeUndefined();
  });
});
