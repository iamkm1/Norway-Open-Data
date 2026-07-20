import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ cache: { enabled: true } });
const profile = await norway.profiles.company("923609016");

console.log(profile.data.company.name);
console.log(profile.data.location);
