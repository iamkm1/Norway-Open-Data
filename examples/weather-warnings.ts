import { NorwayOpenData } from "norway-open-data-sdk";

const applicationName = process.env.NORWAY_OPEN_DATA_APPLICATION_NAME;
const contactEmail = process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL;

if (applicationName === undefined || contactEmail === undefined) {
  throw new Error(
    "Set NORWAY_OPEN_DATA_APPLICATION_NAME and NORWAY_OPEN_DATA_CONTACT_EMAIL before running this example.",
  );
}

const norway = new NorwayOpenData({ applicationName, contactEmail });
const bergen = { latitude: 60.3913, longitude: 5.3221 };

// MetAlerts decides which warning areas contain the point. An empty list is never an all-clear.
const warnings = await norway.weather.getWarnings({ ...bergen, language: "en" });
console.log(`${warnings.data.warnings.length} MET Norway warning(s) cover this point`);
for (const warning of warnings.data.warnings) {
  console.log(
    warning.awarenessLevel.color,
    warning.event,
    warning.area,
    `${warning.onset ?? "?"} - ${warning.expires ?? "?"}`,
  );
}

// Radar precipitation for roughly the next two hours, in five-minute steps.
const nowcast = await norway.weather.getNowcast(bergen);
if (nowcast.data === undefined) {
  console.log("This point is outside the Nordic radar area.");
} else {
  console.log("radar:", nowcast.data.radarCoverage);
  console.log(
    "mm/h:",
    nowcast.data.entries.map((entry) => entry.precipitationRate),
  );
}

const sun = await norway.weather.getSunTimes(bergen);
console.log("sunrise:", sun.data.sunrise?.time, "sunset:", sun.data.sunset?.time);

const ocean = await norway.weather.getOceanForecast({ latitude: 60.1, longitude: 4.8 });
console.log("sea temperature now:", ocean.data?.entries[0]?.seaTemperature);
