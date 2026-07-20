import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const parties = await norway.parliament.getParties();
const representatives = await norway.parliament.getRepresentatives();

console.log(`${String(parties.data.length)} represented parties`);
console.log(`${String(representatives.data.length)} elected representatives`);
