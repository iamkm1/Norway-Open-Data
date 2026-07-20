import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const addresses = await norway.addresses.search({
  query: "Haraldsgata 100",
  municipalityCode: "1106",
  limit: 5,
});

console.log(addresses.data.items);
