/** A normalized Norwegian street address. */
export type NorwegianAddress = {
  addressText?: string;
  streetName?: string;
  houseNumber?: number;
  letter?: string;
  postalCode?: string;
  postalPlace?: string;
  countryCode?: string;
  countryName?: string;
  municipalityCode?: string;
  municipalityName?: string;
  countyCode?: string;
  countyName?: string;
  latitude?: number;
  longitude?: number;
};

/** Parameters for Kartverket address search. */
export type AddressSearchParameters = {
  query: string;
  municipalityCode?: string;
  countyCode?: string;
  postalCode?: string;
  limit?: number;
};

/** Address search data and provider pagination counts. */
export type AddressSearchResult = {
  items: NorwegianAddress[];
  /** Exact matching count when the provider response makes it knowable. */
  total?: number;
};

/** Parameters for Kartverket place-name search. */
export type PlaceSearchParameters = {
  query: string;
  municipalityCode?: string;
  countyCode?: string;
  limit?: number;
};

/** Parameters for a Kartverket nearby place-name search. */
export type NearbyPlaceParameters = {
  latitude: number;
  longitude: number;
  radiusMeters?: number;
  limit?: number;
};

/** A normalized official place name. */
export type PlaceName = {
  name: string;
  type?: string;
  municipalityCode?: string;
  municipalityName?: string;
  countyCode?: string;
  countyName?: string;
  latitude?: number;
  longitude?: number;
};

/** Place-name search data and provider pagination counts. */
export type PlaceSearchResult = {
  items: PlaceName[];
  total: number;
};
