import { NorwayOpenData } from "norway-open-data-sdk";

const applicationName = process.env.NORWAY_OPEN_DATA_APPLICATION_NAME;
const contactEmail = process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL;

if (applicationName === undefined || contactEmail === undefined) {
  throw new Error(
    "Set NORWAY_OPEN_DATA_APPLICATION_NAME and NORWAY_OPEN_DATA_CONTACT_EMAIL before running this example.",
  );
}

const norway = new NorwayOpenData({ applicationName, contactEmail });
const place = await norway.profiles.address("Haraldsgata 100, Haugesund");

console.log("municipality:", place.data.address.municipalityName);
console.log("temperature:", place.data.weather?.temperature);
console.log("warnings:", place.data.hazards.length);
console.log("road segments within 250 m:", place.data.roads?.length ?? 0);
