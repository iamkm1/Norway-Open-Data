import { NorwayOpenData } from "norway-open-data-sdk";

// The wave forecasts use a BarentsWatch API-client, which is a different client
// from the AIS-client in examples/ais.ts. Register one at
// https://www.barentswatch.no/minside/.
const clientId = process.env.BARENTSWATCH_CLIENT_ID;
const clientSecret = process.env.BARENTSWATCH_CLIENT_SECRET;

if (clientId === undefined || clientSecret === undefined) {
  throw new Error(
    "Set BARENTSWATCH_CLIENT_ID and BARENTSWATCH_CLIENT_SECRET before running this example.",
  );
}

const norway = new NorwayOpenData({
  credentials: { barentswatch: { clientId, clientSecret } },
});

const point = { latitude: 59.4, longitude: 5.05 };

// The models cover the Norwegian coast, not the whole ocean. A point outside
// every model resolves to undefined rather than raising, so "no forecast here"
// is distinguishable from "the provider failed".
const wave = await norway.marine.getWaveForecast(point);
if (wave.data === undefined) {
  console.log("No wave model covers that point.");
} else {
  console.log(`Significant wave height: ${String(wave.data.significantWaveHeight)} m`);
  console.log(`Expected maximum: ${String(wave.data.maximumWaveHeight)} m`);
  // The returned coordinate is the model grid cell that answered, which may be
  // some distance from the point you asked about.
  console.log(`Grid cell: ${String(wave.data.latitude)}, ${String(wave.data.longitude)}`);
}

const current = await norway.marine.getSeaCurrent(point);
console.log(current.data ?? "No sea-current model covers that point.");

// Every available model time at the same location.
const series = await norway.marine.getWaveForecastSeries(point);
console.log(`${String(series.data.length)} forecast times available`);
