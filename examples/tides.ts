import { NorwayOpenData } from "norway-open-data-sdk";

// Kartverket's tide API is anonymous.
const norway = new NorwayOpenData();
const bergen = { latitude: 60.398, longitude: 5.32 };
const now = new Date();
const inTwoDays = new Date(now.getTime() + 48 * 60 * 60 * 1_000);

const table = await norway.tides.getTideTable({
  ...bergen,
  from: now.toISOString(),
  to: inTwoDays.toISOString(),
});

if (table.data === undefined) {
  console.log("Kartverket has no sea-level data for this position.");
} else {
  console.log(`Heights in ${table.data.unit} above ${table.data.referenceLevel}`);
  for (const event of table.data.events) {
    console.log(event.kind.padEnd(4), event.time, event.value);
  }
}

const levels = await norway.tides.getWaterLevels({
  ...bergen,
  from: now.toISOString(),
  to: new Date(now.getTime() + 24 * 60 * 60 * 1_000).toISOString(),
  referenceLevel: "mean-sea-level",
});
console.log("derived from:", levels.data?.location);
for (const series of levels.data?.series ?? []) {
  console.log(series.type, series.values.length, "values", series.quality?.class ?? "");
}
