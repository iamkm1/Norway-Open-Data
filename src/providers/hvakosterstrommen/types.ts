/** Norwegian electricity bidding zone (price area). */
export type PriceArea = "NO1" | "NO2" | "NO3" | "NO4" | "NO5";

/** Parameters for a day of hourly electricity spot prices. */
export type ElectricityPriceParameters = {
  /** Bidding zone: NO1 Oslo, NO2 Kristiansand, NO3 Trondheim, NO4 Tromsø, NO5 Bergen. */
  area: PriceArea;
  /** ISO date (`YYYY-MM-DD`). Defaults to the current date in Europe/Oslo. */
  date?: string;
};

/** Parameters for the price covering the current hour. */
export type CurrentElectricityPriceParameters = {
  area: PriceArea;
};

/** One hourly electricity spot price. */
export type ElectricityPrice = {
  area: PriceArea;
  /** ISO-8601 start of the hour, with the provider's local offset. */
  startsAt: string;
  /** Chronological next-hour boundary normalized with the Europe/Oslo offset. */
  endsAt: string;
  /** Spot price in NOK per kWh, excluding grid rent, taxes and surcharges. */
  nokPerKwh: number;
  /** Spot price in EUR per kWh. */
  eurPerKwh: number;
  /** EUR/NOK exchange rate used by the provider for this hour. */
  exchangeRate: number;
};
