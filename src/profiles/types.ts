import type { Company } from "../providers/brreg/types.js";
import type { NorwegianAddress } from "../providers/kartverket/types.js";
import type { WeatherTimeseriesEntry } from "../providers/met/types.js";
import type { HazardWarning } from "../providers/nve/types.js";
import type { RoadNetworkSegment } from "../providers/vegvesen/types.js";

/** Combined company information with an optional official coordinate match. */
export type CompanyProfile = {
  company: Company;
  location?: {
    address: NorwegianAddress;
    matchConfidence: "exact" | "high" | "possible";
  };
};

/**
 * A location answered from several providers at once.
 *
 * Enrichment degrades gracefully: sections whose provider needs configuration
 * the client does not have are omitted rather than failing the whole call.
 */
export type AddressProfile = {
  /** The best official Kartverket match for the queried address. */
  address: NorwegianAddress;
  /** Conditions at the matched coordinate. Omitted without MET identification. */
  weather?: WeatherTimeseriesEntry;
  /**
   * Current NVE warnings whose regions mention the address county or
   * municipality. NVE regions are hydrological and avalanche regions that do
   * not map one-to-one onto municipalities, so this is a best-effort filter;
   * an empty array is not an all-clear. Use the `hazards` namespace and the
   * complete official Varsom/NVE warning for any safety-related decision.
   */
  hazards: HazardWarning[];
  /** Road segments within 250 m of the coordinate. Omitted without `applicationName`. */
  roads?: RoadNetworkSegment[];
};
