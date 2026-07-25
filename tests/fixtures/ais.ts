/**
 * Offline AIS fixtures shaped after the BarentsWatch AIS Live and AIS Historic
 * OpenAPI documents. MMSI values are inside the ranges those APIs use but are not
 * copied from a real vessel.
 *
 * Field values follow the live services' own vocabulary where it was observed to
 * differ from the documentation -- `stream` is `terra` or `offshore`, and a
 * static-data message is labelled `Staticdata`.
 */

/** `AisComboSimple` points, as `trackslast24hours` returns them. */
export const aisTrackFixture = [
  {
    mmsi: 257111020,
    msgtime: "2026-07-24T08:15:00+00:00",
    latitude: 59.4231,
    longitude: 5.2688,
    name: "TESTBÅT",
    courseOverGround: 182.4,
    speedOverGround: 9.1,
    trueHeading: 181,
    rateOfTurn: 0,
    navigationalStatus: 0,
    shipType: 30,
    stream: "terra",
  },
  {
    mmsi: 257111020,
    msgtime: "2026-07-24T10:45:00+00:00",
    latitude: 59.3902,
    longitude: 5.2411,
    name: "TESTBÅT",
    courseOverGround: 179.8,
    speedOverGround: 8.7,
    trueHeading: 180,
    rateOfTurn: null,
    navigationalStatus: 0,
    shipType: 30,
    stream: "terra",
  },
  {
    mmsi: 257111020,
    msgtime: "2026-07-24T09:30:00+00:00",
    latitude: 59.4064,
    longitude: 5.2549,
    name: "TESTBÅT",
    courseOverGround: 181,
    speedOverGround: 8.9,
    trueHeading: null,
    rateOfTurn: null,
    navigationalStatus: 0,
    shipType: 30,
    stream: "terra",
  },
];

/** `AisComboFull` snapshot, as `latest/combined` with `modelType=Full` returns it. */
export const aisSnapshotFixture = [
  {
    mmsi: 257111020,
    msgtime: "2026-07-24T10:45:00+00:00",
    msgtimeStatic: "2026-07-24T06:02:00+00:00",
    latitude: 59.3902,
    longitude: 5.2411,
    courseOverGround: 179.8,
    speedOverGround: 8.7,
    trueHeading: 180,
    rateOfTurn: null,
    navigationalStatus: 0,
    altitude: null,
    name: "TESTBÅT",
    callSign: "LF7250",
    imoNumber: 9123456,
    destination: "HAUGESUND",
    eta: "07-25 14:00",
    draught: 34,
    shipLength: 24,
    shipWidth: 7,
    shipType: 30,
    dimensionA: 18,
    dimensionB: 6,
    dimensionC: 3,
    dimensionD: 4,
    positionFixingDeviceType: 1,
    reportClass: "A",
    stream: "terra",
  },
];

/** A position report as the live stream emits it. */
export const aisPositionMessageFixture = {
  type: "Position",
  messageType: 1,
  mmsi: 257111020,
  msgtime: "2026-07-24T10:45:00+00:00",
  latitude: 59.3902,
  longitude: 5.2411,
  courseOverGround: 179.8,
  speedOverGround: 8.7,
  trueHeading: 180,
  rateOfTurn: 0,
  navigationalStatus: 0,
  aisClass: "A",
  altitude: null,
  stream: "terra",
};

/**
 * A static-data message as the live stream emits it.
 *
 * `type` carries the live service's own spelling, `Staticdata`, which differs
 * from the `StaticData` used in the provider's prose documentation.
 */
export const aisStaticMessageFixture = {
  type: "Staticdata",
  messageType: 5,
  mmsi: 257111020,
  msgtime: "2026-07-24T06:02:00+00:00",
  name: "TESTBÅT",
  callSign: "LF7250",
  imoNumber: 9123456,
  destination: "HAUGESUND",
  eta: "07-25 14:00",
  draught: 34,
  shipLength: 24,
  shipWidth: 7,
  shipType: 30,
  dimensionA: 18,
  dimensionB: 6,
  dimensionC: 3,
  dimensionD: 4,
  positionFixingDeviceType: 1,
  reportClass: "A",
  stream: "terra",
};

/** An aid-to-navigation message as the live stream emits it. */
export const aisAtonMessageFixture = {
  type: "Aton",
  messageType: 21,
  mmsi: 992571020,
  msgtime: "2026-07-24T10:40:00+00:00",
  name: "TESTSKJÆR LYKT",
  latitude: 59.41,
  longitude: 5.25,
  typeOfAidsToNavigation: 5,
  typeOfElectronicFixingDevice: 1,
  stream: "terra",
};

/**
 * A met/hyd binary broadcast as the live stream emits it.
 *
 * Deliberately complete: every one of the 36 payload fields the provider's
 * OpenAPI document declares for `OutputBinaryBroadcastMessageMetHyd` is present,
 * so a field dropped anywhere between the schema and the normalized message shows
 * up as a test failure rather than as silently missing data. Integer-typed fields
 * carry integers, matching the provider's declared `int32`.
 */
export const aisWeatherMessageFixture = {
  type: "BinaryBroadcastMessageMetHyd",
  messageType: 8,
  mmsi: 2570001,
  msgtime: "2026-07-24T10:00:00+00:00",
  functionalId: 31,
  designatedAreaCode: 1,
  latitude: 59.2,
  longitude: 5.1,
  day: 24,
  hour: 10,
  minute: 0,
  avgWindSpeed: 14,
  windGust: 22,
  windDirection: 240,
  windGustDirection: 245,
  airTemperature: 16.1,
  relativeHumidity: 78,
  dewPoint: 12.4,
  airPressure: 1013,
  airPressureTendency: "Steady",
  horizontalVisibility: 12.5,
  waterLevel: 1.2,
  waterLevelTrend: "Increasing",
  surfaceCurrentSpeed: 0.8,
  surfaceCurrentDirection: 190,
  currentSpeed2: 0.6,
  currentDirection2: 185,
  currentMeasuringLevel2: 10,
  currentSpeed3: 0.4,
  currentDirection3: 180,
  currentMeasuringLevel3: 20,
  significantWaveHeight: 1.4,
  wavePeriod: 7,
  waveDirection: 245,
  swellHeight: 0.9,
  swellPeriod: 11,
  swellDirection: 250,
  seaState: "SmallWaves",
  waterTemperature: 14.2,
  precipitationType: "Rain",
  salinity: 34.5,
  ice: "No",
  stream: "terra",
};

/** A safety-related broadcast as the live stream emits it. */
export const aisSafetyMessageFixture = {
  type: "SafetyRelated",
  messageType: 14,
  mmsi: 257111020,
  msgtime: "2026-07-24T10:50:00+00:00",
  safetyRelatedText: "TEST TRANSMISSION",
  sequenceNumber: 1,
  destinationMmsi: null,
  stream: "terra",
};

/** `AisVesselSearchResult` entries, as the historic name search returns them. */
export const aisVesselSearchFixture = [
  {
    mmsi: 257111020,
    name: "TESTBÅT",
    imoNumber: 9123456,
    callSign: "LF7250",
    country: "NO",
    shipType: 30,
    courseOverGround: 179.8,
    heading: 180,
    timeStamp: "2026-07-24T10:45:00+00:00",
  },
];

/** The published open-AIS coverage area, trimmed to one small ring. */
export const aisCoverageAreaFixture = {
  type: "MultiPolygon",
  coordinates: [
    [
      [
        [4, 58],
        [7, 58],
        [7, 61],
        [4, 61],
        [4, 58],
      ],
    ],
  ],
};

/** A successful client-credentials token response. */
export const tokenResponseFixture = {
  access_token: "test-barentswatch-access-token",
  token_type: "Bearer",
  expires_in: 3600,
};
