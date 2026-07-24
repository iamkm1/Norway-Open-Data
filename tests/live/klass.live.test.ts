import { describe, expect, it } from "vitest";

import { NorwayOpenData, klassClassificationIds } from "../../src/index.js";

const enabled = process.env["RUN_LIVE_TESTS"] === "true";
const live = enabled ? describe.sequential : describe.skip;

const sdk = new NorwayOpenData({
  retries: 1,
  timeoutMs: 20_000,
  cache: { enabled: true, maxEntries: 32 },
});

function expectKlassSource(response: { source: { id: string; attribution?: string } }): void {
  expect(response.source.id).toBe("ssb-klass");
  expect(response.source.attribution).toContain("Statistics Norway (SSB)");
  expect(response.source.attribution).toContain("CC BY 4.0");
}

live("SSB Klass — bounded official API smoke tests", () => {
  it("discovers the documented classifications with upstream pagination", async () => {
    const first = await sdk.klass.listClassifications({
      language: "en",
      page: 0,
      pageSize: 100,
    });
    const second = await sdk.klass.listClassifications({
      language: "en",
      page: 1,
      pageSize: 100,
    });

    expectKlassSource(first);
    expectKlassSource(second);
    expect(first.data.pagination.upstreamPaged).toBe(true);
    expect(second.data.pagination.upstreamPaged).toBe(true);
    expect(first.data.items.length).toBeLessThanOrEqual(100);
    expect(second.data.items.length).toBeLessThanOrEqual(100);

    const discoveredIds = new Set([...first.data.items, ...second.data.items].map(({ id }) => id));
    expect([...discoveredIds]).toEqual(
      expect.arrayContaining([
        klassClassificationIds.municipalities,
        klassClassificationIds.counties,
        klassClassificationIds.industry,
        klassClassificationIds.occupations,
        klassClassificationIds.education,
        klassClassificationIds.countriesSsb3,
      ]),
    );
  }, 60_000);

  it("lists and retrieves one current municipality code without upstream paging", async () => {
    const listed = await sdk.klass.listCodes({
      classificationId: klassClassificationIds.municipalities,
      date: "2026-01-01",
      language: "en",
      codes: ["0301"],
      page: 0,
      pageSize: 1,
    });

    expectKlassSource(listed);
    expect(listed.data.pagination.upstreamPaged).toBe(false);
    expect(listed.data.items).toHaveLength(1);
    expect(listed.data.items[0]).toMatchObject({ code: "0301" });

    const exact = await sdk.klass.getCode({
      classificationId: klassClassificationIds.municipalities,
      code: "0301",
      date: "2026-01-01",
      language: "en",
    });

    expectKlassSource(exact);
    expect(exact.data.code).toBe("0301");
    expect(exact.data.name.length).toBeGreaterThan(0);
  }, 60_000);

  it("resolves a verified one-to-one historical municipality transition", async () => {
    const response = await sdk.klass.resolveMunicipalityCode({
      code: "0101",
      sourceDate: "2019-01-01",
      targetDate: "2020-01-01",
      language: "en",
    });

    expectKlassSource(response);
    expect(response.data).toMatchObject({
      kind: "municipality",
      input: {
        code: "0101",
        sourceDate: "2019-01-01",
        targetDate: "2020-01-01",
      },
      status: "replaced",
    });
    expect(response.data.matches).toHaveLength(1);
    expect(response.data.matches[0]).toMatchObject({ code: "3001" });
  }, 60_000);
});
