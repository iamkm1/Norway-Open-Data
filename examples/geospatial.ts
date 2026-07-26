import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();

// Catalogue discovery is metadata-only: the SDK never follows a published URL.
const catalogue = await norway.geodata.searchDatasets({
  query: "verneområder",
  limit: 3,
});
const first = catalogue.data.items[0];
if (first !== undefined) {
  const dataset = await norway.geodata.getDataset(first.id);
  console.log(dataset.data.title, dataset.data.license);
  console.table(
    dataset.data.distributions.map(({ kind, protocol, url }) => ({ kind, protocol, url })),
  );
}

const point = { latitude: 61.494, longitude: 8.349 };
const protectedAreas = await norway.environment.getProtectedAreasAt({
  ...point,
  limit: 25,
});
const landResources = await norway.land.getLandResourcesAt({ ...point, limit: 25 });

console.log("protected areas:", protectedAreas.data.features.length);
console.log("land-resource classes:", landResources.data.features.length);
console.log("protected-area result truncated:", protectedAreas.data.pagination.truncated);
console.log("output/source CRS:", protectedAreas.data.crs, protectedAreas.data.sourceCrs);
console.log("attribution:", protectedAreas.source.attribution, landResources.source.attribution);
