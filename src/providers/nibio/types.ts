import type { FeaturePagePagination } from "../../core/feature-page.js";
import type { BoundingBox, Coordinates } from "../../core/geo.js";
import type {
  GeoJsonCrsMetadata,
  GeoJsonFeature,
  GeoJsonMultiPolygon,
  GeoJsonPolygonGeometry,
} from "../../core/geojson.js";

/** Polygon geometry returned by AR50, including explicit missing geometry. */
export type LandResourceGeometry = GeoJsonPolygonGeometry | GeoJsonMultiPolygon | null;

/** CRS advertised as the AR50 WFS default before requested output conversion. */
export type NibioSourceCrs = {
  identifier: "EPSG:4258";
  uri: "http://www.opengis.net/def/crs/EPSG/0/4258";
  axisOrder: "latitude-longitude";
};

/** Safe bounds shared by NIBIO point and bounding-box requests. */
export type NibioFeatureQueryOptions = {
  /** Maximum features to return. Defaults to 100. */
  limit?: number;
  /** Maximum features requested from one WFS page. Defaults to 100. */
  pageSize?: number;
  /** Maximum WFS pages. Defaults to 100. */
  maxPages?: number;
  /** Zero-based WFS startIndex. Defaults to zero. */
  offset?: number;
};

/** Official AR50 land-type classification codes. */
export type Ar50LandTypeCode = "10" | "20" | "30" | "50" | "60" | "70" | "81" | "82" | "99";

/** Official AR50 forest-productivity classification codes. */
export type Ar50ForestProductivityCode = "11" | "12" | "13" | "18" | "98" | "99";

/** Official AR50 tree-type classification codes. */
export type Ar50TreeTypeCode = "31" | "32" | "33" | "39" | "98" | "99";

/** Official AR50 agricultural-potential classification codes. */
export type Ar50AgricultureCode = "24" | "25" | "98" | "99";

/** Official AR50 vegetation-cover classification codes. */
export type Ar50VegetationCoverCode = "51" | "52" | "53" | "54" | "55" | "98" | "99";

/** An AR50 point lookup in WGS84 decimal degrees. */
export type LandResourcePointQuery = Coordinates & NibioFeatureQueryOptions;

/** A bounded AR50 search in WGS84 decimal degrees. */
export type LandResourceBoundingBoxQuery = NibioFeatureQueryOptions & {
  boundingBox: BoundingBox;
};

/** AR50 source attributes, with documented class codes preserved exactly. */
export type LandResourceProperties = {
  id: string;
  objectType?: string;
  landTypeCode?: Ar50LandTypeCode;
  forestProductivityCode?: Ar50ForestProductivityCode;
  treeTypeCode?: Ar50TreeTypeCode;
  agricultureCode?: Ar50AgricultureCode;
  vegetationCoverCode?: Ar50VegetationCoverCode;
  information?: string;
  namespace?: string;
  updatedAt?: string;
};

/** One normalized AR50 land-resource feature. */
export type LandResourceFeature = GeoJsonFeature<LandResourceProperties, LandResourceGeometry>;

/** A bounded AR50 GeoJSON feature result. */
export type LandResourceResult = {
  type: "FeatureCollection";
  features: LandResourceFeature[];
  /** WGS84 CRS requested from the WFS and applied to the returned GeoJSON. */
  crs: GeoJsonCrsMetadata;
  /** Default CRS advertised by the upstream feature type. */
  sourceCrs: NibioSourceCrs;
  pagination: FeaturePagePagination;
};
