import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({
  applicationName: "my-company-departure-example",
});
const departures = await norway.transport.departures({
  stopPlaceId: "NSR:StopPlace:548",
  limit: 10,
});

console.table(departures.data);
