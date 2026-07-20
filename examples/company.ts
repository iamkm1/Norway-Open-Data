import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const company = await norway.companies.get("923609016");

console.log(company.data);
