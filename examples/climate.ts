import { NorwayOpenData } from "norway-open-data-sdk";

const clientId = process.env.MET_FROST_CLIENT_ID;

if (clientId === undefined) {
  throw new Error(
    "Set MET_FROST_CLIENT_ID to a free Frost client ID from https://frost.met.no/auth/requestCredentials.html.",
  );
}

const norway = new NorwayOpenData({ credentials: { "met-frost": { clientId } } });

const stations = await norway.climate.searchStations({
  near: { latitude: 59.9139, longitude: 10.7522, maxCount: 1 },
  activeOnly: true,
});
const station = stations.data[0];

if (station === undefined) {
  throw new Error("Frost returned no active station near the point.");
}
console.log(station.id, station.name, `${station.distanceKm ?? "?"} km away`);

const january = await norway.climate.getObservations({
  stationIds: [station.id],
  elements: ["mean(air_temperature P1D)", "sum(precipitation_amount P1D)"],
  from: "2026-01-01T00:00:00Z",
  to: "2026-02-01T00:00:00Z",
  timeResolutions: ["P1D"],
});
for (const record of january.data.slice(0, 5)) {
  console.log(
    record.referenceTime,
    record.observations.map(
      (observation) => `${observation.elementId}=${String(observation.value)}`,
    ),
  );
}

const normals = await norway.climate.getClimateNormals({
  stationIds: [station.id],
  elements: ["mean(air_temperature P1M)"],
  period: "1991/2020",
});
console.log(
  "1991-2020 monthly means:",
  normals.data.map((normal) => `${normal.month ?? "?"}: ${normal.normal ?? "n/a"}`),
);
