import { klassClassificationIds, NorwayOpenData } from "norway-open-data-sdk";

const norway = new NorwayOpenData({ cache: { enabled: true } });

const classifications = await norway.klass.listClassifications({
  language: "en",
  page: 0,
  pageSize: 10,
});
console.log(
  classifications.data.items.map(({ id, name }) => ({ id, name })),
  classifications.data.pagination,
);

// Version 3218 is the official SIC 2025 version discovered from classification 6.
const industries = await norway.klass.listCodes({
  versionId: 3218,
  language: "en",
  page: 0,
  pageSize: 20,
});
console.log(industries.data.items);

// Klass supports official code patterns, not server-side name search.
const occupations = await norway.klass.searchCodes({
  classificationId: klassClassificationIds.occupations,
  codePattern: "25*",
  date: "2026-01-01",
  language: "en",
  pageSize: 10,
});
console.log(occupations.data.items);

const oslo = await norway.klass.getCode({
  classificationId: klassClassificationIds.municipalities,
  code: "0301",
  date: "2026-01-01",
  language: "en",
});
console.log(oslo.data);

const historical = await norway.klass.resolveMunicipalityCode({
  code: "0101",
  sourceDate: "2019-01-01",
  targetDate: "2020-01-01",
  language: "en",
});
console.log(historical.data.status, historical.data.matches, historical.data.warnings);

// Fixed table 2774 maps the Municipalities 2026 version to Municipalities 2024.
const correspondence = await norway.klass.getCorrespondenceTable({
  correspondenceTableId: 2774,
  language: "en",
  page: 0,
  pageSize: 20,
});
console.log(
  correspondence.data.sourceVersionName,
  correspondence.data.targetVersionName,
  correspondence.data.items,
);
