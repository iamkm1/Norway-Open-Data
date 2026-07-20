import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const reservoir = await norway.energy.getReservoirStatistics();
const national = reservoir.data.find(
  (observation) => observation.areaType === "NO" && observation.areaNumber === 0,
);

console.log(
  national === undefined
    ? "No national reservoir observation was returned."
    : `Week ${String(national.week)}: ${(national.fillLevel * 100).toFixed(1)}% full`,
);
