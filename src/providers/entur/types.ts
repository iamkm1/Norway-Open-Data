/** Parameters for Entur geocoder autocomplete. */
export type AutocompleteParameters = {
  text: string;
  language?: "no" | "en";
  latitude?: number;
  longitude?: number;
  limit?: number;
};

/** A normalized Entur geocoder feature. */
export type AutocompletePlace = {
  id?: string;
  name: string;
  label?: string;
  category?: string;
  latitude?: number;
  longitude?: number;
};

/** Parameters for a stop-place departure board. */
export type DepartureParameters = {
  stopPlaceId: string;
  dateTime?: Date | string;
  limit?: number;
};

/** A normalized public-transport departure. */
export type Departure = {
  stopPlaceId?: string;
  stopName?: string;
  aimedDepartureTime?: string;
  expectedDepartureTime?: string;
  destinationDisplay?: string;
  realtime?: boolean;
  cancelled?: boolean;
  transportMode?: string;
  line?: {
    id?: string;
    publicCode?: string;
    name?: string;
  };
};

/** A place reference accepted by Entur journey search. */
export type JourneyLocationInput = {
  placeId?: string;
  latitude?: number;
  longitude?: number;
};

/** Parameters for an Entur point-to-point journey search. */
export type JourneyParameters = {
  from: JourneyLocationInput;
  to: JourneyLocationInput;
  dateTime?: Date | string;
  arriveBy?: boolean;
  limit?: number;
};

/** A normalized place attached to a journey or leg. */
export type JourneyPlace = {
  id?: string;
  name?: string;
};

/** A normalized journey leg with scheduled and expected times. */
export type JourneyLeg = {
  mode?: string;
  distance?: number;
  origin?: JourneyPlace;
  destination?: JourneyPlace;
  scheduledStartTime?: string;
  expectedStartTime?: string;
  scheduledEndTime?: string;
  expectedEndTime?: string;
  realtime?: boolean;
  cancelled?: boolean;
  line?: {
    id?: string;
    publicCode?: string;
    name?: string;
    transportMode?: string;
  };
};

/** A normalized Entur journey pattern. */
export type Journey = {
  startTime?: string;
  endTime?: string;
  duration?: number;
  numberOfTransfers: number;
  origin?: JourneyPlace;
  destination?: JourneyPlace;
  legs: JourneyLeg[];
  transportModes: string[];
  realtime: boolean;
};
