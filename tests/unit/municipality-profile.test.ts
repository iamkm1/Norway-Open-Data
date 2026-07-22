import warningFixture from "../fixtures/nve-warning.json" with { type: "json" };
import { describe, expect, it, vi } from "vitest";

import {
  pickLifeExpectancy,
  resolveMunicipality,
  summarizePopulation,
} from "../../src/profiles/municipality-profile.js";
import { NorwayOpenData, NotFoundError } from "../../src/index.js";
import { jsonResponse } from "./helpers.js";

const REGIONS = [
  { code: "0", label: "The whole country" },
  { code: "11", label: "Rogaland" },
  { code: "1106", label: "Haugesund" },
  { code: "1151", label: "Utsira" },
  { code: "1515", label: "Herøy (Møre og Romsdal)" },
  { code: "1818", label: "Herøy (Nordland)" },
];

function jsonStatCube(
  dimensions: Array<{ code: string; values: Array<{ code: string; label?: string }> }>,
  value: Array<number | string | null>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "2.0",
    class: "dataset",
    label: "Test cube",
    updated: "2026-06-01T05:00:00Z",
    id: dimensions.map((d) => d.code),
    size: dimensions.map((d) => d.values.length),
    dimension: Object.fromEntries(
      dimensions.map((d) => [
        d.code,
        {
          label: d.code,
          category: {
            index: d.values.map((v) => v.code),
            label: Object.fromEntries(d.values.map((v) => [v.code, v.label ?? v.code])),
          },
        },
      ]),
    ),
    value,
    ...extra,
  };
}

const metadataCube = jsonStatCube(
  [
    { code: "Region", values: REGIONS },
    { code: "Kjonn", values: [{ code: "1" }, { code: "2" }] },
    { code: "Alder", values: [{ code: "000" }, { code: "001" }] },
    { code: "ContentsCode", values: [{ code: "Personer1" }] },
    { code: "Tid", values: [{ code: "2025" }, { code: "2026" }] },
  ],
  new Array<null>(48).fill(null),
);

// Row-major over Kjonn(2) x Alder(2) x Tid(2): totals 2025=100, 2026=104.
const populationCube = jsonStatCube(
  [
    { code: "Region", values: [{ code: "1106", label: "Haugesund" }] },
    { code: "Kjonn", values: [{ code: "1" }, { code: "2" }] },
    { code: "Alder", values: [{ code: "000" }, { code: "001" }] },
    { code: "ContentsCode", values: [{ code: "Personer1" }] },
    { code: "Tid", values: [{ code: "2025" }, { code: "2026" }] },
  ],
  [10, 11, 20, 21, 30, 31, 40, 41],
);

const fhiDimensions = {
  dimensions: [
    {
      code: "GEO",
      label: "Geografi",
      categories: [
        {
          label: "Hele landet",
          value: "0",
          children: [
            {
              label: "Rogaland",
              value: "11",
              children: [{ label: "Haugesund", value: "1106", children: [] }],
            },
          ],
        },
      ],
    },
    {
      code: "AAR",
      label: "År",
      categories: [
        { label: "2017-2023", value: "2017_2023", children: [] },
        { label: "2018-2024", value: "2018_2024", children: [] },
      ],
    },
    { code: "KJONN", label: "Kjønn", categories: [{ label: "Begge", value: "0", children: [] }] },
    { code: "ALDER", label: "Alder", categories: [{ label: "Alle", value: "0", children: [] }] },
    {
      code: "UTDANN",
      label: "Utdanning",
      categories: [{ label: "Alle", value: "0", children: [] }],
    },
    {
      code: "MEASURE_TYPE",
      label: "Måltall",
      categories: [
        { label: "Forventet levealder", value: "MEIS", children: [] },
        { label: "SMR", value: "SMR", children: [] },
      ],
    },
  ],
};

const flagsExtension = {
  extension: {
    flags: {
      index: [":"],
      label: { ":": "Anonymisert eller skjult av andre årsaker" },
    },
  },
  status: "",
};

function lifeExpectancyCube(values: Array<number | string | null>): Record<string, unknown> {
  return jsonStatCube(
    [
      { code: "GEO", values: [{ code: "1106", label: "Haugesund" }] },
      { code: "AAR", values: [{ code: "2017_2023" }, { code: "2018_2024" }] },
      { code: "KJONN", values: [{ code: "0" }] },
      { code: "ALDER", values: [{ code: "0" }] },
      { code: "UTDANN", values: [{ code: "0" }] },
      { code: "MEASURE_TYPE", values: [{ code: "MEIS" }] },
    ],
    values,
    flagsExtension,
  );
}

const brregPage = {
  _embedded: { enheter: [] },
  page: { size: 1, totalElements: 7127, totalPages: 7127, number: 0 },
};

const matchingWarning = [
  {
    ...warningFixture[0],
    CountyList: [{ Id: "11", Name: "Rogaland" }],
    MunicipalityList: [{ Id: "1106", Name: "Haugesund" }],
  },
];

type Route = [fragment: string, body: unknown, status?: number];

function routedFetch(routes: Route[]): {
  fetch: typeof globalThis.fetch;
  mock: ReturnType<typeof vi.fn>;
} {
  const mock = vi.fn(async (input: unknown) => {
    const url = String(input);
    const match = routes.find(([fragment]) => url.includes(fragment));
    if (match === undefined) throw new Error(`Unexpected request: ${url}`);
    return jsonResponse(match[1], match[2] ?? 200);
  });
  return { fetch: mock as unknown as typeof globalThis.fetch, mock };
}

function defaultRoutes(): Route[] {
  return [
    ["/tables/07459/metadata", metadataCube],
    ["/tables/07459/data", populationCube],
    ["/nokkel/table/507/dimension", fhiDimensions],
    ["/nokkel/table/507/data", lifeExpectancyCube([81.1, 82.2])],
    ["kommunenummer=1106", brregPage],
    ["flood", matchingWarning],
    ["avalanche", []],
    ["landslide", []],
  ];
}

function client(routes: Route[]): NorwayOpenData {
  const { fetch } = routedFetch(routes);
  return new NorwayOpenData({ fetch, retries: 0 });
}

describe("municipality resolution helpers", () => {
  const dimension = {
    code: "Region",
    values: REGIONS.map((region) => ({ code: region.code, label: region.label })),
  };

  it("resolves codes and exact names but never counties or the whole country", () => {
    expect(resolveMunicipality(dimension, "1106")).toEqual({ code: "1106", name: "Haugesund" });
    expect(resolveMunicipality(dimension, "haugesund")).toEqual({
      code: "1106",
      name: "Haugesund",
    });
    expect(resolveMunicipality(dimension, "11")).toBeUndefined();
    expect(resolveMunicipality(dimension, "0")).toBeUndefined();
    expect(resolveMunicipality(dimension, "Rogaland")).toBeUndefined();
  });

  it("requires SSB's qualified label for duplicated municipality names", () => {
    expect(resolveMunicipality(dimension, "Herøy")).toBeUndefined();
    expect(resolveMunicipality(dimension, "Herøy (Nordland)")).toEqual({
      code: "1818",
      name: "Herøy (Nordland)",
    });
  });

  it("returns undefined population for a result with no usable rows", () => {
    expect(summarizePopulation({ tableId: "07459", dimensions: [], rows: [] })).toBeUndefined();
  });

  it("picks the newest period even when it is suppressed", () => {
    const result = pickLifeExpectancy({
      source: "nokkel",
      tableId: 507,
      dimensions: [],
      flags: { ":": "Anonymisert" },
      rows: [
        { AAR: "2017_2023", value: 81.1 },
        { AAR: "2018_2024", value: null, flag: ":" },
      ],
    });
    expect(result).toEqual({
      years: null,
      period: "2018_2024",
      measure: "MEIS",
      flag: ":",
      flagMeaning: "Anonymisert",
    });
  });
});

describe("profiles.municipality", () => {
  it("composes population, life expectancy, companies and hazards for a code", async () => {
    const response = await client(defaultRoutes()).profiles.municipality("1106");
    const profile = response.data;

    expect(profile.municipality).toEqual({ code: "1106", name: "Haugesund", countyCode: "11" });
    expect(profile.population).toEqual({
      total: 104,
      year: "2026",
      previousTotal: 100,
      previousYear: "2025",
      change: 4,
    });
    expect(profile.lifeExpectancy).toEqual({
      years: 82.2,
      period: "2018_2024",
      measure: "MEIS",
    });
    expect(profile.companies).toEqual({ registered: 7127 });
    expect(profile.hazards).toHaveLength(1);
    expect(profile.hazardMatches?.[0]).toMatchObject({
      matchBasis: "municipality-code",
      addressArea: { code: "1106", name: "Haugesund" },
    });
    expect(profile.components?.every((component) => component.status === "available")).toBe(true);
    expect(response.source.id).toBe("ssb+fhi+brreg+nve");
  });

  it("resolves an exact municipality name to the same profile", async () => {
    const response = await client(defaultRoutes()).profiles.municipality("Haugesund");
    expect(response.data.municipality.code).toBe("1106");
  });

  it("throws NotFoundError for unknown names and county codes", async () => {
    await expect(client(defaultRoutes()).profiles.municipality("Atlantis")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(client(defaultRoutes()).profiles.municipality("11")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("preserves a suppressed life expectancy with the provider's explanation", async () => {
    const routes = defaultRoutes().map((route): Route => {
      return route[0] === "/nokkel/table/507/data"
        ? ["/nokkel/table/507/data", lifeExpectancyCube([81.1, ":"])]
        : route;
    });
    const response = await client(routes).profiles.municipality("1106");
    expect(response.data.lifeExpectancy).toEqual({
      years: null,
      period: "2018_2024",
      measure: "MEIS",
      flag: ":",
      flagMeaning: "Anonymisert eller skjult av andre årsaker",
    });
  });

  it("degrades a failing section to a provider-error component", async () => {
    const routes = defaultRoutes().map((route): Route => {
      return route[0] === "kommunenummer=1106" ? ["kommunenummer=1106", {}, 500] : route;
    });
    const response = await client(routes).profiles.municipality("1106");
    expect(response.data.companies).toBeUndefined();
    expect(response.data.population).toBeDefined();
    const companiesComponent = response.data.components?.find(
      (component) => component.operation === "companies.search",
    );
    expect(companiesComponent).toMatchObject({
      status: "omitted",
      reason: "provider-error",
      error: { name: "ProviderError" },
    });
    expect(response.source.id).toBe("ssb+fhi+nve");
  });
});
