import { describe, expect, it } from "vitest";

import { InputValidationError } from "../../src/index.js";
import {
  days,
  formatUtcMinute,
  formatUtcSecond,
  parseTimeWindow,
} from "../../src/core/time-window.js";

const limits = { provider: "test", maxDurationMs: days(7) };

describe("parseTimeWindow", () => {
  it("accepts offsets and Z and returns the two instants", () => {
    const window = parseTimeWindow(
      { from: "2026-10-15T02:00:00+02:00", to: "2026-10-16T00:00:00Z" },
      limits,
    );
    expect(window.from.toISOString()).toBe("2026-10-15T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-10-16T00:00:00.000Z");
  });

  it.each([
    [{ from: "2026-10-15T00:00", to: "2026-10-16T00:00:00Z" }, "explicit offset"],
    [{ from: "2026-10-15", to: "2026-10-16T00:00:00Z" }, "explicit offset"],
    [{ from: "2026-10-15T00:00:00Z", to: "tomorrow" }, "explicit offset"],
    [{ from: "2026-10-16T00:00:00Z", to: "2026-10-16T00:00:00Z" }, "later than from"],
    [{ from: "2026-10-17T00:00:00Z", to: "2026-10-16T00:00:00Z" }, "later than from"],
    [{ from: "2026-10-01T00:00:00Z", to: "2026-10-08T00:00:01Z" }, "at most 7 days"],
  ])("rejects %j", (window, reason) => {
    expect(() => parseTimeWindow(window, limits)).toThrow(InputValidationError);
    expect(() => parseTimeWindow(window, limits)).toThrow(reason);
  });

  it("accepts a window of exactly the maximum length", () => {
    expect(() =>
      parseTimeWindow({ from: "2026-10-01T00:00:00Z", to: "2026-10-08T00:00:00Z" }, limits),
    ).not.toThrow();
  });

  it("describes limits that are not whole days in minutes", () => {
    expect(() =>
      parseTimeWindow(
        { from: "2026-10-01T00:00:00Z", to: "2026-10-01T02:00:00Z" },
        { provider: "test", maxDurationMs: 90 * 60_000 },
      ),
    ).toThrow("at most 90 minutes");
    expect(() =>
      parseTimeWindow(
        { from: "2026-10-01T00:00:00Z", to: "2026-10-01T00:02:00Z" },
        { provider: "test", maxDurationMs: 60_000 },
      ),
    ).toThrow("at most 1 minute");
    expect(() =>
      parseTimeWindow(
        { from: "2026-10-01T00:00:00Z", to: "2026-10-03T00:00:00Z" },
        { provider: "test", maxDurationMs: days(1) },
      ),
    ).toThrow("at most 1 day");
  });
});

describe("UTC formatting", () => {
  it("rounds minutes in the requested direction", () => {
    const instant = new Date("2026-10-15T10:20:30.500Z");
    expect(formatUtcMinute(instant, "floor")).toBe("2026-10-15T10:20");
    expect(formatUtcMinute(instant, "ceil")).toBe("2026-10-15T10:21");
    expect(formatUtcMinute(new Date("2026-10-15T10:20:00Z"), "ceil")).toBe("2026-10-15T10:20");
  });

  it("formats whole seconds without a zone designator", () => {
    expect(formatUtcSecond(new Date("2026-10-15T10:20:30.999Z"))).toBe("2026-10-15T10:20:30");
  });
});
