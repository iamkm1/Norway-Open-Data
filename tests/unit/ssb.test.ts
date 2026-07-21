import ssbFixture from "../fixtures/ssb-json-stat.json" with { type: "json" };
import { describe, expect, it } from "vitest";

import { InputValidationError, NorwayOpenData, ResponseValidationError } from "../../src/index.js";
import { parseJsonStat } from "../../src/providers/ssb/json-stat.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

describe("SSB PxWeb v2", () => {
  it("flattens JSON-stat2 with last dimension varying fastest", () => {
    const result = parseJsonStat("07459", ssbFixture);
    expect(result.dimensions[0]?.values[0]).toEqual({
      code: "1106",
      label: "Haugesund",
    });
    expect(result.rows).toEqual([
      { Region: "1106", ContentsCode: "Population", Tid: "2024", value: 38000 },
      { Region: "1106", ContentsCode: "Population", Tid: "2025", value: null },
      { Region: "0301", ContentsCode: "Population", Tid: "2024", value: 710000 },
      { Region: "0301", ContentsCode: "Population", Tid: "2025", value: 720000 },
    ]);
  });

  it("fetches metadata and submits the current v2 POST body", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(ssbFixture), jsonResponse(ssbFixture));
    const result = await new NorwayOpenData({ fetch, retries: 0 }).statistics.query({
      tableId: "07459",
      language: "en",
      selections: {
        Region: ["1106"],
        ContentsCode: ["Population"],
        Tid: ["2025"],
      },
    });
    expect(result.data.rows[1]?.value).toBeNull();
    expect(mock).toHaveBeenCalledTimes(2);
    expect(mock.mock.calls[0]?.[0]).toContain("/tables/07459/metadata");
    expect(mock.mock.calls[1]?.[0]).toContain("/tables/07459/data");
    const init = mock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      selection: [
        { variableCode: "Region", valueCodes: ["1106"] },
        { variableCode: "ContentsCode", valueCodes: ["Population"] },
        { variableCode: "Tid", valueCodes: ["2025"] },
      ],
    });
  });

  it("returns the provider-native validated JSON-stat2 escape hatch", async () => {
    const { fetch } = sequenceFetch(jsonResponse(ssbFixture), jsonResponse(ssbFixture));
    const result = await new NorwayOpenData({ fetch, retries: 0 }).statistics.queryRaw({
      tableId: "07459",
      selections: { Tid: ["2025"] },
    });
    expect(result.data.version).toBe("2.0");
    expect(result.data.value).toEqual(ssbFixture.value);
  });

  it("rejects unknown dimensions and explicit values before data extraction", async () => {
    const first = sequenceFetch(jsonResponse(ssbFixture));
    await expect(
      new NorwayOpenData({ fetch: first.fetch, retries: 0 }).statistics.query({
        tableId: "07459",
        selections: { Missing: ["x"] },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);

    const second = sequenceFetch(jsonResponse(ssbFixture));
    await expect(
      new NorwayOpenData({ fetch: second.fetch, retries: 0 }).statistics.query({
        tableId: "07459",
        selections: { Region: ["9999"] },
      }),
    ).rejects.toBeInstanceOf(InputValidationError);
  });

  it("allows official PxWeb selection expressions", async () => {
    const { fetch } = sequenceFetch(jsonResponse(ssbFixture), jsonResponse(ssbFixture));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).statistics.query({
        tableId: "07459",
        selections: { Tid: ["top(1)"], Region: ["*"] },
      }),
    ).resolves.toBeDefined();
  });

  it("rejects malformed JSON-stat2 metadata and does not cache it", async () => {
    const malformed = {
      ...ssbFixture,
      dimension: {},
    };
    const { fetch, mock } = sequenceFetch(jsonResponse(malformed), jsonResponse(ssbFixture));
    const statistics = new NorwayOpenData({
      fetch,
      retries: 0,
      cache: { enabled: true },
    }).statistics;
    await expect(statistics.getTableMetadata("07459")).rejects.toBeInstanceOf(
      ResponseValidationError,
    );
    await expect(statistics.getTableMetadata("07459")).resolves.toBeDefined();
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it.each([
    { ...ssbFixture, version: "1.0" },
    { ...ssbFixture, class: "error" },
    { ...ssbFixture, id: ["Region"], size: [2], dimension: {} },
    { ...ssbFixture, value: [1] },
  ])("rejects malformed JSON-stat2 query output", async (payload) => {
    const { fetch } = sequenceFetch(jsonResponse(ssbFixture), jsonResponse(payload));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).statistics.queryRaw({
        tableId: "07459",
        selections: { Region: ["1106"] },
      }),
    ).rejects.toBeInstanceOf(ResponseValidationError);
  });
});
