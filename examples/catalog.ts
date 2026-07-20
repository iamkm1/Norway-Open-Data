import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();
const results = await norway.catalog.search({
  query: "weather",
  type: ["dataset", "data-service"],
  accessRights: "PUBLIC",
  size: 5,
});

console.table(
  results.data.items.map((resource) => ({
    id: resource.id,
    type: resource.type,
    title: resource.title,
    publisher: resource.publisher?.name,
    accessRights: resource.accessRights,
    license: resource.license,
  })),
);
