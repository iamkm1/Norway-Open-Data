import type { NorwayOpenData as NorwayOpenDataType } from "../src/index.js";

const { NorwayOpenData } = (await import(new URL("../dist/index.js", import.meta.url).href)) as {
  NorwayOpenData: typeof NorwayOpenDataType;
};

const norway = new NorwayOpenData({
  applicationName: process.env.NORWAY_OPEN_DATA_APPLICATION_NAME,
  contactEmail: process.env.NORWAY_OPEN_DATA_CONTACT_EMAIL,
});

let failures = 0;

function requireResult(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function check(name: string, operation: () => Promise<string>): Promise<void> {
  try {
    const detail = await operation();
    console.log(`PASS: ${name}`);
    console.log(`  ${detail}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL: ${name}`);
    console.error(`Reason: ${error instanceof Error ? error.message : String(error)}`);
  }
}

await check("Brreg companies.get", async () => {
  const response = await norway.companies.get("923609016");
  requireResult(response.data.organizationNumber === "923609016", "Unexpected company response.");
  return `${response.data.name} (${response.data.organizationNumber})`;
});

await check("Kartverket addresses.search", async () => {
  const response = await norway.addresses.search({
    query: "Haraldsgata 100",
    municipalityCode: "1106",
    limit: 3,
  });
  const first = response.data.items[0];
  requireResult(first !== undefined, "No matching official address was returned.");
  return `${response.data.items.length} result(s); ${first?.addressText ?? "no address"}`;
});

await check("Kartverket places.search", async () => {
  const response = await norway.places.search({ query: "Haugesund", limit: 3 });
  const first = response.data.items[0];
  requireResult(first !== undefined, "No matching official place name was returned.");
  return `${response.data.items.length} result(s); ${first?.name ?? "no place"}`;
});

await check("SSB statistics.query", async () => {
  const response = await norway.statistics.query({
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
  const row = response.data.rows[0];
  requireResult(row !== undefined, "SSB returned no statistical rows.");
  return `${response.data.rows.length} row(s); latest value=${String(row?.value ?? "null")}`;
});

await check("FHI health.query", async () => {
  const response = await norway.health.query({
    source: "daar",
    tableId: 754,
    selections: {
      DAAR: ["2020"],
      KJONN: ["Total"],
      HJERTEKAR: ["Total"],
      MEASURE_TYPE: ["RATE_NO"],
    },
  });
  const row = response.data.rows[0];
  requireResult(row !== undefined, "FHI returned no statistical rows.");
  return `${response.data.rows.length} row(s); 2020 cardiovascular rate=${String(row?.value ?? "null")}`;
});

await check("Entur transport.autocomplete", async () => {
  const response = await norway.transport.autocomplete({
    text: "Haugesund bussterminal",
    language: "no",
    limit: 3,
  });
  requireResult(response.data.length > 0, "Entur returned no autocomplete results.");
  return `${response.data.length} result(s); ${response.data[0]?.name ?? "no stop"}`;
});

await check("MET weather.forecast", async () => {
  const response = await norway.weather.forecast({
    latitude: 59.4138,
    longitude: 5.268,
  });
  const current = response.data.timeseries[0];
  requireResult(current !== undefined, "MET Norway returned no forecast entries.");
  return `${response.data.timeseries.length} entries; temperature=${String(
    current?.temperature ?? "unavailable",
  )} degrees C`;
});

await check("Profiles profiles.company", async () => {
  const response = await norway.profiles.company("923609016");
  const location = response.data.location;
  requireResult(location !== undefined, "No official Kartverket address match was generated.");
  return `${response.data.company.name}; ${location.matchConfidence} match at ${String(
    location.address.latitude ?? "?",
  )},${String(location.address.longitude ?? "?")}`;
});

await check("Profiles profiles.municipality", async () => {
  const response = await norway.profiles.municipality("Haugesund");
  const population = response.data.population;
  requireResult(population !== undefined, "No SSB population total was aggregated.");
  const life = response.data.lifeExpectancy;
  const lifeText =
    life?.years === null ? `suppressed (${life.flag ?? "?"})` : String(life?.years ?? "?");
  return `${response.data.municipality.name}: ${String(population.total)} residents (${population.year}); life expectancy ${lifeText}; ${String(response.data.companies?.registered ?? "?")} companies`;
});

await check("Data.norge catalog.search", async () => {
  const response = await norway.catalog.search({
    query: "transport",
    type: ["dataset"],
    page: 0,
    size: 1,
  });
  const first = response.data.items[0];
  requireResult(first !== undefined, "Data.norge returned no catalogue results.");
  return `${response.data.pagination.totalItems} result(s); ${first.title}`;
});

await check("Norges Bank currency.getExchangeRate", async () => {
  const response = await norway.currency.getExchangeRate({ from: "EUR", to: "NOK" });
  requireResult(
    response.data.baseCurrency === "EUR" &&
      response.data.quoteCurrency === "NOK" &&
      response.data.value > 0,
    "Norges Bank returned an unexpected EUR/NOK observation.",
  );
  return `${response.data.date}; ${String(response.data.unit ?? 1)} EUR=${String(
    response.data.value,
  )} NOK`;
});

await check("Stortinget parliament.getParties", async () => {
  const response = await norway.parliament.getParties();
  const first = response.data[0];
  requireResult(first !== undefined, "Stortinget returned no represented parties.");
  return `${response.data.length} represented parties; ${first.name}`;
});

await check("Statens vegvesen roads.getRoadObjectType", async () => {
  const response = await norway.roads.getRoadObjectType(105);
  requireResult(response.data.id === 105, "NVDB returned an unexpected road-object type.");
  return `type ${String(response.data.id)}: ${response.data.name}`;
});

await check("NVE energy.getReservoirStatistics", async () => {
  const response = await norway.energy.getReservoirStatistics();
  const first = response.data[0];
  requireResult(first !== undefined, "NVE returned no reservoir statistics.");
  return `${response.data.length} area observation(s); week ${String(first.week)}, fill=${String(
    first.fillLevel,
  )}`;
});

await check("Hva koster strømmen electricity.getPrices", async () => {
  const response = await norway.electricity.getPrices({ area: "NO1" });
  const first = response.data[0];
  requireResult(first !== undefined, "Hva koster strømmen returned no hourly prices.");
  requireResult(first.area === "NO1", "Electricity prices used an unexpected bidding zone.");
  return `${response.data.length} interval(s); first NOK/kWh=${String(first.nokPerKwh)}`;
});

if (failures > 0) {
  console.error(`${String(failures)} smoke test(s) failed.`);
  process.exitCode = 1;
} else {
  console.log("All required smoke tests passed.");
}
