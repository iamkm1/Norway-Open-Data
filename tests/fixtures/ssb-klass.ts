export const klassClassificationListPage = {
  _embedded: {
    classifications: [
      {
        name: "Classification of municipalities",
        id: 131,
        classificationType: "Classification",
        classificationFamilyId: 15,
        lastModified: "2026-04-08T07:51:12+02:00",
        _links: {
          self: {
            href: "https://data.ssb.no/api/klass/v1/classifications/131",
          },
        },
      },
      {
        name: "Classification of county",
        id: 104,
        classificationType: "Classification",
        classificationFamilyId: 15,
        lastModified: "2026-03-13T11:31:52+01:00",
        _links: {
          self: {
            href: "https://data.ssb.no/api/klass/v1/classifications/104",
          },
        },
      },
    ],
  },
  _links: {
    first: {
      href: "https://data.ssb.no/api/klass/v1/classifications?language=en&page=0&size=2",
    },
    self: {
      href: "https://data.ssb.no/api/klass/v1/classifications?language=en&page=0&size=2",
    },
    next: {
      href: "https://data.ssb.no/api/klass/v1/classifications?language=en&page=1&size=2",
    },
    last: {
      href: "https://data.ssb.no/api/klass/v1/classifications?language=en&page=2&size=2",
    },
    search: {
      href: "https://data.ssb.no/api/klass/v1/classifications/search{?query,includeCodelists}",
      templated: true,
    },
  },
  page: {
    size: 2,
    totalElements: 6,
    totalPages: 3,
    number: 0,
  },
};

export const klassClassificationSearchPage = {
  _embedded: {
    searchResults: [
      {
        name: "Classification of municipalities",
        id: 131,
        language: "en",
        snippet: "Municipality is both a political and an administrative level in Norway.",
        searchScore: 8,
        _links: {
          self: {
            href: "https://data.ssb.no/api/klass/v1/classifications/131",
          },
        },
      },
    ],
  },
  _links: {
    self: {
      href: "https://data.ssb.no/api/klass/v1/classifications/search?query=municipality&includeCodelists=false&page=0&size=20",
    },
  },
  page: {
    size: 20,
    totalElements: 1,
    totalPages: 1,
    number: 0,
  },
};

export const klassMunicipalityClassification = {
  name: "Classification of municipalities",
  id: 131,
  classificationType: "Classification",
  lastModified: "2026-04-08T07:51:12+02:00",
  description: "Municipality is both a political and an administrative level in Norway.",
  primaryLanguage: "nb",
  copyrighted: false,
  includeShortName: false,
  includeNotes: true,
  contactPerson: {
    name: "Statistics Norway",
    email: null,
    phone: "",
  },
  owningSection: null,
  statisticalUnits: [],
  versions: [
    {
      name: "Municipalities 2019",
      id: 1102,
      validFrom: "2019-01-01",
      validTo: "2020-01-01",
      lastModified: "2020-01-01T00:00:00+01:00",
      published: ["nb", "nn", "en"],
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/versions/1102",
        },
      },
    },
    {
      name: "Municipalities 2020",
      id: 1860,
      validFrom: "2020-01-01",
      validTo: "2022-01-01",
      lastModified: "2022-01-01T00:00:00+01:00",
      published: ["nb", "nn", "en"],
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/versions/1860",
        },
      },
    },
    {
      name: "Municipalities 2024",
      id: 1710,
      validFrom: "2024-01-01",
      validTo: "2026-01-01",
      lastModified: "2024-01-01T00:00:00+01:00",
      published: ["nb", "nn", "en"],
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/versions/1710",
        },
      },
    },
    {
      name: "Municipalities 2026",
      id: 3262,
      validFrom: "2026-01-01",
      lastModified: "2026-04-08T07:51:12+02:00",
      published: ["nb", "nn", "en"],
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/versions/3262",
        },
      },
    },
  ],
  _links: {
    self: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131",
    },
    codes: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/codes{?from,to,selectCodes,selectLevel,language,includeFuture}",
      templated: true,
    },
    codesAt: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/codesAt{?date,selectCodes,selectLevel,language,includeFuture}",
      templated: true,
    },
    variant: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/variant{?variantName,from,to,language,includeFuture}",
      templated: true,
    },
    variantAt: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/variantAt{?variantName,date,language,includeFuture}",
      templated: true,
    },
    corresponds: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/corresponds{?targetClassificationId,from,to,language,includeFuture}",
      templated: true,
    },
    correspondsAt: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/correspondsAt{?targetClassificationId,date,language,includeFuture}",
      templated: true,
    },
    changes: {
      href: "https://data.ssb.no/api/klass/v1/classifications/131/changes{?from,to,language,includeFuture}",
      templated: true,
    },
  },
  classificationFamilyId: 15,
};

export const klassMunicipalityVersion = {
  name: "Municipalities 2026",
  id: 3262,
  validFrom: "2026-01-01",
  lastModified: "2026-04-08T07:51:12+02:00",
  published: ["nb", "nn", "en"],
  introduction: "",
  contactPerson: {
    name: "Statistics Norway",
    email: null,
    phone: "",
  },
  owningSection: null,
  legalBase: "",
  publications: "",
  derivedFrom: "",
  correspondenceTables: [
    {
      name: "Municipalities 2026 - Municipalities 2024",
      id: 2774,
      contactPerson: {
        name: "Statistics Norway",
        email: null,
        phone: "",
      },
      owningSection: null,
      source: "Municipalities 2026",
      sourceId: 3262,
      target: "Municipalities 2024",
      targetId: 1710,
      changeTable: true,
      lastModified: "2026-04-08T07:51:12+02:00",
      published: ["nb", "nn", "en"],
      sourceLevel: null,
      targetLevel: null,
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/correspondencetables/2774",
        },
      },
    },
    {
      name: "County 2026 - Municipalities 2026",
      id: 2800,
      contactPerson: {
        name: "Statistics Norway",
        email: null,
        phone: "",
      },
      owningSection: null,
      source: "County 2026",
      sourceId: 3315,
      target: "Municipalities 2026",
      targetId: 3262,
      changeTable: false,
      lastModified: "2026-03-13T11:31:52+01:00",
      published: ["nb", "nn", "en"],
      sourceLevel: null,
      targetLevel: null,
      _links: {
        self: {
          href: "https://data.ssb.no/api/klass/v1/correspondencetables/2800",
        },
      },
    },
  ],
  classificationVariants: [],
  changelogs: [],
  levels: [
    {
      levelNumber: 1,
      levelName: "Level 1",
    },
  ],
  classificationItems: [
    {
      code: "0301",
      parentCode: "",
      level: "1",
      name: "Oslo - Oslove",
      shortName: null,
      notes: "Oslo municipality.",
    },
    {
      code: "1103",
      parentCode: "",
      level: "1",
      name: "Stavanger",
      shortName: null,
      notes: null,
    },
    {
      code: "1508",
      parentCode: "",
      level: "1",
      name: "Ålesund",
      shortName: null,
      notes: null,
    },
  ],
  _links: {
    self: {
      href: "https://data.ssb.no/api/klass/v1/versions/3262",
    },
  },
};

export const klassMunicipalityCodesAt = {
  codes: [
    {
      code: "0301",
      parentCode: null,
      level: "1",
      name: "Oslo - Oslove",
      shortName: "",
      presentationName: "",
      validFrom: null,
      validTo: null,
      notes: "Oslo municipality.",
    },
    {
      code: "1103",
      parentCode: null,
      level: "1",
      name: "Stavanger",
      shortName: "",
      presentationName: "",
      validFrom: null,
      validTo: null,
      notes: "",
    },
    {
      code: "1508",
      parentCode: null,
      level: "1",
      name: "Ålesund",
      shortName: "",
      presentationName: "",
      validFrom: null,
      validTo: null,
      notes: "",
    },
  ],
};

export const klassMunicipalityCurrentCode = {
  codes: [klassMunicipalityCodesAt.codes[0]],
};

export const klassEmptyCodesAt = {
  codes: [],
};

export const klassFixedCorrespondenceTable = {
  name: "Municipalities 2020 - Municipalities 2019",
  id: 1008,
  contactPerson: {
    name: "Statistics Norway",
    email: null,
    phone: "",
  },
  owningSection: null,
  source: "Municipalities 2020",
  sourceId: 1860,
  target: "Municipalities 2019",
  targetId: 1102,
  changeTable: true,
  lastModified: "2020-01-01T00:00:00+01:00",
  published: ["nb", "nn", "en"],
  sourceLevel: null,
  targetLevel: null,
  description: "",
  changelogs: [],
  correspondenceMaps: [
    {
      sourceCode: "1103",
      sourceName: "Stavanger",
      targetCode: "1103",
      targetName: "Stavanger",
    },
    {
      sourceCode: "1103",
      sourceName: "Stavanger",
      targetCode: "1141",
      targetName: "Finnøy",
    },
    {
      sourceCode: "1103",
      sourceName: "Stavanger",
      targetCode: "1142",
      targetName: "Rennesøy",
    },
  ],
  _links: {
    self: {
      href: "https://data.ssb.no/api/klass/v1/correspondencetables/1008",
    },
    source: {
      href: "https://data.ssb.no/api/klass/v1/versions/1860{?language,includeFuture}",
      templated: true,
    },
    target: {
      href: "https://data.ssb.no/api/klass/v1/versions/1102{?language,includeFuture}",
      templated: true,
    },
  },
};

export const klassDynamicCorrespondence = {
  correspondenceItems: [
    {
      sourceCode: "0301",
      sourceName: "Oslo - Oslove",
      sourceShortName: "",
      targetCode: "03",
      targetName: "Oslo - Oslove",
      targetShortName: "",
    },
    {
      sourceCode: "1103",
      sourceName: "Stavanger",
      sourceShortName: "",
      targetCode: "11",
      targetName: "Rogaland",
      targetShortName: "",
    },
    {
      sourceCode: "1508",
      sourceName: "Ålesund",
      sourceShortName: "",
      targetCode: "15",
      targetName: "Møre og Romsdal",
      targetShortName: "",
    },
  ],
};

export const klassMunicipalityHaldenChanges = {
  codeChanges: [
    {
      oldCode: "0101",
      oldName: "Halden",
      oldShortName: "",
      newCode: "3001",
      newName: "Halden",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
  ],
};

export const klassMunicipalityMergeChanges = {
  codeChanges: [
    {
      oldCode: "1103",
      oldName: "Stavanger",
      oldShortName: "",
      newCode: "1103",
      newName: "Stavanger",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
    {
      oldCode: "1141",
      oldName: "Finnøy",
      oldShortName: "",
      newCode: "1103",
      newName: "Stavanger",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
    {
      oldCode: "1142",
      oldName: "Rennesøy",
      oldShortName: "",
      newCode: "1103",
      newName: "Stavanger",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
  ],
};

export const klassMunicipalitySplitChanges = {
  codeChanges: [
    {
      oldCode: "1507",
      oldName: "Ålesund",
      oldShortName: "",
      newCode: "1508",
      newName: "Ålesund",
      newShortName: "",
      changeOccurred: "2024-01-01",
    },
    {
      oldCode: "1507",
      oldName: "Ålesund",
      oldShortName: "",
      newCode: "1580",
      newName: "Haram",
      newShortName: "",
      changeOccurred: "2024-01-01",
    },
  ],
};

export const klassMunicipalityNoMatchChanges = {
  codeChanges: [],
};

export const klassCountyMergeChanges = {
  codeChanges: [
    {
      oldCode: "01",
      oldName: "Østfold",
      oldShortName: "",
      newCode: "30",
      newName: "Viken",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
    {
      oldCode: "02",
      oldName: "Akershus",
      oldShortName: "",
      newCode: "30",
      newName: "Viken",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
    {
      oldCode: "06",
      oldName: "Buskerud",
      oldShortName: "",
      newCode: "30",
      newName: "Viken",
      newShortName: "",
      changeOccurred: "2020-01-01",
    },
  ],
};

export const klassCountySplitChanges = {
  codeChanges: [
    {
      oldCode: "30",
      oldName: "Viken",
      oldShortName: "",
      newCode: "31",
      newName: "Østfold",
      newShortName: "",
      changeOccurred: "2024-01-01",
    },
    {
      oldCode: "30",
      oldName: "Viken",
      oldShortName: "",
      newCode: "32",
      newName: "Akershus",
      newShortName: "",
      changeOccurred: "2024-01-01",
    },
    {
      oldCode: "30",
      oldName: "Viken",
      oldShortName: "",
      newCode: "33",
      newName: "Buskerud",
      newShortName: "",
      changeOccurred: "2024-01-01",
    },
  ],
};
