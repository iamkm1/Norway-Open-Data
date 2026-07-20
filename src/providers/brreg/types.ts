import type { NorwegianAddress } from "../kartverket/types.js";

/** A normalized organization or sub-entity from Enhetsregisteret. */
export type Company = {
  organizationNumber: string;
  name: string;
  organizationForm?: {
    code: string;
    description?: string;
  };
  industry?: {
    code: string;
    description?: string;
  };
  secondaryIndustries?: Array<{
    code: string;
    description?: string;
  }>;
  businessAddress?: NorwegianAddress;
  postalAddress?: NorwegianAddress;
  municipality?: {
    code?: string;
    name?: string;
  };
  registeredAt?: string;
  foundedAt?: string;
  vatRegistered?: boolean;
  employerRegistered?: boolean;
  bankruptcy?: boolean;
  liquidation?: boolean;
  numberOfEmployees?: number;
  homepage?: string;
};

/** Search filters supported by the public Enhetsregisteret endpoints. */
export type CompanySearchParameters = {
  name?: string;
  organizationNumber?: string;
  municipalityCode?: string;
  industryCode?: string;
  organizationForm?: string;
  page?: number;
  size?: number;
};

/** Provider pagination information for company searches. */
export type CompanySearchPagination = {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
};

/** Company search data with pagination metadata. */
export type CompanySearchResult = {
  items: Company[];
  pagination: CompanySearchPagination;
};
