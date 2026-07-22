import type { StatisticsDimension, StatisticsResult } from "../providers/ssb/types.js";
import type { HealthStatisticsResult } from "../providers/fhi/types.js";
import { normalizeName } from "./address-profile.js";
import type { MunicipalityLifeExpectancy, MunicipalityPopulation } from "./types.js";

/** SSB population table used for municipality profiles. */
export const POPULATION_TABLE_ID = "07459";

/**
 * FHI life-expectancy indicator used for municipality profiles: expected years
 * at birth (MEIS) over a seven-year rolling window, all sexes and education
 * levels combined.
 */
export const LIFE_EXPECTANCY_TABLE = { source: "nokkel", tableId: 507, measure: "MEIS" } as const;

const MUNICIPALITY_CODE = /^\d{4}$/;

/**
 * Resolves a municipality code or exact name against SSB's region dimension.
 * Only four-digit municipality codes qualify; counties and the whole-country
 * region never match. Name matching is exact after Unicode normalization, so
 * duplicated municipality names (which SSB labels with county qualifiers)
 * cannot silently resolve to the wrong municipality.
 *
 * @internal
 */
export function resolveMunicipality(
  regionDimension: StatisticsDimension | undefined,
  query: string,
): { code: string; name: string } | undefined {
  if (regionDimension === undefined) return undefined;
  const municipalities = regionDimension.values.filter((value) =>
    MUNICIPALITY_CODE.test(value.code),
  );
  const trimmed = query.trim();
  if (MUNICIPALITY_CODE.test(trimmed)) {
    const match = municipalities.find((value) => value.code === trimmed);
    return match === undefined ? undefined : { code: match.code, name: match.label ?? match.code };
  }
  const wanted = normalizeName(trimmed);
  const matches = municipalities.filter(
    (value) => value.label !== undefined && normalizeName(value.label) === wanted,
  );
  const match = matches.length === 1 ? matches[0] : undefined;
  return match === undefined ? undefined : { code: match.code, name: match.label ?? match.code };
}

/**
 * Sums SSB's per-sex, per-age population rows into totals for the two newest
 * years. The aggregation is computed by the SDK, not published by SSB.
 *
 * @internal
 */
export function summarizePopulation(result: StatisticsResult): MunicipalityPopulation | undefined {
  const byYear = new Map<string, number>();
  for (const row of result.rows) {
    const year = row["Tid"];
    if (typeof year !== "string" || typeof row["value"] !== "number") continue;
    byYear.set(year, (byYear.get(year) ?? 0) + row["value"]);
  }
  const years = [...byYear.keys()].sort();
  const latest = years.at(-1);
  if (latest === undefined) return undefined;
  const previous = years.at(-2);
  const previousTotal = previous === undefined ? undefined : byYear.get(previous);
  return {
    total: byYear.get(latest) ?? 0,
    year: latest,
    ...(previous === undefined || previousTotal === undefined
      ? {}
      : {
          previousTotal,
          previousYear: previous,
          change: (byYear.get(latest) ?? 0) - previousTotal,
        }),
  };
}

/**
 * Extracts the single life-expectancy observation, preserving FHI's
 * suppression flag and its legend meaning when the value is not published.
 *
 * @internal
 */
export function pickLifeExpectancy(
  result: HealthStatisticsResult,
): MunicipalityLifeExpectancy | undefined {
  // Rows follow the cube's ascending period order, so the last row is the
  // newest published window — kept even when its value is suppressed.
  const row = result.rows.at(-1);
  if (row === undefined) return undefined;
  const period = typeof row["AAR"] === "string" ? row["AAR"] : "";
  return {
    years: row.value,
    period,
    measure: LIFE_EXPECTANCY_TABLE.measure,
    ...(row.flag === undefined
      ? {}
      : {
          flag: row.flag,
          ...(result.flags[row.flag] === undefined ? {} : { flagMeaning: result.flags[row.flag] }),
        }),
  };
}
