import { NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData();

// One call answers a municipality from four agencies at once.
const kommune = await norway.profiles.municipality("Haugesund");

console.log(kommune.data.municipality); // { code: "1106", name: "Haugesund", countyCode: "11" }
console.log(kommune.data.population); // SSB-aggregated residents for the two newest years
console.log(kommune.data.companies?.registered); // Brønnøysundregistrene organization count
console.log(kommune.data.hazards); // Exact NVE warning matches for the municipality

// FHI life expectancy keeps its suppression flag for small municipalities.
const life = kommune.data.lifeExpectancy;
if (life?.years === null) {
  console.log(`life expectancy suppressed: ${life.flag} (${life.flagMeaning ?? "unknown"})`);
} else {
  console.log(`life expectancy at birth: ${String(life?.years)} (${life?.period})`);
}

// Every operation's provenance and availability is reported in components.
for (const component of kommune.data.components ?? []) {
  console.log(component.operation, component.status);
}
