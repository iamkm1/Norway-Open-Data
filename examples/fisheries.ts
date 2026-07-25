import { NorwayOpenData } from "norway-open-data-sdk";

// Both Fiskeridirektoratet registers are open. No credentials are needed.
const norway = new NorwayOpenData();

// Registered fishing vessels, filtered by municipality.
const vessels = await norway.fisheries.searchVessels({
  municipalityCode: "1106",
  pageSize: 5,
});
console.log(`${String(vessels.data.items.length)} vessels in municipality 1106`);
for (const vessel of vessels.data.items) {
  console.log(
    `${vessel.registrationMark ?? "?"}  ${vessel.name ?? "?"}  ${String(vessel.length)} m`,
  );
}

// A registration mark can be given in the register's own spelling (`R 0062H`) or
// the hyphenated form people write on paper (`R-62-H`).
const mark = vessels.data.items[0]?.registrationMark;
if (mark !== undefined) {
  const vessel = await norway.fisheries.getVessel({ registrationMark: mark });
  console.log(vessel.data);

  // Owner details are published in full for companies. For a private individual
  // the entry is kept as `{ entityType: "person" }` so the ownership structure
  // stays visible, but the name, postal code and town are not carried into SDK
  // output -- including `{ includeRaw: true }`.
  for (const owner of vessel.data.owners ?? []) {
    console.log(owner.entityType === "company" ? owner.name : "(private owner, details withheld)");
  }
}

// Aquaculture sites in the public register. `capacity` is only meaningful next to
// `capacityUnitType`; `TN` means tonnes of maximum allowed biomass.
const sites = await norway.fisheries.searchAquacultureSites({
  municipalityCode: "1149",
  limit: 5,
});
for (const site of sites.data.items) {
  console.log(
    `${site.siteNumber}  ${site.name ?? "?"}  ${String(site.capacity)} ${site.capacityUnitType ?? ""}`,
    `production area ${site.placement?.productionAreaCode ?? "?"} (${site.placement?.productionAreaStatus ?? "?"})`,
  );
}

// Bounded iteration across pages. Neither register reports a total, so iteration
// stops at the first page that is not full.
let counted = 0;
for await (const site of norway.fisheries.searchAquacultureSitesAll(
  { countyCode: "11", limit: 25 },
  { maxItems: 50, maxPages: 3 },
)) {
  counted += 1;
  void site;
}
console.log(`Walked ${String(counted)} sites in county 11`);
