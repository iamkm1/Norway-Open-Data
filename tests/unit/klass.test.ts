import {
  klassClassificationListPage,
  klassClassificationSearchPage,
  klassCountyMergeChanges,
  klassCountySplitChanges,
  klassDynamicCorrespondence,
  klassEmptyCodesAt,
  klassFixedCorrespondenceTable,
  klassMunicipalityClassification,
  klassMunicipalityCodesAt,
  klassMunicipalityCurrentCode,
  klassMunicipalityHaldenChanges,
  klassMunicipalityMergeChanges,
  klassMunicipalityNoMatchChanges,
  klassMunicipalitySplitChanges,
  klassMunicipalityVersion,
} from "../fixtures/ssb-klass.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  KlassClient,
  NorwayOpenData,
  NotFoundError,
  ProviderError,
  RateLimitError,
  RequestTimeoutError,
  ResponseValidationError,
  klassClassificationIds,
  type NorwayOpenDataConfig,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function createSdk(
  fetch: typeof globalThis.fetch,
  config: Omit<NorwayOpenDataConfig, "fetch"> = {},
): NorwayOpenData {
  return new NorwayOpenData({
    fetch,
    retries: 0,
    rateLimit: { enabled: false },
    ...config,
  });
}

function requestedUrl(mock: ReturnType<typeof vi.fn>, call = 0): URL {
  const input = mock.mock.calls[call]?.[0];
  if (input === undefined) throw new Error(`Missing fetch call ${call}.`);
  return new URL(String(input));
}

function rawCode(
  code: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    code,
    parentCode: null,
    level: "1",
    name,
    shortName: "",
    presentationName: "",
    validFrom: null,
    validTo: null,
    notes: "",
    ...overrides,
  };
}

function codes(...items: Array<Record<string, unknown>>): {
  codes: Array<Record<string, unknown>>;
} {
  return { codes: items };
}

const rangeCorrespondence = {
  correspondenceItems: klassDynamicCorrespondence.correspondenceItems.map((item) => ({
    ...item,
    validFrom: "2024-01-01",
    validTo: null,
  })),
};

describe("SSB Klass namespace", () => {
  it("constructs sdk.klass and exports stable public identifiers", () => {
    const sdk = createSdk(vi.fn() as typeof globalThis.fetch);

    expect(sdk.klass).toBeInstanceOf(KlassClient);
    expect(sdk.klass).not.toBe(sdk.statistics);
    expect(klassClassificationIds).toEqual({
      municipalities: 131,
      counties: 104,
      industry: 6,
      occupations: 7,
      education: 36,
      countriesSsb3: 91,
      countriesAlpha2: 100,
      countriesAlpha3: 552,
    });
  });

  it("lists classifications with provider paging, normalized types, and attribution", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassClassificationListPage));
    const result = await createSdk(fetch).klass.listClassifications(
      {
        language: "en",
        includeCodelists: false,
        includeDescription: true,
        changedSince: "2026-01-01T00:00:00Z",
        page: 0,
        pageSize: 2,
      },
      { includeRaw: true },
    );

    expect(result.data.items).toEqual([
      expect.objectContaining({
        id: 131,
        name: "Classification of municipalities",
        type: "classification",
        familyId: 15,
      }),
      expect.objectContaining({ id: 104, type: "classification" }),
    ]);
    expect(result.data.pagination).toEqual({
      page: 0,
      pageSize: 2,
      totalItems: 6,
      totalPages: 3,
      upstreamPaged: true,
    });
    expect(result.source).toMatchObject({
      id: "ssb-klass",
      name: expect.stringContaining("Klass"),
      license: expect.stringContaining("CC BY 4.0"),
      attribution: expect.stringContaining("Statistics Norway"),
    });
    expect(result.raw).toEqual(klassClassificationListPage);
    expect(result.cached).toBe(false);
    expect(Date.parse(result.retrievedAt)).not.toBeNaN();

    const url = requestedUrl(mock);
    expect(url.pathname).toBe("/api/klass/v1/classifications");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      language: "en",
      includeCodelists: "false",
      includeDescription: "true",
      changedSince: "2026-01-01T00:00:00Z",
      page: "0",
      size: "2",
    });
  });

  it("searches classifications without discarding language-specific hits", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassClassificationSearchPage));
    const result = await createSdk(fetch).klass.searchClassifications({
      query: "municipality & county",
      includeCodelists: true,
      ssbSection: "320",
      page: 0,
      pageSize: 20,
    });

    expect(result.data.items).toEqual([
      {
        id: 131,
        name: "Classification of municipalities",
        language: "en",
        snippet: expect.stringContaining("administrative"),
        score: 8,
      },
    ]);
    expect(result.data.pagination.upstreamPaged).toBe(true);
    const url = requestedUrl(mock);
    expect(url.pathname).toBe("/api/klass/v1/classifications/search");
    expect(url.searchParams.get("query")).toBe("municipality & county");
    expect(url.searchParams.get("ssbSection")).toBe("320");
  });

  it("gets classification details and normalizes nullable provider fields", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityClassification));
    const result = await createSdk(fetch).klass.getClassification({
      classificationId: 131,
      language: "en",
      includeFuture: true,
    });

    expect(result.data).toMatchObject({
      id: 131,
      name: "Classification of municipalities",
      primaryLanguage: "nb",
      contactPerson: { name: "Statistics Norway" },
      statisticalUnits: [],
    });
    expect(result.data.owningSection).toBeUndefined();
    expect(result.data.contactPerson?.email).toBeUndefined();
    expect(result.data.versions).toHaveLength(4);
    expect(requestedUrl(mock).searchParams.get("language")).toBe("en");
    expect(requestedUrl(mock).searchParams.get("includeFuture")).toBe("true");
  });

  it("rejects classification details for a different provider resource id", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ ...klassMunicipalityClassification, id: 104 }));

    await expect(
      createSdk(fetch).klass.getClassification({ classificationId: 131 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});

describe("SSB Klass versions and codes", () => {
  it("derives historical/current/future version status and pages locally", async () => {
    const classificationWithFuture = {
      ...klassMunicipalityClassification,
      versions: [
        ...klassMunicipalityClassification.versions,
        {
          name: "Municipalities 2099",
          id: 9999,
          validFrom: "2099-01-01",
          lastModified: "2026-01-01T00:00:00Z",
          published: ["nb", "en"],
          _links: {
            self: { href: "https://data.ssb.no/api/klass/v1/versions/9999" },
          },
        },
      ],
    };
    const { fetch } = sequenceFetch(jsonResponse(classificationWithFuture));
    const result = await createSdk(fetch).klass.listVersions({
      classificationId: 131,
      page: 0,
      pageSize: 5,
    });

    expect(result.data.items.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 1102, status: "historical" },
      { id: 1860, status: "historical" },
      { id: 1710, status: "historical" },
      { id: 3262, status: "current" },
      { id: 9999, status: "future" },
    ]);
    expect(result.data.pagination).toEqual({
      page: 0,
      pageSize: 5,
      totalItems: 5,
      totalPages: 1,
      upstreamPaged: false,
    });
  });

  it("gets version metadata without publishing its embedded unbounded code array", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityVersion));
    const result = await createSdk(fetch).klass.getVersion({
      versionId: 3262,
      language: "nn",
    });

    expect(result.data).toMatchObject({
      id: 3262,
      status: "current",
      codeCount: 3,
      levels: [{ number: 1, name: "Level 1" }],
    });
    expect(result.data.correspondenceTables).toHaveLength(2);
    expect(result.data).not.toHaveProperty("classificationItems");
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/versions/3262");
    expect(requestedUrl(mock).searchParams.get("language")).toBe("nn");
  });

  it("rejects a version response whose provider id differs from the requested id", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ ...klassMunicipalityVersion, id: 3263 }));

    await expect(createSdk(fetch).klass.getVersion({ versionId: 3262 })).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
  });

  it("lists a bounded page of codes embedded in a version", async () => {
    const { fetch } = sequenceFetch(jsonResponse(klassMunicipalityVersion));
    const result = await createSdk(fetch).klass.listCodes({
      versionId: 3262,
      level: "1",
      page: 1,
      pageSize: 2,
    });

    expect(result.data.items).toEqual([expect.objectContaining({ code: "1508", name: "Ålesund" })]);
    expect(result.data.pagination).toEqual({
      page: 1,
      pageSize: 2,
      totalItems: 3,
      totalPages: 2,
      upstreamPaged: false,
    });
  });

  it("gets one exact code from an explicit classification version", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityVersion));
    const result = await createSdk(fetch).klass.getCode({
      versionId: 3262,
      code: "1103",
      language: "en",
    });

    expect(result.data).toEqual({
      code: "1103",
      level: "1",
      name: "Stavanger",
    });
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/versions/3262");
  });

  it("lists codes at a date and preserves official query filters", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityCodesAt));
    const result = await createSdk(fetch).klass.listCodes({
      classificationId: 131,
      date: "2026-01-01",
      codes: ["0301", "1103"],
      level: "1",
      language: "en",
      includeFuture: false,
      page: 0,
      pageSize: 2,
    });

    expect(result.data.items).toHaveLength(2);
    expect(result.data.pagination).toMatchObject({
      totalItems: 2,
      totalPages: 1,
      upstreamPaged: false,
    });
    const url = requestedUrl(mock);
    expect(url.pathname).toBe("/api/klass/v1/classifications/131/codesAt");
    expect(url.searchParams.get("date")).toBe("2026-01-01");
    expect(url.searchParams.get("selectCodes")).toBe("0301,1103");
    expect(url.searchParams.get("selectLevel")).toBe("1");
    expect(url.searchParams.get("language")).toBe("en");
  });

  it("lists ranged codes and retains validity clipped to the requested range", async () => {
    const payload = {
      codes: klassMunicipalityCodesAt.codes.map((item) => ({
        ...item,
        validFromInRequestedRange: "2024-01-01",
        validToInRequestedRange: "2026-01-01",
      })),
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(payload));
    const result = await createSdk(fetch).klass.listCodes({
      classificationId: 131,
      from: "2024-01-01",
      to: "2026-01-01",
      language: "nb",
    });

    expect(result.data.items[0]).toMatchObject({
      code: "0301",
      validFromInRequestedRange: "2024-01-01",
      validToInRequestedRange: "2026-01-01",
    });
    const url = requestedUrl(mock);
    expect(url.pathname).toBe("/api/klass/v1/classifications/131/codes");
    expect(url.searchParams.get("from")).toBe("2024-01-01");
    expect(url.searchParams.get("to")).toBe("2026-01-01");
  });

  it("gets one exact code and omits empty or nullable optional values", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityCurrentCode));
    const result = await createSdk(fetch).klass.getCode({
      classificationId: 131,
      code: "0301",
      date: "2026-07-25",
      language: "en",
    });

    expect(result.data).toEqual({
      code: "0301",
      level: "1",
      name: "Oslo - Oslove",
      notes: "Oslo municipality.",
    });
    expect(requestedUrl(mock).searchParams.get("selectCodes")).toBe("0301");
  });

  it("maps an exact code miss from a validated HTTP 200 payload to NotFoundError", async () => {
    const { fetch } = sequenceFetch(jsonResponse(klassEmptyCodesAt));

    await expect(
      createSdk(fetch).klass.getCode({
        classificationId: 131,
        code: "9999",
        date: "2026-01-01",
      }),
    ).rejects.toMatchObject({
      name: "NotFoundError",
      provider: "ssb-klass",
      statusCode: undefined,
    });
  });

  it("searches by official code pattern and bounds the local result", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityCodesAt));
    const result = await createSdk(fetch).klass.searchCodes({
      classificationId: 131,
      codePattern: "1*",
      date: "2026-01-01",
      language: "nn",
      page: 1,
      pageSize: 1,
    });

    expect(result.data.items).toEqual([expect.objectContaining({ code: "1103" })]);
    expect(result.data.pagination).toEqual({
      page: 1,
      pageSize: 1,
      totalItems: 3,
      totalPages: 3,
      upstreamPaged: false,
    });
    const url = requestedUrl(mock);
    expect(url.searchParams.get("selectCodes")).toBe("1*");
    expect(url.searchParams.get("language")).toBe("nn");
  });
});

describe("SSB Klass correspondence and change tables", () => {
  it("lists bounded correspondence-table summaries from a version", async () => {
    const { fetch } = sequenceFetch(jsonResponse(klassMunicipalityVersion));
    const result = await createSdk(fetch).klass.listCorrespondenceTables({
      versionId: 3262,
      page: 1,
      pageSize: 1,
    });

    expect(result.data.items).toEqual([
      expect.objectContaining({
        id: 2800,
        sourceVersionId: 3315,
        targetVersionId: 3262,
        changeTable: false,
      }),
    ]);
    expect(result.data.pagination).toMatchObject({
      totalItems: 2,
      totalPages: 2,
      upstreamPaged: false,
    });
  });

  it("gets fixed correspondence metadata and a bounded item page", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassFixedCorrespondenceTable));
    const result = await createSdk(fetch).klass.getCorrespondenceTable({
      correspondenceTableId: 1008,
      language: "en",
      page: 1,
      pageSize: 2,
    });

    expect(result.data).toMatchObject({
      id: 1008,
      sourceVersionId: 1860,
      targetVersionId: 1102,
      changeTable: true,
      items: [
        {
          sourceCode: "1103",
          sourceName: "Stavanger",
          targetCode: "1142",
          targetName: "Rennesøy",
        },
      ],
      pagination: {
        page: 1,
        pageSize: 2,
        totalItems: 3,
        totalPages: 2,
        upstreamPaged: false,
      },
    });
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/correspondencetables/1008");
  });

  it("rejects a fixed table response for a different correspondence id", async () => {
    const { fetch } = sequenceFetch(jsonResponse({ ...klassFixedCorrespondenceTable, id: 1009 }));

    await expect(
      createSdk(fetch).klass.getCorrespondenceTable({ correspondenceTableId: 1008 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("gets fixed correspondence through the discriminated general method", async () => {
    const { fetch } = sequenceFetch(jsonResponse(klassFixedCorrespondenceTable));
    const result = await createSdk(fetch).klass.getCorrespondence({
      mode: "fixed",
      correspondenceTableId: 1008,
      pageSize: 1,
    });

    expect(result.data.mode).toBe("fixed");
    if (result.data.mode !== "fixed") throw new Error("Expected fixed correspondence.");
    expect(result.data.table.id).toBe(1008);
    expect(result.data.items).toHaveLength(1);
    expect(result.data.pagination.totalItems).toBe(3);
  });

  it("gets a dated classification correspondence with explicit inversion", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassDynamicCorrespondence));
    const result = await createSdk(fetch).klass.getCorrespondence({
      mode: "date",
      sourceClassificationId: 131,
      targetClassificationId: 104,
      date: "2026-01-01",
      language: "en",
      includeFuture: false,
      inverted: true,
      page: 0,
      pageSize: 2,
    });

    expect(result.data).toMatchObject({
      mode: "date",
      sourceClassificationId: 131,
      targetClassificationId: 104,
      date: "2026-01-01",
      inverted: true,
      items: [
        expect.objectContaining({ sourceCode: "0301", targetCode: "03" }),
        expect.objectContaining({ sourceCode: "1103", targetCode: "11" }),
      ],
      pagination: { totalItems: 3, upstreamPaged: false },
    });
    const url = requestedUrl(mock);
    expect(url.pathname).toBe("/api/klass/v1/classifications/131/correspondsAt");
    expect(url.searchParams.get("targetClassificationId")).toBe("104");
    expect(url.searchParams.get("inverted")).toBe("true");
  });

  it("gets a ranged classification correspondence and retains official validity", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(rangeCorrespondence));
    const result = await createSdk(fetch).klass.getCorrespondence({
      mode: "range",
      sourceClassificationId: 131,
      targetClassificationId: 104,
      from: "2024-01-01",
      to: "2026-01-01",
      page: 1,
      pageSize: 1,
    });

    expect(result.data).toMatchObject({
      mode: "range",
      from: "2024-01-01",
      to: "2026-01-01",
      items: [
        expect.objectContaining({
          sourceCode: "1103",
          validFrom: "2024-01-01",
        }),
      ],
    });
    expect(result.data.items[0]).not.toHaveProperty("validTo");
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/classifications/131/corresponds");
  });

  it("lists normalized code-change edges with bounded local pagination", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityMergeChanges));
    const result = await createSdk(fetch).klass.listCodeChanges({
      classificationId: 131,
      from: "2019-01-01",
      to: "2021-01-01",
      language: "en",
      page: 1,
      pageSize: 2,
    });

    expect(result.data.items).toEqual([
      {
        oldCode: "1142",
        oldName: "Rennesøy",
        newCode: "1103",
        newName: "Stavanger",
        occurredAt: "2020-01-01",
      },
    ]);
    expect(result.data.pagination).toMatchObject({
      totalItems: 3,
      totalPages: 2,
      upstreamPaged: false,
    });
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/classifications/131/changes");
  });

  it("retains creation and cessation edges without inventing the absent side", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse({
        codeChanges: [
          {
            oldCode: null,
            oldName: null,
            oldShortName: null,
            newCode: "9997",
            newName: "Created area",
            newShortName: null,
            changeOccurred: "2020-01-01",
          },
          {
            oldCode: "9998",
            oldName: "Ceased area",
            oldShortName: null,
            newCode: null,
            newName: null,
            newShortName: null,
            changeOccurred: "2020-01-01",
          },
        ],
      }),
    );
    const result = await createSdk(fetch).klass.listCodeChanges({
      classificationId: 131,
      from: "2019-01-01",
      to: "2021-01-01",
    });

    expect(result.data.items).toEqual([
      {
        newCode: "9997",
        newName: "Created area",
        occurredAt: "2020-01-01",
      },
      {
        oldCode: "9998",
        oldName: "Ceased area",
        occurredAt: "2020-01-01",
      },
    ]);
  });
});

describe("SSB Klass municipality resolution", () => {
  it("returns unchanged for a code valid on the target date without an extra changes request", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassMunicipalityCurrentCode));
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "0301",
      targetDate: "2026-01-01",
    });

    expect(result.data).toMatchObject({
      kind: "municipality",
      input: { code: "0301", targetDate: "2026-01-01" },
      status: "unchanged",
      matches: [{ code: "0301", name: "Oslo - Oslove" }],
      warnings: [],
    });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(requestedUrl(mock).pathname).toBe("/api/klass/v1/classifications/131/codesAt");
  });

  it("returns context_required rather than guessing when sourceDate is absent", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassEmptyCodesAt));
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "1142",
      targetDate: "2026-01-01",
    });

    expect(result.data.status).toBe("context_required");
    expect(result.data.matches).toEqual([]);
    expect(result.data.warnings.join(" ")).toMatch(/sourceDate|required/i);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns unchanged immediately when source and target dates are identical", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(codes(rawCode("0301", "Oslo"))));
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "0301",
      sourceDate: "2026-01-01",
      targetDate: "2026-01-01",
    });

    expect(result.data.status).toBe("unchanged");
    expect(result.data.matches).toEqual([{ code: "0301", name: "Oslo" }]);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("resolves a historical one-to-one replacement", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("0101", "Halden"))),
      jsonResponse(klassMunicipalityHaldenChanges),
      jsonResponse(codes(rawCode("3001", "Halden"))),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "0101",
      sourceDate: "2019-01-01",
      targetDate: "2020-01-01",
    });

    expect(result.data).toMatchObject({
      status: "replaced",
      sourceCode: { code: "0101", name: "Halden" },
      matches: [{ code: "3001", name: "Halden" }],
      changes: [{ oldCode: "0101", newCode: "3001", occurredAt: "2020-01-01" }],
    });
    expect(result.data.warnings.join(" ")).toMatch(/not establish.*comparable/i);
  });

  it("preserves every predecessor in an official municipality merge", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("1142", "Rennesøy"))),
      jsonResponse(klassMunicipalityMergeChanges),
      jsonResponse(codes(rawCode("1103", "Stavanger"))),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "1142",
      sourceDate: "2019-01-01",
      targetDate: "2020-01-01",
    });

    expect(result.data.status).toBe("merged");
    expect(result.data.matches.map(({ code }) => code)).toEqual(["1103"]);
    expect(result.data.predecessors.map(({ code }) => code)).toEqual(["1103", "1141", "1142"]);
    expect(result.data.successors.map(({ code }) => code)).toEqual(["1103"]);
    expect(result.data.changes).toHaveLength(3);
  });

  it("preserves every official successor in a municipality split", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("1507", "Ålesund"))),
      jsonResponse(klassMunicipalitySplitChanges),
      jsonResponse(codes(rawCode("1508", "Ålesund"), rawCode("1580", "Haram"))),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "1507",
      sourceDate: "2023-01-01",
      targetDate: "2024-01-01",
    });

    expect(result.data.status).toBe("split");
    expect(result.data.matches.map(({ code }) => code)).toEqual(["1508", "1580"]);
    expect(result.data.successors.map(({ code }) => code)).toEqual(["1508", "1580"]);
    expect(result.data.warnings).not.toEqual([]);
  });

  it("returns ambiguous for a path that crosses both merge and split events", async () => {
    const mixedChanges = {
      codeChanges: [
        ...klassMunicipalityMergeChanges.codeChanges,
        {
          oldCode: "1103",
          oldName: "Stavanger",
          oldShortName: "",
          newCode: "1200",
          newName: "North Stavanger",
          newShortName: "",
          changeOccurred: "2024-01-01",
        },
        {
          oldCode: "1103",
          oldName: "Stavanger",
          oldShortName: "",
          newCode: "1201",
          newName: "South Stavanger",
          newShortName: "",
          changeOccurred: "2024-01-01",
        },
      ],
    };
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("1142", "Rennesøy"))),
      jsonResponse(mixedChanges),
      jsonResponse(codes(rawCode("1200", "North Stavanger"), rawCode("1201", "South Stavanger"))),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "1142",
      sourceDate: "2019-01-01",
      targetDate: "2025-01-01",
    });

    expect(result.data.status).toBe("ambiguous");
    expect(result.data.matches.map(({ code }) => code)).toEqual(["1200", "1201"]);
    expect(result.data.warnings.join(" ")).toMatch(/both merge and split/i);
  });

  it("distinguishes a same-code rename from an unchanged code", async () => {
    const rename = {
      codeChanges: [
        {
          oldCode: "0301",
          oldName: "Oslo",
          oldShortName: "",
          newCode: "0301",
          newName: "Oslo kommune",
          newShortName: "",
          changeOccurred: "2025-01-01",
        },
      ],
    };
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("0301", "Oslo"))),
      jsonResponse(rename),
      jsonResponse(codes(rawCode("0301", "Oslo kommune"))),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "0301",
      sourceDate: "2024-01-01",
      targetDate: "2026-01-01",
    });

    expect(result.data.status).toBe("renamed");
    expect(result.data.matches).toEqual([{ code: "0301", name: "Oslo kommune" }]);
  });

  it("does not infer identity when no correspondence candidate is valid at the target", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("9998", "Historical area"))),
      jsonResponse(klassMunicipalityNoMatchChanges),
      jsonResponse(klassEmptyCodesAt),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "9998",
      sourceDate: "2019-01-01",
      targetDate: "2026-01-01",
    });

    expect(result.data.status).toBe("not_found");
    expect(result.data.matches).toEqual([]);
    expect(result.data.warnings.join(" ")).toMatch(/not proof/i);
  });

  it("returns not_found for an official cessation without requesting target codes", async () => {
    const cessation = {
      codeChanges: [
        {
          oldCode: "9998",
          oldName: "Ceased area",
          oldShortName: "",
          newCode: null,
          newName: null,
          newShortName: null,
          changeOccurred: "2020-01-01",
        },
      ],
    };
    const { fetch, mock } = sequenceFetch(
      jsonResponse(codes(rawCode("9998", "Ceased area"))),
      jsonResponse(cessation),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "9998",
      sourceDate: "2019-01-01",
      targetDate: "2021-01-01",
    });

    expect(result.data.status).toBe("not_found");
    expect(result.data.matches).toEqual([]);
    expect(result.data.predecessors).toEqual([{ code: "9998", name: "Ceased area" }]);
    expect(result.data.warnings.join(" ")).toMatch(/comparable.*No official match/is);
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("traverses official changes backwards without selecting one predecessor", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(codes(rawCode("1103", "Stavanger"))),
      jsonResponse(klassMunicipalityMergeChanges),
      jsonResponse(
        codes(rawCode("1103", "Stavanger"), rawCode("1141", "Finnøy"), rawCode("1142", "Rennesøy")),
      ),
    );
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "1103",
      sourceDate: "2020-01-01",
      targetDate: "2019-01-01",
      includeFuture: true,
    });

    expect(result.data.status).toBe("merged");
    expect(result.data.matches.map(({ code }) => code)).toEqual(["1103", "1141", "1142"]);
    expect(requestedUrl(mock, 0).searchParams.get("includeFuture")).toBe("true");
    expect(requestedUrl(mock, 1).searchParams.get("from")).toBe("2019-01-01");
    expect(requestedUrl(mock, 1).searchParams.get("to")).toBe("2020-01-02");
    expect(requestedUrl(mock, 2).searchParams.get("includeFuture")).toBe("true");
  });

  it("returns not_found immediately when the code is absent on its stated source date", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassEmptyCodesAt));
    const result = await createSdk(fetch).klass.resolveMunicipalityCode({
      code: "9999",
      sourceDate: "2019-01-01",
      targetDate: "2026-01-01",
    });

    expect(result.data.status).toBe("not_found");
    expect(result.data.sourceCode).toBeUndefined();
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe("SSB Klass county resolution", () => {
  it("resolves a county merge while retaining all official predecessors", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("01", "Østfold"))),
      jsonResponse(klassCountyMergeChanges),
      jsonResponse(codes(rawCode("30", "Viken"))),
    );
    const result = await createSdk(fetch).klass.resolveCountyCode({
      code: "01",
      sourceDate: "2019-01-01",
      targetDate: "2020-01-01",
    });

    expect(result.data.kind).toBe("county");
    expect(result.data.status).toBe("merged");
    expect(result.data.matches).toEqual([{ code: "30", name: "Viken" }]);
    expect(result.data.predecessors.map(({ code }) => code)).toEqual(["01", "02", "06"]);
  });

  it("returns every county created by an official split", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(codes(rawCode("30", "Viken"))),
      jsonResponse(klassCountySplitChanges),
      jsonResponse(
        codes(rawCode("31", "Østfold"), rawCode("32", "Akershus"), rawCode("33", "Buskerud")),
      ),
    );
    const result = await createSdk(fetch).klass.resolveCountyCode({
      code: "30",
      sourceDate: "2023-01-01",
      targetDate: "2024-01-01",
    });

    expect(result.data.status).toBe("split");
    expect(result.data.matches.map(({ code }) => code)).toEqual(["31", "32", "33"]);
  });
});

describe("SSB Klass validation and shared infrastructure", () => {
  it("rejects invalid inputs before network I/O", async () => {
    const mock = vi.fn(async () => jsonResponse(klassClassificationListPage));
    const klass = createSdk(mock as typeof globalThis.fetch).klass;
    const invalidCalls: Array<() => Promise<unknown>> = [
      () => klass.getClassification({ classificationId: 0 }),
      () => klass.getVersion({ versionId: -1 }),
      () => klass.getCorrespondenceTable({ correspondenceTableId: 0 }),
      () =>
        klass.listClassifications({
          language: "no" as "en",
        }),
      () => klass.listClassifications({ pageSize: 101 }),
      () => klass.listClassifications({ page: 10_001 }),
      () => klass.searchClassifications({ query: " \t " }),
      () =>
        klass.getCode({
          classificationId: 131,
          code: "1*",
          date: "2026-01-01",
        }),
      () =>
        klass.listCodes({
          classificationId: 131,
          date: "2026-01-01",
          codes: ["0301,1103"],
        }),
      () =>
        klass.listCodes({
          classificationId: 131,
          date: "2026-02-30",
        }),
      () =>
        klass.listCodes({
          classificationId: 131,
          from: "2026-01-02",
          to: "2026-01-01",
        }),
      () =>
        klass.listCodes({
          classificationId: 131,
          date: "2026-01-01",
          from: "2025-01-01",
        } as never),
      () =>
        klass.getCorrespondence({
          mode: "date",
          sourceClassificationId: 131,
          targetClassificationId: 131,
          date: "2026-01-01",
        }),
      () =>
        klass.resolveMunicipalityCode({
          code: "301",
          targetDate: "2026-01-01",
        }),
      () =>
        klass.resolveCountyCode({
          code: "001",
          targetDate: "2026-01-01",
        }),
      () =>
        klass.resolveMunicipalityCode({
          code: "0301",
        } as never),
    ];

    for (const call of invalidCalls) {
      await expect(call()).rejects.toMatchObject({
        name: "InputValidationError",
        provider: "ssb-klass",
      });
    }
    expect(mock).not.toHaveBeenCalled();
  });

  it.each([
    [400, ProviderError],
    [404, NotFoundError],
    [429, RateLimitError],
    [500, ProviderError],
  ] as const)(
    "preserves upstream HTTP %i as the appropriate provider error",
    async (status, ErrorClass) => {
      const { fetch } = sequenceFetch(
        jsonResponse(
          {
            type: "about:blank",
            title: "Provider failure",
            status,
            detail: "Official Klass error",
          },
          status,
          status === 429 ? { "Retry-After": "2" } : {},
        ),
      );
      const error = await createSdk(fetch)
        .klass.getClassification({ classificationId: 131 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ErrorClass);
      expect(error).toMatchObject({
        provider: "ssb-klass",
        statusCode: status,
      });
      if (status === 429) expect(error).toMatchObject({ retryAfter: 2 });
    },
  );

  it("does not convert an upstream validation failure into not_found", async () => {
    const { fetch } = sequenceFetch(
      jsonResponse(
        {
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "Invalid date interval",
        },
        400,
      ),
    );

    await expect(
      createSdk(fetch).klass.getCode({
        classificationId: 131,
        code: "0301",
        date: "2026-01-01",
      }),
    ).rejects.toMatchObject({
      name: "ProviderError",
      statusCode: 400,
      provider: "ssb-klass",
    });
  });

  it("rejects malformed successful payloads with strict response validation", async () => {
    const malformed = {
      ...klassClassificationListPage,
      unexpected: "not accepted",
    };
    const { fetch } = sequenceFetch(jsonResponse(malformed));

    await expect(createSdk(fetch).klass.listClassifications({ pageSize: 2 })).rejects.toMatchObject(
      {
        name: "ResponseValidationError",
        provider: "ssb-klass",
      },
    );
  });

  it("rejects internally inconsistent provider pagination", async () => {
    const malformed = {
      ...klassClassificationListPage,
      page: {
        ...klassClassificationListPage.page,
        totalPages: 99,
      },
    };
    const { fetch } = sequenceFetch(jsonResponse(malformed));

    await expect(
      createSdk(fetch).klass.listClassifications({ pageSize: 2 }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("cancels a pre-aborted Klass request before fetch", async () => {
    const mock = vi.fn(async () => jsonResponse(klassClassificationListPage));
    const controller = new AbortController();
    controller.abort();

    await expect(
      createSdk(mock as typeof globalThis.fetch).klass.listClassifications(
        {},
        { signal: controller.signal },
      ),
    ).rejects.toMatchObject({
      name: "ProviderError",
      provider: "ssb-klass",
      message: expect.stringMatching(/cancelled/i),
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it("classifies a stalled Klass request as a timeout", async () => {
    vi.useFakeTimers();
    const stalled = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    ) as typeof globalThis.fetch;
    const pending = createSdk(stalled, { timeoutMs: 10 }).klass.listClassifications();
    const assertion = expect(pending).rejects.toMatchObject({
      name: "RequestTimeoutError",
      provider: "ssb-klass",
    });

    await vi.advanceTimersByTimeAsync(10);
    await assertion;
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it("reports cache misses and hits without repeating the provider request", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(klassClassificationListPage));
    const klass = createSdk(fetch, { cache: { enabled: true } }).klass;

    await expect(klass.listClassifications({ language: "en", pageSize: 2 })).resolves.toMatchObject(
      { cached: false },
    );
    await expect(klass.listClassifications({ language: "en", pageSize: 2 })).resolves.toMatchObject(
      { cached: true },
    );
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("keeps cache entries distinct by language and query", async () => {
    const { fetch, mock } = sequenceFetch(
      jsonResponse(klassClassificationListPage),
      jsonResponse(klassClassificationListPage),
    );
    const klass = createSdk(fetch, { cache: { enabled: true } }).klass;

    await klass.listClassifications({ language: "nb", pageSize: 2 });
    await klass.listClassifications({ language: "en", pageSize: 2 });
    await expect(klass.listClassifications({ language: "nb", pageSize: 2 })).resolves.toMatchObject(
      { cached: true },
    );
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it("returns an empty bounded page rather than an unbounded payload", async () => {
    const { fetch } = sequenceFetch(jsonResponse(klassMunicipalityCodesAt));
    const result = await createSdk(fetch).klass.listCodes({
      classificationId: 131,
      date: "2026-01-01",
      page: 10,
      pageSize: 1,
    });

    expect(result.data.items).toEqual([]);
    expect(result.data.pagination).toEqual({
      page: 10,
      pageSize: 1,
      totalItems: 3,
      totalPages: 3,
      upstreamPaged: false,
    });
  });

  it("exports the distinct timeout and validation error classes used by Klass", () => {
    expect(InputValidationError).toBeTypeOf("function");
    expect(RequestTimeoutError).toBeTypeOf("function");
  });
});
