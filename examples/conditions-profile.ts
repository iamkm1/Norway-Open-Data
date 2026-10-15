import { NorwayOpenData } from "norway-open-data-sdk";

// MET Norway sections need identification and the observations section needs a Frost client ID.
// Without them those sections are omitted as `not-configured`; the rest still answer.
const frostClientId = process.env.MET_FROST_CLIENT_ID;
const norway = new NorwayOpenData({
  applicationName: process.env.NORWAY_OPEN_DATA_APPLICATION_NAME,
  contactEmail: process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL,
  ...(frostClientId === undefined
    ? {}
    : { credentials: { "met-frost": { clientId: frostClientId } } }),
});

const conditions = await norway.profiles.conditionsAtLocation({
  latitude: 60.398,
  longitude: 5.32,
  hours: 6,
});
const profile = conditions.data;

console.log("municipality:", profile.municipality?.municipalityName);
console.log(
  "next hours:",
  profile.forecast?.map((entry) => entry.temperature),
);
console.log(
  "MET warnings:",
  profile.weatherWarnings?.map((warning) => warning.title),
);
console.log("NVE warnings:", profile.hazards?.length);
console.log("high and low waters:", profile.tides?.events);
console.log("sunset:", profile.sun?.sunset?.time);
console.log("nearest station:", profile.observations?.station.name);
console.log("notices:", profile.warnings);

for (const component of profile.components) {
  console.log(
    component.operation.padEnd(32),
    component.status === "available" ? "available" : `omitted: ${component.reason}`,
  );
}
