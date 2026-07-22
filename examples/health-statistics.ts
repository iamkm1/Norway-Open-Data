import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();

const sources = await norway.health.getSources();
console.log(`${sources.data.length} FHI statistics sources`);

const result = await norway.health.query({
  source: "daar",
  tableId: 754,
  selections: {
    DAAR: ["2020"],
    KJONN: ["Total"],
    HJERTEKAR: ["Total"],
    MEASURE_TYPE: ["RATE_NO"],
  },
});
console.log("2020 cardiovascular death rate:", result.data.rows[0]?.value);

// Suppressed cells keep their provider flag instead of pretending to be data.
for (const row of result.data.rows) {
  if (row.flag !== undefined) {
    console.log(`suppressed cell: ${row.flag} = ${result.data.flags[row.flag] ?? "unknown"}`);
  }
}
