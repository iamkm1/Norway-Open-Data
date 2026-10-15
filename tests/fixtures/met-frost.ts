/**
 * Frost API responses shaped after Frost's published Swagger models
 * (https://frost.met.no/swagger.json) and the examples in its documentation.
 *
 * These were not captured from the live service: Frost requires a client ID and
 * none was available when the integration was written. The opt-in live probes in
 * tests/live/weather-climate.live.test.ts verify the real contract when
 * MET_FROST_CLIENT_ID is configured.
 */

const envelope = {
  "@context": "https://frost.met.no/schema",
  apiVersion: "v0",
  license: "https://creativecommons.org/licenses/by/3.0/no/",
  createdAt: "2026-10-15T12:00:00Z",
  queryTime: 0.12,
  itemsPerPage: 2,
  offset: 0,
};

export const frostNearestSourcesFixture = {
  ...envelope,
  "@type": "SourceResponse",
  currentItemCount: 2,
  totalItemCount: 2,
  currentLink:
    "https://frost.met.no/sources/v0.jsonld?types=SensorSystem&geometry=nearest(POINT(10.7522%2059.9139))&nearestmaxcount=2",
  data: [
    {
      "@type": "SensorSystem",
      id: "SN18700",
      name: "OSLO - BLINDERN",
      shortName: "Oslo (Blindern)",
      country: "Norge",
      countryCode: "NO",
      wmoId: 1492,
      geometry: { "@type": "Point", coordinates: [10.72, 59.9423], nearest: false },
      distance: 3.1,
      masl: 94,
      validFrom: "1931-01-01T00:00:00.000Z",
      county: "OSLO",
      countyId: 3,
      municipality: "OSLO",
      municipalityId: 301,
      stationHolders: ["MET.NO"],
      externalIds: ["0-20000-0-01492", "01492"],
      wigosId: "0-20000-0-01492",
    },
    {
      "@type": "SensorSystem",
      id: "SN18950",
      name: "OSLO - TRYVANNSHØGDA",
      countryCode: "NO",
      geometry: { "@type": "Point", coordinates: [10.6693, 59.9844], nearest: false },
      distance: 9.4,
      masl: 514,
      validFrom: "1927-01-01T00:00:00.000Z",
      validTo: "2026-01-01T00:00:00.000Z",
      stationHolders: ["A Volunteer Observer"],
      icaoCodes: [],
    },
  ],
};

export const frostTimeSeriesFixture = {
  ...envelope,
  "@type": "ObservationTimeSeriesResponse",
  currentItemCount: 2,
  totalItemCount: 2,
  data: [
    {
      sourceId: "SN18700:0",
      geometry: { "@type": "Point", coordinates: [10.72, 59.9423], nearest: false },
      level: { levelType: "height_above_ground", unit: "m", value: 2 },
      validFrom: "1937-01-01T00:00:00.000Z",
      timeOffset: "PT0H",
      timeResolution: "PT1H",
      timeSeriesId: 0,
      elementId: "air_temperature",
      unit: "degC",
      performanceCategory: "C",
      exposureCategory: "1",
      status: "Authoritative",
      uri: "https://frost.met.no/observations/v0.jsonld?sources=SN18700:0&referencetime=1937-01-01T00:00:00.000Z/..&elements=air_temperature",
    },
    {
      sourceId: "SN18700:0",
      validFrom: "1896-01-01T00:00:00.000Z",
      validTo: null,
      timeOffset: "PT6H",
      timeResolution: "P1D",
      timeSeriesId: 0,
      elementId: "sum(precipitation_amount P1D)",
      unit: "mm",
    },
  ],
};

export const frostObservationsFixture = {
  ...envelope,
  "@type": "ObservationResponse",
  currentItemCount: 2,
  totalItemCount: 2,
  data: [
    {
      sourceId: "SN18700:0",
      geometry: { "@type": "Point", coordinates: [10.72, 59.9423], nearest: false },
      referenceTime: "2026-10-14T12:00:00.000Z",
      observations: [
        {
          elementId: "air_temperature",
          value: 11.3,
          unit: "degC",
          level: { levelType: "height_above_ground", unit: "m", value: 2 },
          timeOffset: "PT0H",
          timeResolution: "PT1H",
          timeSeriesId: 0,
          performanceCategory: "C",
          exposureCategory: "1",
          qualityCode: 0,
        },
        {
          elementId: "wind_speed",
          value: 4.6,
          unit: "m/s",
          timeOffset: "PT0H",
          timeResolution: "PT1H",
          timeSeriesId: 0,
          qualityCode: 2,
        },
      ],
    },
    {
      sourceId: "SN18700:0",
      referenceTime: "2026-10-14T13:00:00.000Z",
      observations: [
        {
          elementId: "max(air_temperature PT1H)",
          value: "2026-10-14 12:41:00.000",
          unit: "time",
          timeResolution: "PT1H",
        },
      ],
    },
  ],
};

export const frostNormalsFixture = {
  ...envelope,
  "@type": "ClimateNormalsResponse",
  currentItemCount: 2,
  totalItemCount: 2,
  data: [
    {
      sourceId: "SN18700",
      elementId: "mean(air_temperature P1M)",
      period: "1991/2020",
      month: 10,
      normal: 7.4,
    },
    {
      sourceId: "SN18700",
      elementId: "mean(air_temperature P1M)",
      period: "1991/2020",
      month: 11,
    },
  ],
};

export function frostErrorFixture(code: number, message: string, reason = ""): unknown {
  return {
    "@context": "https://frost.met.no/schema",
    "@type": "ErrorResponse",
    apiVersion: "v0",
    license: "https://creativecommons.org/licenses/by/3.0/no/",
    createdAt: "2026-10-15T12:00:00Z",
    queryTime: 0,
    currentLink: "https://frost.met.no/observations/v0.jsonld",
    error: { code, message, reason },
  };
}
