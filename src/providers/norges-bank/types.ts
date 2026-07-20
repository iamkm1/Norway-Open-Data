/** Parameters for daily Norges Bank exchange-rate observations. */
export type ExchangeRateParameters = {
  /** Currency being valued, as an ISO-style three-letter code. */
  from: string;
  /** Currency in which the value is expressed. Defaults to NOK. */
  to?: string;
  /** Requests the observation published on exactly this ISO date. */
  date?: string;
  /** Inclusive start of a historical range. */
  startDate?: string;
  /** Inclusive end of a historical range. */
  endDate?: string;
};

/** Date range accepted by Norges Bank interest-rate series. */
export type TimeSeriesParameters = {
  /** Inclusive start date. */
  startDate?: string;
  /** Inclusive end date. */
  endDate?: string;
};

/** A daily exchange-rate observation. */
export type CurrencyRate = {
  /** Amount currency. `unit` of this currency equals `value` quote currency. */
  baseCurrency: string;
  quoteCurrency: string;
  date: string;
  value: number;
  /** Number of base-currency units represented by `value`. */
  unit?: number;
  /** Official SDMX series for direct NOK quotations. */
  seriesId?: string;
  /** Official SDMX series used when the value is inverted or cross-calculated. */
  sourceSeriesIds?: string[];
};

/** A policy-rate or Nowa observation. */
export type InterestRateObservation = {
  date: string;
  value: number;
  name: string;
  /** Official SDMX series identifier. */
  seriesId?: string;
};
