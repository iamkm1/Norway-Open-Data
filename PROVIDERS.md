# Provider terms, attribution, and limits

> **Norway Open Data SDK is an independent open-source project and is not affiliated with,
> sponsored by, or endorsed by Norwegian public authorities or by the third-party service Hva
> koster strømmen?. Data remains subject to each source's terms and licence.**

Last contract and documentation verification: **2026-10-15**

The MIT licence applies only to this SDK's source code. It does not automatically apply to data
returned by public providers. Users are responsible for following current provider terms,
licences, attribution rules, traffic policies, and restrictions. Restricted and personal data are
intentionally excluded from this project.

Access labels in this document have precise meanings:

- **Open anonymous:** no credential or caller identity is required.
- **Identification required:** no secret is required, but the provider requires a meaningful
  application identifier in a request header.
- **Free registration required:** a self-service credential is required for the named methods.
- **OAuth2 client credentials required:** a self-registered client id and secret are required, and
  the SDK exchanges them for a short-lived bearer token at the provider's own token endpoint.
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

| Provider integration               | Budget                             | Basis               |
| ---------------------------------- | ---------------------------------- | ------------------- |
| Brønnøysundregistrene              | 60/minute                          | sdk-courtesy        |
| Statistics Norway — PxWeb          | 30/minute                          | provider-documented |
| Statistics Norway — Klass          | 30/minute                          | sdk-courtesy        |
| FHI                                | 30/minute                          | sdk-courtesy        |
| Kartverket                         | 60/minute                          | sdk-courtesy        |
| Kartverket — tides and water level | 30/minute                          | sdk-courtesy        |
| Geonorge catalogue                 | 30/minute                          | sdk-courtesy        |
| Miljødirektoratet / Naturbase      | 30/minute                          | sdk-courtesy        |
| NIBIO                              | 20/minute                          | sdk-courtesy        |
| Entur                              | 60/minute                          | sdk-courtesy        |
| MET Norway                         | 60/minute                          | sdk-courtesy        |
| MET Norway — Frost                 | 30/minute                          | sdk-courtesy        |
| Data.norge                         | 10/minute search; 5/second lookups | provider-documented |
| Norges Bank                        | 60/minute                          | sdk-courtesy        |
| Stortinget                         | 100/minute                         | provider-documented |
| Statens vegvesen                   | 60/minute                          | sdk-courtesy        |
| NVE                                | 30/minute                          | sdk-courtesy        |
| BarentsWatch AIS                   | 60/minute; 5 stream opens/minute   | sdk-courtesy        |
| BarentsWatch platform              | 60/minute                          | sdk-courtesy        |
| Fiskeridirektoratet — vessels      | 60/minute                          | sdk-courtesy        |
| Fiskeridirektoratet — aquaculture  | 60/minute                          | sdk-courtesy        |
| Hva koster strømmen?               | 30/minute                          | sdk-courtesy        |

BarentsWatch AIS declares a second, much tighter budget for opening streams. A streaming connection
is meant to be opened once and held for as long as the caller iterates it, so five opens per minute
leaves normal use untouched while bounding an accidental reconnect loop — the failure mode most
likely to resemble an attack. Ordinary requests use the 60-per-minute budget.

Statistics Norway is one public-sector organization with two independently governed API
integrations. PxWeb and Klass therefore have separate SDK request budgets and cache policies. The
30-per-minute Klass budget is an SDK courtesy limit: SSB publishes no numeric Klass API limit, and
the SDK does not present that number as official guidance.

These budgets bound this SDK's own traffic only. They cannot account for other clients sharing your
IP address or API key, so a provider may still return HTTP 429. When it does, the SDK waits the
stated `Retry-After` in full rather than shortening it to its own backoff cap, and never retries
sooner than the provider permitted. A `Retry-After` longer than one minute stops the retry entirely
and raises without waiting first — `RateLimitError` for 429, the usual `ProviderError` for a
retryable 5xx — with `retryAfter` set on either, so the caller can reschedule instead of being
blocked. Enforcement can be disabled with `rateLimit: { enabled: false }` when traffic is already
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

Statistics Norway is one organization. The SDK exposes two distinct services because they have
different base URLs, contracts, request guidance, cache policies, and public purposes:
`statistics` reads statistical tables through PxWeb, while `klass` reads the classifications,
versions, codes, and mappings used to describe data.

### PxWeb API v2

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

### Klass API v1

- **Supported methods (14):** `klass.listClassifications()`, `klass.searchClassifications()`,
  `klass.getClassification()`, `klass.listVersions()`, `klass.getVersion()`,
  `klass.listCodes()`, `klass.getCode()`, `klass.searchCodes()`,
  `klass.listCorrespondenceTables()`, `klass.getCorrespondenceTable()`,
  `klass.getCorrespondence()`, `klass.listCodeChanges()`,
  `klass.resolveMunicipalityCode()`, `klass.resolveCountyCode()`
- **Official homepage:** https://www.ssb.no/en/klass/
- **API guide:** https://data.ssb.no/api/klass/v1/api-guide.html
- **Base URL:** `https://data.ssb.no/api/klass/v1`
- **Access:** Open anonymous reads; no API key or caller-identification header is required.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0).
- **Attribution:** Attribute Statistics Norway (SSB), link to `ssb.no` and CC BY 4.0, and
  indicate changes.
- **Languages:** `nb`, `nn`, and `en`; omitting `language` uses Klass' `nb` default. Translation
  availability varies by classification and version, and requesting an unpublished language can
  produce empty translated names. Classification full-text search returns language-specific hits,
  so one classification can appear more than once when several published languages match.
- **Endpoints:** The curated adapter uses `GET /classifications`,
  `/classifications/search`, `/classifications/{classificationId}`,
  `/versions/{versionId}`, `/classifications/{classificationId}/codesAt`,
  `/classifications/{classificationId}/codes`,
  `/correspondencetables/{correspondenceTableId}`,
  `/classifications/{sourceClassificationId}/correspondsAt`,
  `/classifications/{sourceClassificationId}/corresponds`, and
  `/classifications/{classificationId}/changes`. It does not mirror unrelated upstream
  operations.
- **Dates and ranges:** Dated code, change, correspondence, and resolution parameters use ISO
  `YYYY-MM-DD`; the classification-list `changedSince` filter uses an offset ISO date-time. A dated
  operation observes one date. Code and correspondence ranges use inclusive `from` and exclusive
  `to`; an omitted `to` means an indefinite range. The `/changes` endpoint differs: live contract
  probes return events only when they occur strictly after `from` and strictly before `to`, so
  include a day on each side when an event on a boundary is required. Future versions are excluded
  unless `includeFuture` is requested.
- **Paging:** Classification listing and classification search use Klass' real zero-based
  pagination. Version metadata, codes, code changes, correspondence-table summaries, and
  correspondence items are not paged by Klass. Those methods return a bounded SDK-local page
  (20 items by default, at most 100) and set `pagination.upstreamPaged` to `false`, but the complete
  provider payload still has to be downloaded and validated first. Fixed correspondence tables
  have no provider item endpoint.
- **Code search:** `searchCodes()` supports only Klass' official `selectCodes` code-pattern syntax
  (exact codes, wildcards, and ranges). Klass provides no code-name search endpoint. Use
  `searchClassifications()` only for classification metadata, not for names inside a code list.
- **Correspondence semantics:** Fixed, dated, and ranged correspondence preserves every official
  source-to-target edge. Klass correspondence items do not publish weights, so the SDK does not
  invent them. Missing correspondence is not proof that areas are equivalent or unrelated.
  Municipality and county helpers preserve merges, splits, multiple predecessors, multiple
  successors, ambiguity, and missing date context rather than selecting one code silently.
  Administrative correspondence does not establish statistical comparability across dates or
  boundaries.
- **Validation and errors:** Every public parameter object and every consumed response object is
  strictly runtime-validated. Invalid caller input fails before network access. Unexpected
  successful payloads raise `ResponseValidationError`; upstream HTTP failures retain the shared
  provider, status, timeout, cancellation, retry, and rate-limit behavior. An exact code miss is
  normalized to `NotFoundError` only after Klass returns a validated empty result.
- **Caching and traffic:** When the optional SDK cache is enabled, Klass classifications,
  versions, codes, changes, and correspondence use a 24-hour provider default TTL in the
  in-process cache. Klass publishes no numeric API rate limit; the SDK separately enforces a
  conservative courtesy budget of 30 requests/minute.
- **Profile boundary:** `profiles.municipality()` does not automatically call Klass or rewrite a
  historical code. Resolve historical municipality codes explicitly and continue to a current
  profile only when the application accepts an unambiguous result.

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

- **Supported methods:** `addresses.search()`, `places.search()`, `places.nearby()`,
  `places.getMunicipalityAt()`
- **Official homepage:** https://www.kartverket.no/en
- **Address API:** https://ws.geonorge.no/adresser/v1/
- **Place-name API:** https://ws.geonorge.no/stedsnavn/v1/
- **Kommuneinfo API:** https://api.kartverket.no/kommuneinfo/v1/ (`GET /punkt` with `koordsys=4258`)
- **Access:** Open for these endpoints; no authentication.
- **Licence:** Geonorge terms are dataset-specific. Check the metadata/licence for the address or
  place-name dataset used; do not assume the SDK's MIT licence applies.
- **Attribution:** Attribute Kartverket and any additional dataset owners as required by the
  dataset metadata.
- **Known limits:** Address search supports at most 1,000 hits per page. Place-name endpoints
  support at most 500 hits per page; nearby radius is capped at 5,000 metres. Address search has no
  documented direct county parameter, so the SDK retrieves at most one provider page and applies a
  deterministic county-code filter locally. Kommuneinfo answers a point outside every municipality
  with HTTP 404 and the text "Ingen treff"; the SDK resolves exactly that response to `undefined` and
  reports any other 404 as `NotFoundError`. Kommuneinfo moved from ws.geonorge.no to
  api.kartverket.no in December 2023; the SDK uses the new endpoint.

## Kartverket — tides and water level (Hydrographic Service)

- **Supported methods:** `tides.listStations()`, `tides.getWaterLevels()`, `tides.getTideTable()`,
  `tides.getReferenceLevels()`
- **Official homepage:** https://www.kartverket.no/til-sjos/se-havniva
- **API documentation:** https://vannstand.kartverket.no/tideapi_en.html and the linked
  communication-protocol PDF (revision June 2025)
- **Endpoint used:** `GET https://vannstand.kartverket.no/tideapi.php` with `tide_request` set to
  `stationlist`, `locationdata` (`datatype=all` or `tab`) or `locationlevels`
- **Access:** Open anonymous; no registration.
- **Licence:** Creative Commons Attribution 4.0 International (CC BY 4.0).
- **Attribution:** The Norwegian Mapping Authority, Hydrographic Service must be credited.
- **Format:** XML only, with no published XML schema. The SDK parses it with a strict reader that
  refuses document type declarations and validates every attribute it reads. Invalid parameters
  are reported in-band as an HTTP 200 `<error>` document, raised as `ProviderError` with the
  provider's text. A position without sea-level data returns a `<nodata info="...">` element, which
  the SDK resolves to `undefined`.
- **Known limits:** Kartverket describes capacity of about 20 requests per second shared by all
  users and asks clients to cache static data; the SDK keeps a 30-per-minute courtesy budget and
  caches station lists and levels for 24 hours. The provider truncates silently at 366 days per
  request (1,000 for tide tables); the SDK refuses windows over 7 days at 10-minute resolution, 31
  days hourly and 366 days for tide tables before sending anything. Times are requested with
  `tzone=0` and returned in UTC; the provider's default is Norwegian standard time.
- **Interpretation:** Away from a permanent gauge, values are modelled: the tidal prediction of a
  reference station scaled by a factor and shifted by a delay, plus the weather effect observed at a
  possibly different permanent gauge. The SDK surfaces those parameters in `location`. Values are
  heights above the stated reference level, normally in centimetres.
- **Change notices:** Changes are announced through Geonorge with about three months' notice; the
  provider states that new elements or parameters may be added to existing requests.

## Geonorge / Kartverket catalogue

- **Status:** Experimental in 0.8.0. Catalogue models, protocol labels and individual publishers'
  metadata quality vary independently of the SDK.
- **Supported methods:** `geodata.searchDatasets()`, `geodata.searchDatasetsAll()`,
  `geodata.searchServices()`, `geodata.searchServicesAll()`, `geodata.getMetadata()`,
  `geodata.getDataset()`, `geodata.getService()`
- **Official homepage:** https://www.geonorge.no/
- **Kartkatalog API:** https://kartkatalog.geonorge.no/swagger/index.html
- **Access:** Open anonymous for the fixed catalogue search and metadata endpoints; no credentials
  or caller identification are required.
- **Licence:** Kartverket states CC BY 4.0 for its own open products. Geonorge is a metadata
  catalogue, not an umbrella licence: catalogued resources keep their publisher-specific licence,
  access constraints and attribution requirements.
- **Attribution:** Credit © Kartverket for catalogue metadata and also follow each resource
  publisher's licence and attribution metadata.
- **Paging:** Search uses zero-based `offset`, defaults to 10 results, accepts at most 100 per page
  and orders by title for deterministic iteration. `searchDatasetsAll()` and
  `searchServicesAll()` remain bounded by caller-supplied `maxItems`/`maxPages` and the shared
  100-page safety cap.
- **Discovery boundary:** Dataset detail can classify published WFS, WMS, OGC API Features, ArcGIS
  REST, generic REST, download, Atom, offline and web links while retaining the provider's raw
  protocol label. The SDK returns those links as metadata only. It does not request capabilities,
  render WMS images, download files, call discovered services or accept one of those URLs as a
  caller-selected upstream.
- **Contract notes:** Metadata identifiers are path-encoded but are not assumed to be UUIDs.
  Bounding boxes with decimal commas and Unicode minus signs and dates without timezone offsets are
  normalized explicitly. Fully typed distributions come from the detail endpoint; ambiguous
  pipe-delimited search-result distribution strings are intentionally not treated as service
  contracts.
- **Request budget and caching:** Geonorge publishes no numeric Kartkatalog request limit. The SDK
  applies a 30-request-per-minute courtesy budget, caches search results for 10 minutes and metadata
  detail for one hour when caching is enabled.

## Miljødirektoratet / Naturbase

- **Status:** Experimental in 0.8.0, particularly the NiN and intervention-free WFS contracts.
- **Supported methods:** Point lookup, bounding-box search and bounded iteration for four selected
  datasets:
  - `environment.getProtectedAreasAt()`, `environment.searchProtectedAreas()`,
    `environment.iterateProtectedAreas()`
  - `environment.getProposedProtectedAreasAt()`, `environment.searchProposedProtectedAreas()`,
    `environment.iterateProposedProtectedAreas()`
  - `environment.getNatureTypesAt()`, `environment.searchNatureTypes()`,
    `environment.iterateNatureTypes()`
  - `environment.getInterventionFreeAreasAt()`, `environment.searchInterventionFreeAreas()`,
    `environment.iterateInterventionFreeAreas()`
- **Official homepage:** https://www.miljodirektoratet.no/
- **Map catalogue:** https://kartkatalog.miljodirektoratet.no/
- **Access:** Open anonymous for the fixed public ArcGIS REST and WFS layers used by the SDK.
- **Licence:** Norwegian Licence for Open Government Data (NLOD), as published for the selected
  datasets.
- **Attribution:** “Contains data made available by Miljødirektoratet under the Norwegian Licence
  for Open Government Data (NLOD).” The intervention-free layer carries the more specific
  `Miljødirektoratet - inngrepsfri natur 01.2023` wording. Retain each response/component `source`
  when redistributing results.
- **CRS:** Inputs and returned GeoJSON are WGS84. The provider performs conversion from the source
  EPSG:25833 data; `sourceCrs` retains that original declaration. Unsupported or conflicting CRS
  metadata raises `ResponseValidationError`; the SDK performs no client-side reprojection.
- **Paging:** Every call is explicitly bounded. The default result limit and page size are 100;
  responses expose `pagination.truncated` and continuation metadata. Iterators are lazy, propagate
  `AbortSignal` and stop repeated cursors, repeated contents or an empty page that claims another
  page exists.
- **Dataset scope:** “Nature types” means the modern NiN important/red-listed/central-ecosystem
  localities selected for this release, not every legacy or legally selected nature layer.
  Intervention-free nature is the latest January 2023 status only, with official zones 1, 2 and
  wilderness-like `v`. WMS rendering and the many other Naturbase map layers remain out of scope.
- **Request budget and caching:** Miljødirektoratet publishes no numeric request budget for these
  services. The SDK applies a 30-request-per-minute courtesy budget and conservative bounded spatial
  pages. When caching is enabled, protected/proposed/NiN data recommends six hours and the dated
  intervention-free layer recommends 24 hours.

## Norwegian Institute of Bioeconomy Research (NIBIO)

- **Status:** Experimental in 0.8.0. The public WFS/GML contract and schema remain provider-specific.
- **Supported methods:** `land.getLandResourcesAt()`, `land.searchLandResources()`,
  `land.iterateLandResources()`
- **Official homepage:** https://www.nibio.no/
- **AR50 WFS documentation:** https://www.nibio.no/tjenester/wfs-tjenester/wfs-tjeneste-ar50
- **Access:** Open anonymous for the supported AR50 WFS.
- **Licence:** Norwegian Licence for Open Government Data (NLOD) 1.0.
- **Attribution:** `Kilde: NIBIO.`
- **CRS:** The SDK requests WGS84 GML, validates its CRS and geometry, swaps the GML
  latitude/longitude axis order into GeoJSON longitude/latitude order, and validates the resulting
  rings strictly. `sourceCrs` preserves the WFS feature type's advertised EPSG:4258 default. It does
  not reproject coordinates locally or silently accept another CRS.
- **Paging:** Point and bounding-box operations default to 100 features and expose explicit
  `limit`, `pageSize`, `maxPages`, `offset` and truncation metadata. The iterator remains lazy and
  uses the same repeated-page and abort protections as Naturbase.
- **Dataset scope:** AR50 is a generalized land-resource map intended roughly for scales from
  1:20,000 to 1:100,000; areas below 15 decares may be merged into surrounding classes. It is not
  parcel-precision AR5. Returned properties preserve the provider's land-type, forest-productivity,
  tree-type, agriculture and vegetation-cover class codes. Restricted agreement-based Geovekst/AR5
  data, detailed agricultural-land records, soil and cultivation-suitability layers, and forest
  inventory products are excluded.
- **Request budget and caching:** NIBIO publishes no numeric WFS budget. The SDK applies a
  20-request-per-minute courtesy budget and a 24-hour provider cache recommendation.

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

- **Supported methods:** `weather.forecast()`, `weather.current()`, `weather.getWarnings()`,
  `weather.getNowcast()`, `weather.getSunTimes()`, `weather.getMoonTimes()`,
  `weather.getOceanForecast()`, `weather.getAirQualityForecast()`
- **Official homepage:** https://www.met.no/en
- **Getting started:** https://api.met.no/doc/GettingStarted
- **Product documentation:** Locationforecast 2.0, MetAlerts 2.0, Nowcast 2.0, Sunrise 3.0,
  Oceanforecast 2.0 and Airqualityforecast 0.1, each at
  `https://api.met.no/weatherapi/<product>/<version>/documentation`
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
- **Coverage, verified against the live service:** Nowcast answers HTTP 422 "outside the
  geographic area supported by the product" outside the Nordic radar area, which excludes Svalbard.
  Oceanforecast answers HTTP 422 outside its model area and HTTP 200 with `meta.error` and an empty
  series on land. Airqualityforecast answers HTTP 400 `{"detail":"unknown location: ..."}` outside
  Norway. The SDK resolves exactly these responses to `undefined` and reports any other 4xx as
  `ProviderError`.
- **MetAlerts:** Warnings carry CAP fields, MeteoAlarm awareness levels written as
  `"2; yellow; Moderate"`, county numbers that may omit a leading zero (`"3"` for Oslo), optional
  municipality lists and polygon or multipolygon areas. MetAlerts performs the point-in-area test for
  `lat`/`lon` queries itself. An empty result is never an all-clear.
- **Status:** `getAirQualityForecast()` is experimental: MET Norway versions the product 0.1.
  Measured air quality from NILU's API was evaluated and excluded: on 2026-10-15 its measurement
  endpoints answered HTTP 401 and its lookup endpoints HTTP 410, despite documentation describing it
  as open.

## MET Norway — Frost

- **Supported methods:** `climate.searchStations()`, `climate.getAvailableTimeSeries()`,
  `climate.getObservations()`, `climate.getLatestObservations()`, `climate.getClimateNormals()`
- **Official homepage:** https://frost.met.no/
- **API reference:** https://frost.met.no/api.html (Swagger document:
  https://frost.met.no/swagger.json)
- **Concepts:** https://frost.met.no/concepts2.html
- **Endpoints used:** `GET /sources/v0.jsonld`, `/observations/availableTimeSeries/v0.jsonld`,
  `/observations/v0.jsonld` and `/climatenormals/v0.jsonld` on https://frost.met.no
- **Access:** Free registration required for a client ID
  (https://frost.met.no/auth/requestCredentials.html), sent as the HTTP Basic username with an empty
  password. The SDK refuses a client ID containing a colon or non-ASCII characters before sending.
- **Licence:** Frost responses declare Creative Commons Attribution 3.0 Norway (CC BY 3.0 NO).
- **Attribution:** Credit the Norwegian Meteorological Institute (MET Norway).
- **Failure contract:** HTTP 404 means no data matched the query and, for observations, HTTP 412
  means no time series matched; the SDK resolves both to an empty array. HTTP 403 means too many
  observations were requested. HTTP 429 and 503 carry `Retry-After`, which the SDK obeys.
- **Known limits:** Frost publishes no numeric request budget; the SDK keeps a 30-per-minute
  courtesy budget. Observation windows are bounded to 31 days, or 366 days when every requested
  resolution is daily or coarser. Frost intervals are half-open, `[from, to)`.
- **Privacy:** Source metadata's `stationHolders` field is removed during response validation, so
  station-holder names reach neither callers, `raw` nor the cache.
- **Status:** Experimental. The schemas follow Frost's Swagger models; they were not verified
  against the live service because no client ID was available. The live probes verify them when
  `MET_FROST_CLIENT_ID` is configured.

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

## BarentsWatch — AIS

- **Supported methods:** `ais.getTrackLast24Hours()`, `ais.getTrack()`, `ais.getMmsiInArea()`,
  `ais.searchVessels()`, `ais.getLatestPositions()`, `ais.getVesselSnapshots()`,
  `ais.getVesselSnapshot()`, `ais.getCoverageArea()`, `ais.streamPositions()`,
  `ais.streamMessages()`, and the AIS components of `profiles.vessel()`
- **Classification:** Official Norwegian public-sector service. BarentsWatch is a national
  programme; the AIS data itself is supplied by the Norwegian Coastal Administration (Kystverket).
- **Provider homepage:** https://www.barentswatch.no/
- **API documentation:** https://developer.barentswatch.no/docs/AIS/live-ais-api/
- **OpenAPI documents:** https://live.ais.barentswatch.no/live/openapi/ais/openapi.json and
  https://historic.ais.barentswatch.no/open/openapi/ais/openapi.json
- **Endpoints:** `https://live.ais.barentswatch.no/live` for current positions and the streaming
  feeds; `https://historic.ais.barentswatch.no/open` for tracks, area search and name search.
- **Access:** OAuth2 client credentials required. Register an **AIS-client** at
  https://www.barentswatch.no/minside/ and configure it as `credentials["barentswatch-ais"]`.
  Tokens are requested from `https://id.barentswatch.no/connect/token` with
  `grant_type=client_credentials` and `scope=ais`. BarentsWatch documents two distinct client kinds
  — AIS-client and API-client — and a secret registered for one is not accepted by the other, which
  is why this SDK declares the AIS service and the rest of the platform as separate providers with
  separate credentials.
- **Licence:** Norwegian Licence for Open Government Data (NLOD), as stated in the API's own OpenAPI
  document.
- **Attribution:** Credit both BarentsWatch and the Norwegian Coastal Administration (Kystverket) as
  the data source.
- **Known limits:** Coverage is the Norwegian economic zone plus the fisheries protection zone around
  Svalbard and the protection zone around Jan Mayen. Fishing vessels under 15 m and leisure or
  sailing vessels under 45 m are excluded from the open feed. No data older than 14 days is retained;
  the provider directs requests for older data to https://kystdatahuset.no/. Consequently an empty
  track, an absent snapshot, or a `no-recent-data` vessel profile means only that BarentsWatch had
  nothing to publish — it is never evidence that an MMSI is unassigned or that a vessel does not
  exist. A transponder may also be switched off, and reception is not uniform across the area.
  `ais.getCoverageArea()` returns the published area so a caller can distinguish absence of data from
  absence of coverage. `ais.getMmsiInArea()` is capped upstream at a seven-day window and 500 square
  kilometres; the SDK rejects an oversized window before requesting, while an oversized area is
  refused upstream because the SDK cannot reproduce the provider's own area measure reliably enough to
  refuse a request the provider would have accepted. Streams are not retried, not cached and not
  reconnected automatically in this SDK version, and the configured timeout bounds establishing the
  connection rather than the lifetime of a healthy feed. The provider states that further AIS message
  types may be added, so `ais.streamMessages()` surfaces an unrecognized type as `kind: "unknown"`
  with its common fields rather than failing a running stream. Message labels are matched
  case-insensitively, because the live service sends `Staticdata` where the documentation writes
  `StaticData`; the numeric AIS message type is used as a second fallback. The `stream` field
  carries the provider's own receiver-network vocabulary (`terra` and `offshore` were observed
  live) and is passed through verbatim rather than normalized. Every field each documented message
  shape declares is validated and surfaced, including all 36 fields of the met/hydro binary
  broadcast, because a streamed message has no accompanying raw payload from which a dropped field
  could be recovered. BarentsWatch publishes no units for the met/hydro payload and its OpenAPI
  carries no field descriptions, so those values are passed through exactly as received with no
  conversion and no unit asserted by this SDK; the payload is the IMO met/hydro binary message
  (SN.1/Circ.289). Its enumerated fields (`airPressureTendency`, `waterLevelTrend`, `seaState`,
  `precipitationType`, `ice`) are kept as the provider's own labels rather than pinned to a fixed
  set, so a newly published member arrives intact instead of failing the stream.
- **Restricted access not supported:** The SDK exposes no protected AIS products, no vessel-tracking
  services beyond the documented open feed, and no server-sent-events endpoints.

## BarentsWatch — marine forecasts

- **Supported methods:** `marine.getWaveForecast()`, `marine.getWaveForecastSeries()`,
  `marine.getSeaCurrent()`
- **Classification:** Official Norwegian public-sector service.
- **Provider homepage:** https://www.barentswatch.no/
- **API documentation:** https://developer.barentswatch.no/docs/appreg/
- **OpenAPI document:** https://www.barentswatch.no/bwapi/openapi/waveforecast/openapi.json
- **Endpoint:** `https://www.barentswatch.no/bwapi`
- **Access:** OAuth2 client credentials required. Register an **API-client** at
  https://www.barentswatch.no/minside/ and configure it as `credentials.barentswatch`. Tokens use
  `scope=api`. An AIS-client secret is not accepted here; see the AIS section above.
- **Licence:** NLOD, as stated in the API's own OpenAPI document.
- **Attribution:** Credit BarentsWatch, and the forecast's upstream model provider where the response
  identifies one.
- **Known limits:** Forecasts come from numerical models covering the Norwegian coast, not the whole
  ocean. A coordinate outside every model area is answered with HTTP 204, which the SDK surfaces as
  `undefined` rather than an error so that "no model covers this point" stays distinguishable from a
  provider failure. The forecast series expresses the same thing in two different ways, both
  confirmed against the live service: HTTP 204 with no body, and HTTP 200 with one entry per model
  time whose every wave value is null. `marine.getWaveForecastSeries()` returns an empty array for
  both, dropping entries that carry no measurement at all, so an uncovered coordinate does not
  arrive looking like a covered one with dozens of readings; `{ includeRaw: true }` still exposes
  the provider's untouched payload. Unlike every wave field, a sea current's `speed` and
  `direction` are declared non-nullable upstream and are therefore always present on a returned
  forecast. The returned coordinate is the centre of the model grid cell that answered and may
  be some distance from the requested point. Models are rerun on a schedule measured in hours, so
  polling faster than the SDK's 30-minute cache lifetime gains nothing. Fields the provider documents
  as debugging-only (`source`, `fileSource`) are validated but not surfaced. Isolines, fairway
  forecasts, custom routes, Moskstraumen current products and the WMS layers are not wrapped.
- **Restricted access not supported:** No fairway upload, route-file parsing or write operations.

## Fiskeridirektoratet (Norwegian Directorate of Fisheries)

Two independently governed registers, declared as separate SDK providers because their base URLs,
paging models and contact teams differ, and exposed through one `fisheries` namespace because a
caller thinks of them as one agency. Their records stay separate types; a fishing vessel and an
aquaculture site are not forced into a shared model.

### Vessel register (Fartøyregisteret / Merkeregisteret)

- **Supported methods:** `fisheries.searchVessels()`, `fisheries.searchVesselsAll()`,
  `fisheries.getVessel()`, and the register component of `profiles.vessel()`
- **Classification:** Official Norwegian public-sector service.
- **Provider homepage:** https://www.fiskeridir.no/english
- **OpenAPI document:** https://api.fiskeridir.no/vessel-api/api/openapi.json
- **Endpoint:** `https://api.fiskeridir.no/vessel-api/api/v1/vessels`
- **Access:** Open anonymous. The register's own OpenAPI document describes it as
  "et åpent API for uthenting av fartøy- og eieropplysninger".
- **Licence:** Fiskeridirektoratet's data licence, published under NLOD terms
  (https://www.fiskeridir.no/Tall-og-analyse/Lisens-for-bruk-av-Fiskeridirektoratets-data).
- **Attribution:** Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).
- **Personal data:** The register publishes an owner's name, postal code and town for private
  individuals as well as companies. This SDK surfaces those fields only for `company` owners. A
  private owner is represented as `{ entityType: "person" }`, which preserves the ownership structure
  and owner count without redistributing a named natural person. The suppression happens during
  response validation, so it applies equally to `{ includeRaw: true }` and to cached values, and an
  owner entity type the SDK does not recognize is withheld by default. Callers who genuinely need the
  natural-person fields should read them from Fiskeridirektoratet directly under that agency's own
  terms.
- **Known limits:** The register lists active vessels only. `registrationMark` and `radioCallSign`
  are exact-match filters upstream: the register accepts a mark as `R 0062H` or `R-62-H` but not
  `R0062H`, so the SDK rewrites a compact mark into an accepted form and passes anything already
  containing a space or hyphen through untouched. The register reports its total count only in an
  `x-totalcount` response header, which this SDK does not read, so `pagination.hasMore` is derived
  from whether a page came back full and iteration stops at the first short page. `per_page` is
  capped upstream at 200.
- **Restricted access not supported:** No quota, catch-note, landing or licence-holder data requiring
  role-based access.

### Public aquaculture register (Akvakulturregisteret)

- **Supported methods:** `fisheries.searchAquacultureSites()`,
  `fisheries.searchAquacultureSitesAll()`, `fisheries.getAquacultureSite()`
- **Classification:** Official Norwegian public-sector service.
- **Provider homepage:** https://www.fiskeridir.no/english
- **API documentation:** https://api.fiskeridir.no/pub-aqua/api/swagger-ui/index.html
- **OpenAPI document:** https://api.fiskeridir.no/pub-aqua/api/api-docs
- **Endpoint:** `https://api.fiskeridir.no/pub-aqua/api/v1/sites`
- **Access:** Open anonymous.
- **Licence:** Fiskeridirektoratet's data licence, published under NLOD terms.
- **Attribution:** Credit the Norwegian Directorate of Fisheries (Fiskeridirektoratet).
- **Known limits:** The register pages by an inclusive offset range (`range=0-9`) and reports no
  total, so `pagination.hasMore` is derived from whether a page came back full. `capacity` is
  expressed in the unit named by `capacityUnitType` — `TN` for tonnes of maximum allowed biomass,
  other codes for other licence kinds — and is therefore not comparable across sites without checking
  the unit. `productionAreaStatus` is the traffic-light status published in Norwegian (`GRØNN`,
  `GUL`, `RØD`). The register documents `speciesType` and `speciesTypeValue` as retired and always
  null, so the SDK reads neither and uses `speciesTypes` instead. Licence, decision, lien, transfer,
  capacity-history, border-geometry, area and bulk-dump endpoints are not wrapped in this version.
- **Restricted access not supported:** No application submission, no aquaculture-application portal
  endpoints requiring registration, and no bulk XLSX or legacy CSV dumps.

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
