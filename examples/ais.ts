import { NorwayOpenData } from "norway-open-data-sdk";

// BarentsWatch issues two kinds of self-registered client. AIS needs an
// AIS-client; the wave forecasts in examples/marine.ts need a separate
// API-client. Register both at https://www.barentswatch.no/minside/.
const clientId = process.env.BARENTSWATCH_AIS_CLIENT_ID;
const clientSecret = process.env.BARENTSWATCH_AIS_CLIENT_SECRET;

if (clientId === undefined || clientSecret === undefined) {
  throw new Error(
    "Set BARENTSWATCH_AIS_CLIENT_ID and BARENTSWATCH_AIS_CLIENT_SECRET before running this example.",
  );
}

const norway = new NorwayOpenData({
  credentials: { "barentswatch-ais": { clientId, clientSecret } },
});

// AIS coverage is the Norwegian economic zone plus the Svalbard and Jan Mayen
// protection zones, and excludes fishing vessels under 15 m and leisure vessels
// under 45 m. An absent vessel is not a vessel that does not exist.
const coverage = await norway.ais.getCoverageArea();
console.log(`Published AIS area: ${String(coverage.data.coordinates.length)} polygon(s)`);
console.log(coverage.source.attribution);

// A snapshot of everything currently transmitting in one window.
const window = { south: 58.8, west: 4.5, north: 60.0, east: 6.5 };
const snapshot = await norway.ais.getLatestPositions({ boundingBox: window });
console.log(`${String(snapshot.data.length)} vessels transmitting in the window`);

const mmsi = snapshot.data[0]?.mmsi;
if (mmsi !== undefined) {
  // Position and identity together, in one request.
  const vessel = await norway.ais.getVesselSnapshot(mmsi);
  console.log(vessel.data?.name ?? "(no static data yet)", vessel.data?.callSign);

  // Everything the provider recorded for this vessel in the last 24 hours. An
  // empty track is normal for a vessel below the size thresholds or moored out of
  // receiver range.
  const track = await norway.ais.getTrackLast24Hours(mmsi);
  console.log(`${String(track.data.points.length)} recorded positions`);
}

// A live feed. It opens on the first iteration and stays open until you stop
// iterating or abort the signal. There is no automatic reconnection: when the
// provider ends the stream, the loop ends, and whether to reopen is your call.
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

try {
  let seen = 0;
  for await (const position of norway.ais.streamPositions({
    boundingBox: window,
    // Asks the provider for at most one message per vessel per minute.
    downsample: true,
    signal: controller.signal,
  })) {
    console.log(position.mmsi, position.latitude, position.longitude, position.speedOverGround);
    seen += 1;
    // Leaving the loop closes the connection.
    if (seen >= 10) break;
  }
} catch (error) {
  if (!controller.signal.aborted) throw error;
  console.log("Stream stopped on the 30-second deadline.");
} finally {
  controller.abort();
}
