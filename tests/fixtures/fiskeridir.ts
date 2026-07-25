/**
 * Offline Fiskeridirektoratet fixtures shaped after the vessel and aquaculture
 * register OpenAPI documents.
 *
 * The person-owner entry exists so tests can prove the SDK does not carry a
 * natural person's name, postal code or town into its output. The values here are
 * invented, not copied from the register.
 */

/** `Vessel` records, as the vessel register returns them for a search. */
export const fishingVesselsFixture = [
  {
    id: "2021118477",
    name: "CONVOY JR",
    registrationMark: "R 0062H",
    radioCallSign: "LF7250",
    municipalityCode: "1106",
    tonnageType: "OC",
    tonnage: 12.4,
    width: 3.2,
    length: 8.65,
    enginePower: 370,
    engineBuildYear: 2011,
    buildYear: 2015,
    registrationDate: "2021-07-14",
    owners: [
      {
        id: "918581669",
        entityType: "COMPANY",
        name: "TESTREDERI AS",
        postalCode: "4250",
        city: "KOPERVIK",
      },
    ],
  },
  {
    id: "2019111335",
    name: "ADELE",
    registrationMark: "R 0016H",
    municipalityCode: "1106",
    tonnageType: "OC",
    width: 2.35,
    length: 6.2,
    enginePower: 80,
    engineBuildYear: 2018,
    buildYear: 2018,
    measureDate: "2018-11-26",
    registrationDate: "2019-10-01",
    owners: [
      {
        id: "01019012345",
        entityType: "PERSON",
        name: "TEST PERSONNAVN",
        postalCode: "5215",
        city: "LYSEKLOSTER",
      },
    ],
  },
];

/** `Site` record, as the public aquaculture register returns it. */
export const aquacultureSiteFixture = {
  siteId: 5,
  versionId: 15356,
  siteNr: 10029,
  name: "TUHOLMANE Ø",
  placementType: "Offshore",
  placementTypeValue: "SJØ",
  waterType: "Salt",
  waterTypeValue: "SALT",
  firstClearanceTime: "1998-06-18T22:00:00Z",
  firstClearanceType: "PERMANENT",
  firstClearanceTypeValue: "PERMANENT",
  latitude: 59.371233,
  longitude: 5.216333,
  capacity: 2340,
  tempCapacity: 2340,
  capacityUnitType: "TN",
  placement: {
    municipalityCode: "1149",
    municipalityName: "KARMØY",
    countyCode: "11",
    countyName: "ROGALAND",
    prodAreaCode: "3",
    prodAreaName: "Karmøy til Sotra",
    prodAreaStatus: "RØD",
  },
  speciesType: null,
  speciesTypeValue: null,
  speciesLimitations: [],
  speciesTypes: ["SALMON"],
  isSlaughtery: false,
  hasCommercialActivity: true,
  hasColocation: false,
  hasJointOperation: false,
  connections: [
    {
      key: "H-KM-0018|10029",
      licenseId: 394,
      licenseNr: "H-KM-0018",
      siteId: 5,
      siteNr: "10029",
      siteName: "TUHOLMANE Ø",
      validFrom: "2025-08-27T00:00:00Z",
      validTo: null,
    },
  ],
};

/** A page of aquaculture sites. */
export const aquacultureSitesFixture = [aquacultureSiteFixture];
