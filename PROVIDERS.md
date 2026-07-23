# Provider terms, attribution, and limits

> **Norway Open Data SDK is an independent open-source project and is not affiliated with,
> sponsored by, or endorsed by Norwegian public authorities or by the third-party service Hva
> koster strømmen?. Data remains subject to each source's terms and licence.**

Last contract and documentation verification: **2026-07-21**

The MIT licence applies only to this SDK's source code. It does not automatically apply to data
returned by public providers. Users are responsible for following current provider terms,
licences, attribution rules, traffic policies, and restrictions. Restricted and personal data are
intentionally excluded from this project.

Access labels in this document have precise meanings:

- **Open anonymous:** no credential or caller identity is required.
- **Identification required:** no secret is required, but the provider requires a meaningful
  application identifier in a request header.
- **Free registration required:** a self-service credential is required for the named methods.
- **Restricted access not supported:** endpoints or fields that require roles, delegated authority,
  private agreements, or access to sensitive/personal data are outside this SDK.

## Enforced request budgets

Each provider declares a request budget that the SDK enforces by default, shared by every client on
one `NorwayOpenData` instance. A request that would exceed its budget waits rather than failing.
Budgets are named per operation class where a provider publishes different limits per service.

`basis` records where a number comes from: `provider-documented` numbers are the provider's own,
cited from the sections below; `sdk-courtesy` numbers are conservative budgets the SDK chose for
providers that publish none, so that ordinary use stays comfortable while a runaway loop cannot
resemble abuse.

| Provider              | Budget                             | Basis               |
| --------------------- | ---------------------------------- | ------------------- |
| Brønnøysundregistrene | 60/minute                          | sdk-courtesy        |
| Statistics Norway     | 30/minute                          | provider-documented |
| FHI                   | 30/minute                          | sdk-courtesy        |
| Kartverket            | 60/minute                          | sdk-courtesy        |
| Entur                 | 60/minute                          | sdk-courtesy        |
| MET Norway            | 60/minute                          | sdk-courtesy        |
| Data.norge            | 10/minute search; 5/second lookups | provider-documented |
| Norges Bank           | 60/minute                          | sdk-courtesy        |
| Stortinget            | 100/minute                         | provider-documented |
| Statens vegvesen      | 60/minute                          | sdk-courtesy        |
| NVE                   | 30/minute                          | sdk-courtesy        |
| Hva koster strømmen?  | 30/minute                          | sdk-courtesy        |

These budgets bound this SDK's own traffic only. They cannot account for other clients sharing your
IP address or API key, so a provider may still return HTTP 429; the SDK honours `Retry-After` when
it does. Enforcement can be disabled with `rateLimit: { enabled: false }` when traffic is already
bounded by your own scheduler or gateway, which makes staying inside each provider's terms your
responsibility.

## Brønnøysundregistrene

- **Supported methods:** `companies.get()`, `companies.search()`, `companies.searchAll()`,
  `companies.getSubEntity()`
- **Official homepage:** https://www.brreg.no/
- **API documentation:** https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html
- **Access:** Open for the supported Enhetsregisteret entity and sub-entity endpoints; no
  authentication.
- **Licence:** Norwegian Licence for Open Government Data (NLOD) 2.0, as stated in the API
  documentation.
- **Attribution:** Follow NLOD attribution requirements when redistributing source data.
- **Known limits:** Search is paginated. The SDK conservatively requests at most 100 entities per
  page. `searchAll()` follows numbered pages on demand and accepts `maxItems`/`maxPages`; the
  default page-request cap is 100. HTTP 404 is returned for an unknown organization number.
- **Scope note:** Authorized role endpoints, Maskinporten endpoints, national identity numbers,
  and other restricted/person-level integrations are deliberately unsupported.

## Statistics Norway (SSB)

- **Supported methods:** `statistics.getTableMetadata()`, `statistics.query()`,
  `statistics.queryRaw()`
- **Official homepage:** https://www.ssb.no/en/
- **API documentation:** https://www.ssb.no/en/api/pxwebapiv2
- **Access:** Open; no authentication.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0).
- **Attribution:** Credit Statistics Norway and link to the source/licence when redistributing
  data.
- **Known limits:** PxWeb API v2 currently allows 800,000 cells per extraction and 30 queries per
  60 seconds per IP address. The provider warns of update windows and high load around publication
  time. The SDK does not split or bypass extraction limits.
- **Contract note:** The current adapter uses the v2 paths
  `/api/pxwebapi/v2/tables/{id}/metadata` and `/data`. POST selection objects use
  `variableCode`/`valueCodes`. Table value codes can change and must be discovered from metadata.

## Norwegian Institute of Public Health (FHI)

- **Supported methods:** `health.getSources()`, `health.getTables()`, `health.getTableMetadata()`,
  `health.getTableDimensions()`, `health.query()`, `health.queryRaw()`
- **Official homepage:** https://www.fhi.no/
- **API documentation:**
  https://www.fhi.no/ta/statistikkalender_og_statistikkbanker/apen-api-og-statistikk/ (Swagger:
  https://statistikk-data.fhi.no/swagger/index.html)
- **Access:** Open; no authentication.
- **Licence:** The API is presented as open; each statistics bank publishes its own terms and
  documentation. Check the `aboutUrl` returned by `getSources()` for the bank you use.
- **Attribution:** Credit Folkehelseinstituttet (FHI) and the publishing register — for example
  Dødsårsaksregisteret for cause-of-death tables, or Helsedirektoratet for the public-health
  statistics source.
- **Known limits:** Data queries are POST selections and `maxRowCount` caps returned rows.
  Small-count health cells are suppressed at the source: the JSON-stat2 `value` array mixes numbers
  with flag symbols and `extension.flags` carries the legend (for example `":"` for anonymized
  cells). The SDK preserves flags as `flag` with `value: null` and never attempts to reconstruct
  suppressed values; downstream use must keep them suppressed.
- **Contract note:** The adapter uses `/api/open/v1/Common/source`, `/{source}/table`,
  `/{source}/table/{id}/metadata`, `/{source}/table/{id}/dimension` and POST
  `/{source}/table/{id}/data` with `dimensions: [{code, filter: "item" | "all", values}]`.
  Dimension categories nest hierarchically; table metadata paragraphs are provider-authored HTML;
  `status` can be an empty string and several metadata fields are null rather than absent.

## Kartverket

- **Supported methods:** `addresses.search()`, `places.search()`, `places.nearby()`
- **Official homepage:** https://www.kartverket.no/en
- **Address API:** https://ws.geonorge.no/adresser/v1/
- **Place-name API:** https://ws.geonorge.no/stedsnavn/v1/
- **Access:** Open for these endpoints; no authentication.
- **Licence:** Geonorge terms are dataset-specific. Check the metadata/licence for the address or
  place-name dataset used; do not assume the SDK's MIT licence applies.
- **Attribution:** Attribute Kartverket and any additional dataset owners as required by the
  dataset metadata.
- **Known limits:** Address search supports at most 1,000 hits per page. Place-name endpoints
  support at most 500 hits per page; nearby radius is capped at 5,000 metres. Address search has no
  documented direct county parameter, so the SDK retrieves at most one provider page and applies a
  deterministic county-code filter locally.

## Entur

- **Supported methods:** `transport.autocomplete()`, `transport.departures()`,
  `transport.journeys()`
- **Official homepage:** https://entur.no/
- **Developer portal:** https://developer.entur.no/
- **Journey Planner documentation:**
  https://developer.entur.org/pages-journeyplanner-journeyplanner/
- **Geocoder documentation:** https://developer.entur.org/pages-geocoder-api
- **Access:** Identification required, without an API key.
- **Identification:** Every request includes `ET-Client-Name: <applicationName>`. Entur recommends
  a meaningful `company-application` form and may throttle or block unidentified clients.
- **Licence:** The documented Journey Planner and Geocoder open APIs use the Norwegian Licence for
  Open Government Data (NLOD).
- **Attribution:** Credit Entur and relevant source transport authorities where the data/product
  requires it.
- **Known limits:** Geocoder `size` is 1–100. GraphQL query cost and public-service rate controls
  apply. The SDK limits departure and journey result sizes and never attempts to bypass controls.

## MET Norway

- **Supported methods:** `weather.forecast()`, `weather.current()`
- **Official homepage:** https://www.met.no/en
- **Getting started:** https://api.met.no/doc/GettingStarted
- **Locationforecast documentation:**
  https://api.met.no/weatherapi/locationforecast/2.0/documentation
- **Terms:** https://api.met.no/doc/TermsOfService
- **Licensing:** https://api.met.no/doc/License
- **Access:** Identification required, without an API key.
- **Identification:** A meaningful User-Agent is generated as
  `NorwayOpenDataSDK/<version> <applicationName> <contactEmail>`.
- **Licence:** Unless a product states otherwise, MET describes open products under NLOD 2.0 and
  CC BY 4.0. Confirm product-specific restrictions before redistribution.
- **Attribution:** Credit “MET Norway” or “The Norwegian Meteorological Institute” and link to the
  source/licence. Do not imply endorsement or use protected branding misleadingly.
- **Known limits:** Latitude/longitude must have at most four decimals; the SDK rounds accordingly.
  MET asks clients to respect `Expires`, avoid unnecessary traffic, and seek agreement above 20
  requests/second per application. Locationforecast is an automated model forecast and has no SLA.

## Data.norge

- **Supported methods:** `catalog.search()`, `catalog.searchAll()`, `catalog.getDataset()`,
  `catalog.getDataService()`, `catalog.getPublisher()`
- **Official homepage:** https://data.norge.no/
- **API overview:** https://data.norge.no/en/technical/api
- **Search documentation:** https://data.norge.no/en/technical/api/search
- **Resource Service documentation:** https://data.norge.no/en/technical/api/resource-service
- **Publisher URI convention:**
  https://data.norge.no/en/docs/sharing-data/how-to-dataset/2-dataset-description
- **Endpoints used:** `POST https://search.api.fellesdatakatalog.digdir.no/search` (including
  documented resource-type suffixes),
  `GET https://resource.api.fellesdatakatalog.digdir.no/v1/datasets/{id}`,
  `GET https://resource.api.fellesdatakatalog.digdir.no/v1/data-services/{id}`, and the prescribed
  public publisher URI
  `GET https://organization-catalogue.fellesdatakatalog.digdir.no/organizations/{organizationNumber}`.
- **Access:** Open anonymous; no authentication or caller identification is required for supported
  methods.
- **Licence and attribution:** Data.norge is a metadata catalogue, not an umbrella licence for every
  catalogued resource. The SDK exposes each resource's published `accessRights` and `license` where
  present. Verify and credit the actual publisher and dataset according to that metadata before
  reuse; a `PUBLIC` access-rights value alone is not a substitute for checking the licence.
- **Rate limits:** The Search API documents 10 requests/minute with a burst of 20. The Resource
  Service documents 5 requests/second with a burst of 10; either service returns HTTP 429 when its
  limit is exceeded. A search across several requested resource types makes one provider request per
  type before the SDK combines the results, so each request counts separately.
- **Stability risk:** Data.norge explicitly describes its ElasticSearch-backed Search API as an
  internal service that may change and recommends against depending on it for stability or
  consistency. The SDK isolates it in `catalog.search()`. Dataset and data-service lookups use the
  separately versioned Resource Service.
- **Known behavior:** Search pagination is zero-based. Multi-type results are combined and paginated
  locally in the caller's requested type order and expose a maximum 100-position combined window;
  use a single type for deeper provider paging. `searchAll()` follows numbered pages lazily but
  does not bypass that combined-window limit. `getPublisher()` accepts a nine-digit organization
  number and parses the official publisher URI's RDF/Turtle representation.
- **Restricted access not supported:** The Maskinporten-protected Catalog View API is deliberately
  excluded. Catalogue search can describe restricted resources, but the SDK does not grant access
  to or retrieve their protected distributions.

## Norges Bank

- **Supported methods:** `currency.getExchangeRate()`, `currency.getExchangeRates()`,
  `currency.getPolicyRate()`, `currency.getNowa()`
- **Official homepage:** https://www.norges-bank.no/en/topics/statistics/
- **Open-data API overview:** https://www.norges-bank.no/en/topics/statistics/open-data/
- **Data portal guide:**
  https://www.norges-bank.no/en/topics/Statistics/open-data/guide-data-warehouse/
- **Endpoint used:** `https://data.norges-bank.no/api/data`, with the official SDMX series
  `EXR/B.{currency}.NOK.SP`, `IR/B.KPRA.SD.R`, and `SHORT_RATES/B.NOWA.ON.R` returned as CSV.
- **Access:** Open anonymous; no API key or caller identification is required.
- **Reuse and attribution:** Norges Bank's copyright and liability terms allow copies unless
  otherwise noted when Norges Bank is quoted as the source and their stated limitations are
  followed: https://www.norges-bank.no/en/disclaimer/. No standardized open-data licence is asserted
  by the SDK. Retain the returned `seriesId`/`sourceSeriesIds` and clearly identify derived or
  cross-calculated values.
- **Known behavior:** Omitting a date range requests the latest published observation. An exact
  `date` with no observation raises `NotFoundError`; range results omit weekends, holidays, and any
  other missing dates. The SDK never shifts or interpolates an observation. Non-NOK cross rates are
  calculated only where both official NOK quotation series have an observation on the same date.
  For an unbounded latest cross-currency request, the SDK intersects each series' 10 most recent
  observations; callers needing an older common date for a sparse or discontinued pair must supply
  a date range.
- **Data risk:** Official exchange rates are indicative middle rates and are not binding on Norges
  Bank or other banks. Historical data can change at the source. No numeric public API rate limit was
  stated in the official pages reviewed; keep traffic modest, cache results, and honor HTTP 429.
- **Restricted access not supported:** Only the documented open statistical dataflows are exposed;
  the SDK includes no account, settlement, confidential, or restricted banking data.

## Stortinget

- **Supported methods:** `parliament.getRepresentatives()`,
  `parliament.getRepresentative()`, `parliament.getParties()`,
  `parliament.searchCases()`, `parliament.searchCasesAll()`, `parliament.getCase()`,
  `parliament.getVotes()`, `parliament.getQuestions()`, `parliament.getMeetings()`
- **Official homepage and API catalogue:** https://data.stortinget.no/
- **Documentation:** https://data.stortinget.no/dokumentasjon-og-hjelp/
- **Terms:** https://data.stortinget.no/om-datatjenesten/bruksvilkar/
- **Endpoints used:** documented JSON exports below `https://data.stortinget.no/eksport`, including
  `dagensrepresentanter`, `representanter`, `person`, `partier`, `saker`, `sak`, `voteringer`,
  `sporretimesporsmal`, `interpellasjoner`, `skriftligesporsmal`, and `moter`, always with
  `format=json`.
- **Access:** Open anonymous; no authentication or caller identification is required.
- **Licence:** Norwegian Licence for Open Government Data (NLOD), according to Stortinget's current
  terms.
- **Attribution:** State Stortinget as the source. Stortinget also requires that data not be
  presented misleadingly, distorted, or inaccurately.
- **Rate limit:** 100 API calls/minute against `data.stortinget.no`; excess traffic returns HTTP 429.
- **Pagination boundary:** Stortinget's case export has no server-side search or pagination. The SDK
  fetches one complete official session export, applies `query`, `status`, and `type` filters
  locally, then returns zero-based local pages of at most 100 cases. Pagination metadata therefore
  describes the locally filtered export, not a provider page. Other supported list exports are also
  returned as published rather than implying server pagination. `searchCasesAll()` walks those
  local pages lazily and remains bounded by `maxItems`/`maxPages`; it does not turn the source export
  into server-side pagination.
- **Known behavior:** Provider dates are normalized without political interpretation. Omitting a
  period or session uses the provider's current export. Question categories map to the three
  official question-list exports.
- **Restricted access not supported:** The SDK exposes only the documented public parliamentary
  exports and does not add non-public, inferred, or sensitive person data. Representative response
  schemas allowlist role-relevant fields, so optional raw payloads cannot recover provider extras
  such as birth dates, contact fields, or sex.

## Statens vegvesen / NVDB

- **Supported methods:** `roads.getRoadObjectTypes()`, `roads.getRoadObjectType()`,
  `roads.searchRoadObjects()`, `roads.searchRoadObjectsAll()`, `roads.getRoadObject()`,
  `roads.getRoadNetwork()`, `roads.getRoadNetworkAll()`
- **Official homepage:** https://www.vegvesen.no/
- **NVDB API Les V4 documentation:**
  https://nvdb.atlas.vegvesen.no/docs/produkter/nvdbapil/v4/introduksjon/Oversikt/
- **Authentication and identification documentation:**
  https://nvdb.atlas.vegvesen.no/docs/produkter/nvdbapil/v4/Autentisering/
- **Production base URL:** `https://nvdbapiles.atlas.vegvesen.no`
- **Endpoints used:** `/datakatalog/api/v1/vegobjekttyper`,
  `/vegobjekter/api/v4/vegobjekter/{typeId}`,
  `/vegobjekter/api/v4/vegobjekter/{typeId}/{objectId}`, and
  `/vegnett/api/v4/veglenkesekvenser/segmentert`.
- **Access:** Identification required for supported public reads. Most NVDB data is open and needs no
  bearer token, but every request must include a meaningful, unique `X-Client` application
  identifier. The SDK derives it from `applicationName` and throws `ConfigurationError` before
  network access when it is missing.
- **Licence:** Norwegian Licence for Open Government Data (NLOD).
- **Attribution:** Credit Statens vegvesen. The provider's suggested wording is: "Inneholder data
  under norsk lisens for offentlige data (NLOD) tilgjengeliggjort av Statens vegvesen."
- **Pagination:** Road-object and segmented-network methods return one provider page. Pass the
  opaque `pagination.nextStart` back as `start` for the next page; do not parse, synthesize, or reuse
  it for a different query. `searchRoadObjectsAll()` and `getRoadNetworkAll()` follow those opaque
  markers on demand and accept `maxItems`/`maxPages`. They fail with `ResponseValidationError`
  before requesting an already-seen marker if NVDB repeats a cursor or returns a cycle. Optional
  WGS84 geometry is requested with SRID 4326.
- **Address-profile road search:** `profiles.address()` requests only the first segmented-network
  page, with a requested page size of 10, for a WGS84 box whose sides are approximately 250 metres
  from the address coordinate. This is not a circular geometry-distance filter. The profile's
  `roadSearch` records the exact bounds and whether NVDB advertised another page.
- **Dynamic schema boundary:** Road-object properties remain `unknown` because their value types are
  defined by the selected NVDB catalogue type. Type metadata is the authoritative description; the
  SDK does not pretend that every road-object type shares one property schema.
- **Known limits and risk:** Statens vegvesen does not guarantee completeness, correctness, or
  freshness. No numeric API Les rate limit is stated in the referenced V4 overview; keep requests
  modest, cache type metadata/road data, and honor throttling responses.
- **Restricted access not supported:** Road-object types marked `sensitiv: true` require explicit
  rights and authentication and are rejected or filtered. Sensitive property definitions are also
  omitted from normalized and optional raw metadata. The SDK implements no NVDB login,
  bearer-token, vehicle-owner, accident-person, or other protected-data flow.

## Norwegian Water Resources and Energy Directorate (NVE)

- **Supported energy methods:** `energy.getReservoirStatistics()`, `energy.getPowerPlants()`,
  `energy.getHydropowerPlants()`, `energy.getWindPowerPlants()`
- **Supported hazard methods:** `hazards.getFloodWarnings()`,
  `hazards.getAvalancheWarnings()`, `hazards.getLandslideWarnings()`,
  `hazards.getHydrologyStations()`, `hazards.getHydrologyObservations()`
- **Official open-data overview:** https://www.nve.no/about-nve/open-data/
- **NVE API documentation:** https://api.nve.no/doc/
- **HydAPI documentation:** https://hydapi.nve.no/UserDocumentation/
- **Free HydAPI key registration:** https://hydapi.nve.no/Users
- **Anonymous energy endpoints:**
  `https://biapi.nve.no/magasinstatistikk/api/Magasinstatistikk/HentOffentligDataSisteUke`,
  `https://api.nve.no/web/Powerplant/GetHydroPowerPlantsInOperation`, and
  `https://api.nve.no/web/WindPowerplant/GetWindPowerPlantsInOperation`.
- **Anonymous warning endpoints:** versioned flood and landslide paths below
  `https://api01.nve.no/hydrology/forecast/{type}/v1.0.10/api/Warning` and avalanche paths below
  `https://api01.nve.no/hydrology/forecast/avalanche/v6.3.2/api/Warning`.
- **Free-registration HydAPI endpoints:** `https://hydapi.nve.no/api/v1/Stations` and
  `https://hydapi.nve.no/api/v1/Observations`.
- **Access:** Reservoir, power-plant, and warning methods are open anonymous. Hydrology station and
  observation methods require a free, self-service HydAPI key in the `X-API-Key` header, configured
  as `credentials.nve.apiKey`. If it is absent, only those two methods throw `ConfigurationError`
  before any network request; all other NVE methods remain usable.
- **Licence:** NVE documents these data under the Norwegian Licence for Open Government Data (NLOD),
  compatible with the stated CC Attribution terms. Data is supplied as-is and can contain errors or
  omissions.
- **Attribution:** Credit NVE and link to the relevant service where possible. For warning data,
  NVE's guidance names the source as appropriate: "Varsler fra Snøskredvarslingen i Norge og
  www.varsom.no", "Varsler fra Jordskredvarslingen i Norge og www.varsom.no", or "Varsler fra
  Flomvarslingen i Norge og www.varsom.no".
- **Normalized warning areas:** Forecast-region identity is retained separately from structured
  county and municipality names/codes. The flattened `regions` list remains for backwards
  compatibility. Address profiles match an explicit municipality by code, then exact
  case-insensitive, NFC-normalized name. County matching is used only when the warning publishes no
  municipalities, because a county can be parent context. Forecast-region names are never automatic
  administrative matches.
- **HydAPI limits and stability:** HydAPI enforces an observation response-size cap and throttles a
  fixed but not publicly quantified number of requests per API key/time unit. Read
  `x-rate-limit-limit`, `x-rate-limit-remaining`, and `x-rate-limit-reset`; abusive clients can be
  temporarily blocked. Its documentation also warns that v1 may change without a version-number
  change. Cache metadata and split overly large observation intervals. The SDK requests one
  station/parameter series per observation call so every normalized value retains an unambiguous
  series identity.
- **Safety and freshness:** Reservoir statistics expose the latest published week, and the plant
  methods expose records currently marked operational. Hydrology observations are continuously
  updated and can be missing or corrected. Varsom warnings are regional planning aids, not a
  guarantee of local conditions; use the complete official warning and make an independent safety
  assessment. `profiles.address()` applies only the exact structured administrative filter above;
  even a precise match does not establish local conditions, and an empty match is never an
  all-clear. Query the complete official Varsom/NVE services directly for safety decisions.
- **Restricted access not supported:** The SDK has no Regobs write/login flow and exposes no
  protected observations, user submissions, or personal data. The free HydAPI key is the only NVE
  credential accepted.

## Hva koster strømmen? (third-party derived API)

- **Supported methods:** `electricity.getPrices()`, `electricity.getCurrentPrice()`
- **Classification:** Independent third-party public endpoint; it is not a government or official
  data provider.
- **Operator:** Beneficial Apps AS, as identified on the provider's API page.
- **Provider homepage:** https://www.hvakosterstrommen.no/
- **API documentation:** https://www.hvakosterstrommen.no/strompris-api
- **Endpoint:** `https://www.hvakosterstrommen.no/api/v1/prices/<year>/<month>-<day>_<area>.json`
- **Access:** Anonymous, with no API key.
- **Price areas:** `NO1` Oslo / Øst-Norge, `NO2` Kristiansand / Sør-Norge, `NO3` Trondheim /
  Midt-Norge, `NO4` Tromsø / Nord-Norge, `NO5` Bergen / Vest-Norge.
- **Data lineage:** The API page states that the service fetches electricity prices from the
  [ENTSO-E Transparency Platform](https://transparency.entsoe.eu/) in EUR and converts them to NOK
  using the latest exchange rate from Norges Bank. It explicitly warns that the converted NOK
  values can differ from official NOK prices displayed by Nord Pool; this is not documented as a
  Nord Pool data feed.
- **Reuse and attribution:** The provider describes the API as open and free, says its output can be
  displayed freely, and asks public users to cite hvakosterstrommen.no. It does not state a
  standardized government open-data licence on the reviewed API page. Preserve the documented
  ENTSO-E and Norges Bank lineage when explaining derived values and review the current source
  terms before redistribution.
- **Known limits:** Prices are exclusive of grid rent, taxes and supplier surcharges. Next-day
  prices are normally published in the early afternoon; requesting a date before publication
  returns HTTP 404, surfaced as `NotFoundError`. The provider documents historical availability
  back to 1 December 2021. Nordic day-ahead prices can legitimately be zero or negative, so the SDK
  does not constrain them to positive values. The SDK validates the ordered starts and
  provider-native ends for one Europe/Oslo calendar day: normally 24 entries, 23 at the spring
  transition, and 25 at the autumn transition. Normalized interval ends follow the next start (or
  following local midnight); `{ includeRaw: true }` preserves provider-native end timestamps,
  including a narrowly accepted historical autumn repeated-hour anomaly.

## Verification policy

Source contracts change independently of this package. Every source-affecting pull request must
link to current official or provider documentation, update fixtures and runtime schemas, and update
this file when terms, identification, attribution, or limits change.
