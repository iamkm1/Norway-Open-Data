import { NorwayOpenData } from "norway-open-data-sdk";

const applicationName = process.env.NORWAY_OPEN_DATA_APPLICATION_NAME;
const contactEmail = process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL;

if (applicationName === undefined || contactEmail === undefined) {
  throw new Error(
    "Set NORWAY_OPEN_DATA_APPLICATION_NAME and NORWAY_OPEN_DATA_CONTACT_EMAIL before running this example.",
  );
}

const norway = new NorwayOpenData({
  applicationName,
  contactEmail,
});
const forecast = await norway.weather.forecast({
  latitude: 59.4138,
  longitude: 5.268,
});

console.log(forecast.data.timeseries[0]);
