import { NorwayOpenData } from "norway-open-data-sdk";

const applicationName = process.env.NORWAY_OPEN_DATA_APPLICATION_NAME;
if (applicationName === undefined) {
  throw new Error("Set NORWAY_OPEN_DATA_APPLICATION_NAME before using the NVDB API.");
}

const norway = new NorwayOpenData({ applicationName });
const speedLimitType = await norway.roads.getRoadObjectType(105);
const speedLimits = await norway.roads.searchRoadObjects({
  typeId: 105,
  municipalityCode: "1103",
  pageSize: 5,
});

console.log(speedLimitType.data.name);
console.log(`${String(speedLimits.data.items.length)} road objects`);
console.log(`Next token: ${speedLimits.data.pagination.nextStart ?? "none"}`);
