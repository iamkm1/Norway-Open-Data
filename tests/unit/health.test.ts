import dimensionsFixture from "../fixtures/fhi-table-dimensions.json" with { type: "json" };
import metadataFixture from "../fixtures/fhi-table-metadata.json" with { type: "json" };
import queryFlagsFixture from "../fixtures/fhi-query-flags.json" with { type: "json" };
import sourcesFixture from "../fixtures/fhi-sources.json" with { type: "json" };
import tablesFixture from "../fixtures/fhi-tables.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { InputValidationError, NorwayOpenData, ResponseValidationError } from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

function client(...responses: Parameters<typeof sequenceFetch>): {
  norway: NorwayOpenData;
  mock: ReturnType<typeof sequenceFetch>["mock"];
} {
  const { fetch, mock } = sequenceFetch(...responses);
  return { norway: new NorwayOpenData({ fetch, retries: 0 }), mock };
}

describe("health sources and tables", () => {
  it("lists sources and drops null optional fields", async () => {
    const { norway, mock } = client(jsonResponse(sourcesFixture));
    const response = await norway.health.getSources();
    expect(mock.mock.calls[0]?.[0]).toContain("/Common/source");
    expect(response.source.id).toBe("fhi");
    expect(response.data).toHaveLength(2);
    expect(response.data[0]).toEqual({
      id: "abr",
      title: "Abortregisteret (ABR)",
      description: "Om svangerskapsbrudd i Norge fra 1979 til i dag.",
      aboutUrl: "https://www.fhi.no/op/abortregisteret",
      publishedBy: "Folkehelseinstituttet",
    });
    expect(response.data[1]).not.toHaveProperty("aboutUrl");
  });

  it("lists tables for a source and drops null timestamps", async () => {
    const { norway, mock } = client(jsonResponse(tablesFixture));
    const response = await norway.health.getTables("daar");
    expect(String(mock.mock.calls[0]?.[0])).toContain("/daar/table");
    expect(response.data[0]).toMatchObject({ tableId: 754, title: "D5c_hjertekar_rater" });
    expect(response.data[1]).not.toHaveProperty("modifiedAt");
  });

  it("rejects source ids that are not plain identifiers before any request", async () => {
    const { norway, mock } = client();
    await expect(norway.health.getTables("../enheter")).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(norway.health.getTables("a/b")).rejects.toBeInstanceOf(InputValidationError);
    expect(mock).not.toHaveBeenCalled();
  });

  it("rejects non-positive table ids before any request", async () => {
    const { norway, mock } = client();
    await expect(norway.health.getTableMetadata("daar", 0)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    await expect(norway.health.getTableMetadata("daar", 1.5)).rejects.toBeInstanceOf(
      InputValidationError,
    );
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("health table metadata and dimensions", () => {
  it("returns descriptive metadata with provider-authored paragraphs", async () => {
    const { norway } = client(jsonResponse(metadataFixture));
    const response = await norway.health.getTableMetadata("daar", 754);
    expect(response.data).toMatchObject({
      source: "daar",
      tableId: 754,
      name: "D5c_hjertekar_rater",
      isOfficialStatistics: true,
    });
    expect(response.data.paragraphs).toHaveLength(2);
    expect(response.data.paragraphs[0]?.header).toBe("Om statistikken");
  });

  it("preserves hierarchical dimension categories", async () => {
    const { norway } = client(jsonResponse(dimensionsFixture));
    const response = await norway.health.getTableDimensions("nokkel", 670);
    const geo = response.data.dimensions.find((dimension) => dimension.code === "GEO");
    expect(geo?.values[0]).toMatchObject({ code: "0", label: "Hele landet" });
    expect(geo?.values[0]?.children?.[0]).toMatchObject({ code: "34", label: "Innlandet" });
    expect(geo?.values[0]?.children?.[0]?.children?.[0]).toMatchObject({
      code: "3450",
      label: "Etnedal",
    });
    const year = response.data.dimensions.find((dimension) => dimension.code === "AAR");
    expect(year?.values[0]).not.toHaveProperty("children");
  });
});

describe("health data queries", () => {
  const selections = { GEO: ["*"], AAR: ["2022_2024"], MEASURE_TYPE: ["TELLER"] };

  it("builds the provider query body and flattens rows preserving flags", async () => {
    const { norway, mock } = client(
      jsonResponse(dimensionsFixture),
      jsonResponse(queryFlagsFixture),
    );
    const response = await norway.health.query({
      source: "nokkel",
      tableId: 670,
      selections,
      maxRowCount: 5000,
    });

    const dataCall = mock.mock.calls[1] as unknown as [string, RequestInit];
    expect(dataCall[0]).toContain("/nokkel/table/670/data");
    const body = JSON.parse(String(dataCall[1].body)) as {
      dimensions: Array<{ code: string; filter: string; values: string[] }>;
      response: { format: string; maxRowCount?: number };
    };
    expect(body.response).toEqual({ format: "json-stat2", maxRowCount: 5000 });
    expect(body.dimensions).toContainEqual({ code: "GEO", filter: "all", values: ["*"] });
    expect(body.dimensions).toContainEqual({
      code: "AAR",
      filter: "item",
      values: ["2022_2024"],
    });

    expect(response.data.title).toBe("Leseferdighet_utdann_3");
    expect(response.data.updatedAt).toBe("2026-06-01T05:00:00+00:00");
    expect(response.data.rows).toEqual([
      { GEO: "0", AAR: "2022_2024", MEASURE_TYPE: "TELLER", value: 81.4 },
      { GEO: "34", AAR: "2022_2024", MEASURE_TYPE: "TELLER", value: null },
      { GEO: "3450", AAR: "2022_2024", MEASURE_TYPE: "TELLER", value: null, flag: ":" },
    ]);
    expect(response.data.flags[":"]).toBe("Anonymisert eller skjult av andre årsaker");
  });

  it("accepts nested child category codes in selections", async () => {
    const { norway } = client(jsonResponse(dimensionsFixture), jsonResponse(queryFlagsFixture));
    await expect(
      norway.health.query({
        source: "nokkel",
        tableId: 670,
        selections: { ...selections, GEO: ["3450"] },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects unknown dimension codes and value codes", async () => {
    const first = client(jsonResponse(dimensionsFixture));
    await expect(
      first.norway.health.query({
        source: "nokkel",
        tableId: 670,
        selections: { ...selections, BOGUS: ["1"] },
      }),
    ).rejects.toMatchObject({
      name: "InputValidationError",
      message: expect.stringMatching(/no dimension "BOGUS"/) as string,
    });

    const second = client(jsonResponse(dimensionsFixture));
    await expect(
      second.norway.health.query({
        source: "nokkel",
        tableId: 670,
        selections: { ...selections, GEO: ["9999"] },
      }),
    ).rejects.toMatchObject({
      name: "InputValidationError",
      message: expect.stringMatching(/no value code "9999"/) as string,
    });
  });

  it("returns the validated raw JSON-stat2 dataset from queryRaw", async () => {
    const { norway } = client(jsonResponse(dimensionsFixture), jsonResponse(queryFlagsFixture));
    const response = await norway.health.queryRaw({ source: "nokkel", tableId: 670, selections });
    expect(response.data.value).toEqual([81.4, null, ":"]);
    expect(response.data.extension?.flags?.label?.[":"]).toBe(
      "Anonymisert eller skjult av andre årsaker",
    );
  });

  it("rejects a non-JSON-stat2 data response", async () => {
    const { norway } = client(
      jsonResponse(dimensionsFixture),
      jsonResponse({ ...queryFlagsFixture, version: "1.0" }),
    );
    await expect(
      norway.health.query({ source: "nokkel", tableId: 670, selections }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });

  it("rejects an inconsistent cube instead of mislabeling cells", async () => {
    const broken = { ...queryFlagsFixture, size: [2, 1, 1] };
    const { norway } = client(jsonResponse(dimensionsFixture), jsonResponse(broken));
    await expect(
      norway.health.query({ source: "nokkel", tableId: 670, selections }),
    ).rejects.toMatchObject({
      name: "ResponseValidationError",
      message: expect.stringMatching(/FHI JSON-stat2/) as string,
    });
  });
});
