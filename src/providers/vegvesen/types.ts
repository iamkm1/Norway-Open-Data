/** Official NVDB road categories in the national road-reference system. */
export type RoadCategory = "E" | "R" | "F" | "K" | "P" | "S";

/** Filters accepted by an NVDB road-object search. */
export type RoadObjectSearchParameters = {
  /** Numeric road-object type ID from the NVDB data catalogue. */
  typeId: number;
  municipalityCode?: string;
  countyCode?: string;
  /** NVDB road-system reference, for example `EV6S1D1`. */
  roadReference?: string;
  /** WGS84 `[minLongitude, minLatitude, maxLongitude, maxLatitude]`. */
  boundingBox?: [number, number, number, number];
  pageSize?: number;
  /** Opaque continuation marker returned by the preceding response. */
  start?: string;
};

/** Filters accepted when reading segmented NVDB road-network links. */
export type RoadNetworkParameters = {
  municipalityCode?: string;
  countyCode?: string;
  /** WGS84 `[minLongitude, minLatitude, maxLongitude, maxLatitude]`. */
  boundingBox?: [number, number, number, number];
  /** Existing-road categories. They map to NVDB references EV/RV/FV/KV/PV/SV. */
  roadCategory?: RoadCategory[];
  pageSize?: number;
  /** Opaque continuation marker returned by the preceding response. */
  start?: string;
};

/** A dynamic NVDB road-object property. */
export type RoadObjectProperty = {
  id?: number;
  name: string;
  /** Provider-defined value; its shape depends on the road-object type. */
  value: unknown;
  unit?: string;
};

/** Geometry supplied by NVDB without guessing a common geometry model. */
export type RoadGeometry = {
  wkt?: string;
  geoJson?: unknown;
};

/** Location metadata attached to an NVDB road object. */
export type RoadObjectLocation = {
  municipalityCodes?: string[];
  countyCodes?: string[];
  roadReferences?: string[];
  geometry?: RoadGeometry;
};

/** A normalized public road object from NVDB. */
export type RoadObject = {
  id: number;
  typeId: number;
  typeName?: string;
  version?: number;
  properties: RoadObjectProperty[];
  location?: RoadObjectLocation;
};

/** Public property metadata from an NVDB road-object type. */
export type RoadObjectPropertyType = {
  id: number;
  name: string;
  description?: string;
  valueType?: string;
  required?: boolean;
  unit?: string;
};

/** Public road-object type metadata from the NVDB data catalogue. */
export type RoadObjectType = {
  id: number;
  name: string;
  shortName?: string;
  description?: string;
  status?: string;
  categories: string[];
  properties: RoadObjectPropertyType[];
  /** Always false for results exposed by this SDK; sensitive types are rejected. */
  sensitive: false;
};

/** Provider pagination data shared by road-object and road-network searches. */
export type RoadPagination = {
  returned: number;
  pageSize: number;
  totalItems?: number;
  nextStart?: string;
  nextUrl?: string;
};

/** One page of normalized NVDB road objects. */
export type RoadObjectSearchResult = {
  items: RoadObject[];
  pagination: RoadPagination;
};

/** A normalized segment from NVDB's segmented road network. */
export type RoadNetworkSegment = {
  sequenceId: number;
  linkNumber?: number;
  segmentNumber?: number;
  startPosition?: number;
  endPosition?: number;
  length?: number;
  roadType?: string;
  detailLevel?: string;
  municipalityCode?: string;
  countyCode?: string;
  roadReference?: string;
  geometry?: RoadGeometry;
};

/** One page from NVDB's segmented road network. */
export type RoadNetworkResult = {
  items: RoadNetworkSegment[];
  pagination: RoadPagination;
};
