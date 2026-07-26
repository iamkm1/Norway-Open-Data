import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const result = await norway.profiles.natureAtLocation({
  latitude: 61.494,
  longitude: 8.349,
  limit: 25,
});

console.log("municipality context:", result.data.municipality);
console.log("protected areas:", result.data.protectedAreas?.length ?? "provider failed");
console.log("nature types:", result.data.natureTypes?.length ?? "provider failed");
console.log(
  "intervention-free areas:",
  result.data.interventionFreeAreas?.length ?? "provider failed",
);
console.log("AR50 land resources:", result.data.landResources?.length ?? "provider failed");
console.log("paging:", result.data.pagination);
console.log("warnings:", result.data.warnings);

for (const component of result.data.components) {
  console.log(
    component.operation,
    component.status,
    component.source.name,
    component.source.attribution,
  );
}
