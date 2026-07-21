/** Legal and operational metadata for a public-data provider. */
export type ProviderMetadata = {
  id: string;
  name: string;
  homepage: string;
  documentation: string;
  access: "open" | "identification-required" | "registration-required";
  authentication: string;
  license?: string;
  attribution?: string;
};

/** Source metadata attached to every successful SDK response. */
export type OpenDataSource = Pick<
  ProviderMetadata,
  "id" | "name" | "homepage" | "documentation" | "license" | "attribution"
>;

/** Registry of all providers currently supported by the SDK. */
export const providers = {
  brreg: {
    id: "brreg",
    name: "Brønnøysundregistrene",
    homepage: "https://www.brreg.no/",
    documentation: "https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html",
    access: "open",
    authentication: "None for supported Enhetsregisteret endpoints.",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
  },
  ssb: {
    id: "ssb",
    name: "Statistics Norway (SSB)",
    homepage: "https://www.ssb.no/en/",
    documentation: "https://www.ssb.no/en/api/pxwebapiv2",
    access: "open",
    authentication: "None.",
    license: "Creative Commons Attribution 4.0 International (CC BY 4.0)",
    attribution: "Attribute Statistics Norway when redistributing data.",
  },
  kartverket: {
    id: "kartverket",
    name: "Kartverket",
    homepage: "https://www.kartverket.no/en",
    documentation: "https://ws.geonorge.no/",
    access: "open",
    authentication: "None for supported address and place-name endpoints.",
    license: "See Geonorge dataset-specific terms and licences",
    attribution: "Attribute Kartverket where required by the selected dataset.",
  },
  entur: {
    id: "entur",
    name: "Entur",
    homepage: "https://entur.no/",
    documentation: "https://developer.entur.no/",
    access: "identification-required",
    authentication: "ET-Client-Name request header.",
    license: "Norwegian Licence for Open Government Data (NLOD)",
    attribution: "Attribute Entur and the relevant source transport authority.",
  },
  met: {
    id: "met",
    name: "MET Norway",
    homepage: "https://www.met.no/en",
    documentation: "https://api.met.no/doc/",
    access: "identification-required",
    authentication: "Meaningful User-Agent containing application and contact information.",
    license: "NLOD 2.0 and CC BY 4.0 unless the product states otherwise",
    attribution: "Credit the Norwegian Meteorological Institute as required by its terms.",
  },
  dataNorge: {
    id: "data-norge",
    name: "Data.norge.no",
    homepage: "https://data.norge.no/",
    documentation: "https://data.norge.no/en/technical/api",
    access: "open",
    authentication: "None for the supported search and resource endpoints.",
    license: "Resource-specific access rights and licences are included where published",
    attribution:
      "Observe each resource publisher's access rights, licence, and attribution terms; catalogue inclusion does not imply free reuse.",
  },
  norgesBank: {
    id: "norges-bank",
    name: "Norges Bank",
    homepage: "https://www.norges-bank.no/en/",
    documentation: "https://data.norges-bank.no/",
    access: "open",
    authentication: "None for the supported SDMX data API.",
    license: "Norges Bank reuse terms (source attribution required)",
    attribution: "State Norges Bank as the source when reusing data.",
  },
  stortinget: {
    id: "stortinget",
    name: "Stortinget",
    homepage: "https://www.stortinget.no/en/In-English/",
    documentation: "https://data.stortinget.no/dokumentasjon-og-hjelp/",
    access: "open",
    authentication: "None.",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
    attribution: "Credit Stortinget as the source.",
  },
  vegvesen: {
    id: "vegvesen",
    name: "Statens vegvesen",
    homepage: "https://www.vegvesen.no/",
    documentation:
      "https://nvdb.atlas.vegvesen.no/docs/produkter/nvdbapil/v4/introduksjon/Oversikt/",
    access: "identification-required",
    authentication: "Meaningful X-Client header; no API key for supported NVDB read endpoints.",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
    attribution: "Credit Statens vegvesen and NVDB when redistributing data.",
  },
  nve: {
    id: "nve",
    name: "Norwegian Water Resources and Energy Directorate (NVE)",
    homepage: "https://www.nve.no/",
    documentation: "https://api.nve.no/doc/",
    access: "registration-required",
    authentication:
      "None for supported energy and warning endpoints; X-API-Key for HydAPI stations and observations.",
    license: "Norwegian Licence for Open Government Data (NLOD) 2.0",
    attribution: "Credit NVE; Varsom warning data also requires its specified attribution.",
  },
  hvakosterstrommen: {
    id: "hvakosterstrommen",
    name: "Hva koster strømmen?",
    homepage: "https://www.hvakosterstrommen.no/",
    documentation: "https://www.hvakosterstrommen.no/strompris-api",
    access: "open",
    authentication: "None.",
    license: "Provider describes the API as open and free; no standardized licence stated",
    attribution:
      "Credit hvakosterstrommen.no; its API states that it sources euro prices from ENTSO-E and converts them using Norges Bank exchange rates.",
  },
} as const satisfies Record<string, ProviderMetadata>;

/** Provider registry key. */
export type ProviderId = keyof typeof providers;

/** Creates the response-envelope source representation. */
export function responseSource(provider: ProviderMetadata): OpenDataSource {
  return {
    id: provider.id,
    name: provider.name,
    homepage: provider.homepage,
    documentation: provider.documentation,
    ...(provider.license === undefined ? {} : { license: provider.license }),
    ...(provider.attribution === undefined ? {} : { attribution: provider.attribution }),
  };
}
