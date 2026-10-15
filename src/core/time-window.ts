/**
 * Validated time windows for providers that take a start and an end.
 *
 * Every bound must be an ISO-8601 timestamp with an explicit offset or `Z`. A
 * local time without one is refused rather than interpreted, because the
 * providers that take windows disagree about which zone they assume -- Frost
 * works in UTC, Kartverket's tide API in Norwegian standard time -- and a
 * silently shifted window returns plausible data for the wrong hours.
 */
import { z } from "zod";

import { InputValidationError } from "./errors.js";

/** An ordered window of two instants. */
export type TimeWindow = {
  from: Date;
  to: Date;
};

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const instantSchema = z.iso.datetime({ offset: true });

/**
 * Validates `from` and `to`, raising {@link InputValidationError} naming the
 * provider when a bound is malformed, the window is empty or reversed, or it
 * exceeds `maxDurationMs`.
 */
export function parseTimeWindow(
  parameters: { from: string; to: string },
  options: { provider: string; maxDurationMs: number },
): TimeWindow {
  const from = instantSchema.safeParse(parameters.from);
  const to = instantSchema.safeParse(parameters.to);
  if (!from.success || !to.success) {
    throw new InputValidationError(
      "from and to must be ISO-8601 timestamps with an explicit offset, e.g. 2026-10-15T00:00:00Z.",
      { provider: options.provider, cause: from.success ? to.error : from.error },
    );
  }
  const window = { from: new Date(from.data), to: new Date(to.data) };
  if (window.to.getTime() <= window.from.getTime()) {
    throw new InputValidationError("to must be later than from.", { provider: options.provider });
  }
  if (window.to.getTime() - window.from.getTime() > options.maxDurationMs) {
    throw new InputValidationError(
      `The window may span at most ${describeDuration(options.maxDurationMs)}.`,
      { provider: options.provider },
    );
  }
  return window;
}

function describeDuration(milliseconds: number): string {
  if (milliseconds % DAY_MS === 0) {
    const days = milliseconds / DAY_MS;
    return `${days} ${days === 1 ? "day" : "days"}`;
  }
  const minutes = Math.round(milliseconds / MINUTE_MS);
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

/** Converts a day count to milliseconds, for readable window limits. */
export function days(count: number): number {
  return count * DAY_MS;
}

/**
 * Formats an instant as UTC `YYYY-MM-DDTHH:MM`, rounding to whole minutes in the
 * given direction so a widened window still covers every requested instant.
 */
export function formatUtcMinute(instant: Date, rounding: "floor" | "ceil"): string {
  const milliseconds = instant.getTime();
  const rounded =
    rounding === "floor"
      ? Math.floor(milliseconds / MINUTE_MS) * MINUTE_MS
      : Math.ceil(milliseconds / MINUTE_MS) * MINUTE_MS;
  return new Date(rounded).toISOString().slice(0, 16);
}

/** Formats an instant as UTC `YYYY-MM-DDTHH:MM:SS`, truncating fractional seconds. */
export function formatUtcSecond(instant: Date): string {
  return instant.toISOString().slice(0, 19);
}
