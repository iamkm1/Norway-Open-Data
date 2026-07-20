import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  credentials: {
    nve: {
      apiKey: process.env.NVE_HYDAPI_KEY,
    },
  },
});

const avalancheWarnings = await norway.hazards.getAvalancheWarnings();
console.log(`${String(avalancheWarnings.data.length)} avalanche warning entries`);

if (process.env.NVE_HYDAPI_KEY !== undefined) {
  const stations = await norway.hazards.getHydrologyStations({
    stationName: "Austvatn",
    active: true,
  });
  console.log(stations.data[0]);
}
