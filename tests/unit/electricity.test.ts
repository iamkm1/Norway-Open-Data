import priceSamples from "../fixtures/electricity-prices.json" with { type: "json" };
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  InputValidationError,
  NorwayOpenData,
  NotFoundError,
  ResponseValidationError,
} from "../../src/index.js";
import { jsonResponse, sequenceFetch } from "./helpers.js";

type RawPrice = (typeof priceSamples)[number];
type OsloHour = { hour: number; offset: "+01:00" | "+02:00" };

function sampleFor(index: number): RawPrice {
  const sample = priceSamples[index % priceSamples.length];
  if (sample === undefined) throw new Error("Missing electricity price test sample.");
  return sample;
}

function localTimestamp(date: string, hour: number, offset: OsloHour["offset"]): string {
  return `${date}T${String(hour).padStart(2, "0")}:00:00${offset}`;
}

function pricesForHours(
  date: string,
  followingDate: string,
  hours: OsloHour[],
  finalOffset: OsloHour["offset"],
): RawPrice[] {
  return hours.map((slot, index) => {
    const next = hours[index + 1];
    return {
      ...sampleFor(index),
      time_start: localTimestamp(date, slot.hour, slot.offset),
      time_end:
        next === undefined
          ? localTimestamp(followingDate, 0, finalOffset)
          : localTimestamp(date, next.hour, next.offset),
    };
  });
}

const summerHours = Array.from({ length: 24 }, (_, hour) => ({
  hour,
  offset: "+02:00" as const,
}));
const pricesFixture = pricesForHours("2026-07-21", "2026-07-22", summerHours, "+02:00");

const daylightSavingDays = [
  {
    date: "2026-03-29",
    followingDate: "2026-03-30",
    finalOffset: "+02:00" as const,
    hours: [
      { hour: 0, offset: "+01:00" as const },
      { hour: 1, offset: "+01:00" as const },
      ...Array.from({ length: 21 }, (_, index) => ({
        hour: index + 3,
        offset: "+02:00" as const,
      })),
    ],
  },
  {
    date: "2026-10-25",
    followingDate: "2026-10-26",
    finalOffset: "+01:00" as const,
    hours: [
      { hour: 0, offset: "+02:00" as const },
      { hour: 1, offset: "+02:00" as const },
      { hour: 2, offset: "+02:00" as const },
      { hour: 2, offset: "+01:00" as const },
      ...Array.from({ length: 21 }, (_, index) => ({
        hour: index + 3,
        offset: "+01:00" as const,
      })),
    ],
  },
];

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
    expect(response.data).toHaveLength(24);
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

  it.each(daylightSavingDays)(
    "accepts the complete $date day across its daylight-saving transition",
    async ({ date, followingDate, finalOffset, hours }) => {
      const transitionPrices = pricesForHours(date, followingDate, hours, finalOffset);
      const { fetch } = sequenceFetch(jsonResponse(transitionPrices));
      const response = await new NorwayOpenData({ fetch, retries: 0 }).electricity.getPrices({
        area: "NO1",
        date,
      });
      expect(response.data).toHaveLength(hours.length);
    },
  );

  it("rejects incomplete days, wrong dates, gaps, and non-Oslo offsets", async () => {
    const previousDate = (timestamp: string): string => {
      if (timestamp.startsWith("2026-07-22")) {
        return timestamp.replace("2026-07-22", "2026-07-21");
      }
      return timestamp.replace("2026-07-21", "2026-07-20");
    };
    const wrongDate = pricesFixture.map((price) => ({
      ...price,
      time_start: previousDate(price.time_start),
      time_end: previousDate(price.time_end),
    }));
    const gap = pricesFixture.map((price, index) =>
      index === 1
        ? {
            ...price,
            time_start: "2026-07-21T01:30:00+02:00",
            time_end: "2026-07-21T02:30:00+02:00",
          }
        : price,
    );
    const wrongOffset = pricesFixture.map((price) => ({
      ...price,
      time_start: price.time_start.replace("+02:00", "+09:00"),
      time_end: price.time_end.replace("+02:00", "+09:00"),
    }));
    const { fetch } = sequenceFetch(
      jsonResponse(pricesFixture.slice(0, 2)),
      jsonResponse(wrongDate),
      jsonResponse(gap),
      jsonResponse(wrongOffset),
    );
    const electricity = new NorwayOpenData({ fetch, retries: 0 }).electricity;

    for (let index = 0; index < 4; index += 1) {
      await expect(
        electricity.getPrices({ area: "NO1", date: "2026-07-21" }),
      ).rejects.toBeInstanceOf(ResponseValidationError);
    }
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
