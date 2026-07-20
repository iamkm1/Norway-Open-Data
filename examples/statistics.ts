import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const population = await norway.statistics.query({
  tableId: "07459",
  language: "en",
  selections: {
    Region: ["1106"],
    Kjonn: ["1"],
    Alder: ["000"],
    ContentsCode: ["Personer1"],
    Tid: ["top(1)"],
  },
});

console.table(population.data.rows);
