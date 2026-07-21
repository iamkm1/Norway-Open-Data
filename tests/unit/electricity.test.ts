import pricesFixture from "../fixtures/electricity-prices.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import { InputValidationError, NorwayOpenData, NotFoundError } from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ElectricityClient", () => {
  it("requests the dated area file and normalizes hourly prices", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(pricesFixture));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).electricity.getPrices({
      area: "NO1",
      date: "2026-07-21",
    });
    expect(String(mock.mock.calls[0]?.[0])).toBe(
      "https://www.hvakosterstrommen.no/api/v1/prices/2026/07-21_NO1.json",
    );
    expect(response.data).toHaveLength(3);
    expect(response.data[0]).toEqual({
      area: "NO1",
      startsAt: "2026-07-21T00:00:00+02:00",
      endsAt: "2026-07-21T01:00:00+02:00",
      nokPerKwh: 1.50693,
      eurPerKwh: 0.13651,
      exchangeRate: 11.039,
    });
  });

  it("accepts negative spot prices", async () => {
    const { fetch } = sequenceFetch(jsonResponse(pricesFixture));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).electricity.getPrices({
      area: "NO2",
      date: "2026-07-21",
    });
    expect(response.data[1]?.nokPerKwh).toBeLessThan(0);
    expect(response.data[1]?.area).toBe("NO2");
  });

  it("defaults to the current Europe/Oslo date", async () => {
    const { fetch, mock } = sequenceFetch(jsonResponse(pricesFixture));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T10:30:00Z"));
    await new NorwayOpenData({ fetch, retries: 0 }).electricity.getPrices({ area: "NO5" });
    expect(String(mock.mock.calls[0]?.[0])).toContain("/2026/07-21_NO5.json");
  });

  it("selects the price covering the current hour", async () => {
    const { fetch } = sequenceFetch(jsonResponse(pricesFixture));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-21T01:30:00+02:00"));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).electricity.getCurrentPrice({
      area: "NO1",
    });
    expect(response.data?.startsAt).toBe("2026-07-21T01:00:00+02:00");
  });

  it("returns undefined when no published hour covers now", async () => {
    const { fetch } = sequenceFetch(jsonResponse(pricesFixture));
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-25T12:00:00+02:00"));
    const response = await new NorwayOpenData({ fetch, retries: 0 }).electricity.getCurrentPrice({
      area: "NO1",
    });
    expect(response.data).toBeUndefined();
  });

  it("rejects an unknown price area before requesting", async () => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const sdk = new NorwayOpenData({ fetch });
    await expect(
      sdk.electricity.getPrices({ area: "NO9" as "NO1", date: "2026-07-21" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    await expect(
      sdk.electricity.getPrices({ area: "NO1", date: "21-07-2026" }),
    ).rejects.toBeInstanceOf(InputValidationError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces an unpublished day as NotFoundError", async () => {
    const { fetch } = sequenceFetch(jsonResponse({}, 404));
    await expect(
      new NorwayOpenData({ fetch, retries: 0 }).electricity.getPrices({
        area: "NO1",
        date: "2030-01-01",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
