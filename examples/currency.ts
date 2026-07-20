import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const latestEur = await norway.currency.getExchangeRate({ from: "EUR", to: "NOK" });
const policyRate = await norway.currency.getPolicyRate();
const nowa = await norway.currency.getNowa();

console.table([latestEur.data, policyRate.data[0], nowa.data[0]]);
