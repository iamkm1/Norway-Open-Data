/** Coordinates accepted by MET Norway Locationforecast. */
export type ForecastParameters = {
  latitude: number;
  longitude: number;
  altitude?: number;
};

/** A normalized point in a MET Norway forecast time series. */
export type WeatherTimeseriesEntry = {
  time: string;
  temperature?: number;
  windSpeed?: number;
  windDirection?: number;
  humidity?: number;
  airPressure?: number;
  cloudCover?: number;
  precipitationNextHour?: number;
  precipitationNextSixHours?: number;
  symbolCode?: string;
};

/** A normalized MET Norway Locationforecast response. */
export type WeatherForecast = {
  updatedAt?: string;
  coordinates: {
    latitude: number;
    longitude: number;
    altitude?: number;
  };
  timeseries: WeatherTimeseriesEntry[];
};
