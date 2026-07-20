import type { Company } from "../providers/brreg/types.js";
import type { NorwegianAddress } from "../providers/kartverket/types.js";

/** Combined company information with an optional official coordinate match. */
export type CompanyProfile = {
  company: Company;
  location?: {
    address: NorwegianAddress;
    matchConfidence: "exact" | "high" | "possible";
  };
};
