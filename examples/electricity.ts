import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();

const prices = await norway.electricity.getPrices({ area: "NO1" });
console.log(`${prices.data.length} hourly prices for NO1`);

const current = await norway.electricity.getCurrentPrice({ area: "NO1" });
console.log("current NOK/kWh:", current.data?.nokPerKwh);
