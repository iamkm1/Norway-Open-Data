import { NorwayOpenData } from "norway-open-data-sdk";

// AIS is the only source that can resolve an MMSI, so the profile requires
// BarentsWatch AIS credentials and raises ConfigurationError without them.
const clientId = process.env.BARENTSWATCH_AIS_CLIENT_ID;
const clientSecret = process.env.BARENTSWATCH_AIS_CLIENT_SECRET;

if (clientId === undefined || clientSecret === undefined) {
  throw new Error(
    "Set BARENTSWATCH_AIS_CLIENT_ID and BARENTSWATCH_AIS_CLIENT_SECRET before running this example.",
  );
}

const norway = new NorwayOpenData({
  credentials: { "barentswatch-ais": { clientId, clientSecret } },
  // Optional: identifies the caller to MET Norway, which adds the `weather`
  // section. Without it that section is omitted as `not-configured`.
  applicationName: process.env.NORWAY_OPEN_DATA_APPLICATION_NAME,
  contactEmail: process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL,
});

// Pick a vessel that is actually transmitting right now.
const snapshot = await norway.ais.getLatestPositions({
  boundingBox: { south: 58.8, west: 4.5, north: 60.0, east: 6.5 },
});
const mmsi = snapshot.data[0]?.mmsi;

if (mmsi === undefined) {
  console.log("No vessel is transmitting in that window at the moment.");
} else {
  const profile = await norway.profiles.vessel({ mmsi });
  const { ais, registration, weather, nearestPlace } = profile.data;

  // `no-recent-data` means BarentsWatch had nothing in its 24-hour window. It
  // never means the MMSI is unassigned: the feed excludes small vessels, covers
  // only Norwegian waters, and retains 14 days.
  console.log(`AIS: ${ais.status}`);
  console.log(`Name: ${ais.identity?.name ?? "unknown"}`);
  console.log(`Call sign: ${ais.identity?.callSign ?? "unknown"}`);
  console.log(
    `Latest position: ${String(ais.latestPosition?.latitude)}, ${String(ais.latestPosition?.longitude)}`,
  );
  console.log(`Recorded points: ${String(ais.track?.points.length ?? 0)}`);

  // Present only when the vessel is a registered Norwegian fishing vessel and AIS
  // reported a call sign to match it on. Most vessels are neither.
  console.log(`Register entry: ${registration?.name ?? "none"}`);
  console.log(`Nearest place: ${nearestPlace?.name ?? "none"}`);
  console.log(`Temperature: ${String(weather?.temperature ?? "not configured")}`);

  // Every section reports why it is present or absent, so a missing section is
  // never ambiguous.
  for (const entry of profile.data.components ?? []) {
    console.log(
      entry.status === "available"
        ? `  ${entry.operation}: available from ${entry.source.name}`
        : `  ${entry.operation}: omitted (${entry.reason})`,
    );
  }
}
