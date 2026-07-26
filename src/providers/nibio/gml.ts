import { ResponseValidationError } from "../../core/errors.js";
import {
  geoJsonLinearRingSchema,
  resolveGeoJsonCrs,
  type GeoJsonCrsMetadata,
  type GeoJsonLinearRing,
  type GeoJsonMultiPolygon,
  type GeoJsonPolygonGeometry,
} from "../../core/geojson.js";
import { nibioProvider } from "./provider.js";
import type {
  Ar50AgricultureCode,
  Ar50ForestProductivityCode,
  Ar50LandTypeCode,
  Ar50TreeTypeCode,
  Ar50VegetationCoverCode,
  LandResourceFeature,
  LandResourceGeometry,
  LandResourceProperties,
} from "./types.js";

const WFS_NAMESPACE = "http://www.opengis.net/wfs/2.0";
const GML_NAMESPACE = "http://www.opengis.net/gml/3.2";
const MAPSERVER_NAMESPACE = "http://mapserver.gis.umn.edu/mapserver";
const LAND_TYPE_CODES = new Set<Ar50LandTypeCode>([
  "10",
  "20",
  "30",
  "50",
  "60",
  "70",
  "81",
  "82",
  "99",
]);
const FOREST_PRODUCTIVITY_CODES = new Set<Ar50ForestProductivityCode>([
  "11",
  "12",
  "13",
  "18",
  "98",
  "99",
]);
const TREE_TYPE_CODES = new Set<Ar50TreeTypeCode>(["31", "32", "33", "39", "98", "99"]);
const AGRICULTURE_CODES = new Set<Ar50AgricultureCode>(["24", "25", "98", "99"]);
const VEGETATION_COVER_CODES = new Set<Ar50VegetationCoverCode>([
  "51",
  "52",
  "53",
  "54",
  "55",
  "98",
  "99",
]);

type XmlElement = {
  attributes: string;
  body: string;
};

/** Narrow result extracted from one AR50 WFS 2.0 GML FeatureCollection. */
export type ParsedAr50Page = {
  features: LandResourceFeature[];
  crs: GeoJsonCrsMetadata;
  numberMatched: number | "unknown";
  numberReturned: number;
};

function responseError(message: string, cause?: unknown): ResponseValidationError {
  return new ResponseValidationError(message, {
    provider: nibioProvider.id,
    ...(cause === undefined ? {} : { cause }),
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function decodeXml(value: string): string {
  const entityPattern = /&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/giu;
  if (value.replace(entityPattern, "").includes("&")) {
    throw responseError("NIBIO returned an unsupported XML entity.");
  }
  return value.replace(entityPattern, (entity) => {
    switch (entity.toLowerCase()) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&apos;":
        return "'";
      default: {
        const hexadecimal = entity.toLowerCase().startsWith("&#x");
        const digits = entity.slice(hexadecimal ? 3 : 2, -1);
        const codePoint = Number.parseInt(digits, hexadecimal ? 16 : 10);
        if (
          !Number.isSafeInteger(codePoint) ||
          codePoint < 0 ||
          codePoint > 0x10ffff ||
          (codePoint >= 0xd800 && codePoint <= 0xdfff)
        ) {
          throw responseError("NIBIO returned an invalid XML character reference.");
        }
        return String.fromCodePoint(codePoint);
      }
    }
  });
}

function attribute(attributes: string, name: string): string | undefined {
  const escapedName = escapeRegExp(name);
  const match = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "iu").exec(
    attributes,
  );
  return match?.[2] === undefined ? undefined : decodeXml(match[2]);
}

function namespacePrefix(xml: string, namespace: string): string {
  const declarations = [...xml.matchAll(/\sxmlns:([A-Za-z_][\w.-]*)\s*=\s*(["'])([\s\S]*?)\2/gu)];
  const declaration = declarations.find(
    (match) => match[3] !== undefined && decodeXml(match[3]) === namespace,
  );
  if (declaration?.[1] === undefined) {
    throw responseError(`NIBIO GML omitted the required ${namespace} namespace.`);
  }
  return declaration[1];
}

function tag(prefix: string, localName: string): string {
  return `${escapeRegExp(prefix)}:${escapeRegExp(localName)}`;
}

function elements(xml: string, qualifiedTag: string): XmlElement[] {
  const pattern = new RegExp(
    `<${qualifiedTag}\\b([^>]*)>([\\s\\S]*?)<\\/${qualifiedTag}\\s*>`,
    "giu",
  );
  return [...xml.matchAll(pattern)].map((match) => ({
    attributes: match[1] ?? "",
    body: match[2] ?? "",
  }));
}

function selfClosingElements(xml: string, qualifiedTag: string): XmlElement[] {
  const pattern = new RegExp(`<${qualifiedTag}\\b([^>]*)\\/\\s*>`, "giu");
  return [...xml.matchAll(pattern)].map((match) => ({
    attributes: match[1] ?? "",
    body: "",
  }));
}

function oneElement(xml: string, qualifiedTag: string, description: string): XmlElement {
  const matches = elements(xml, qualifiedTag);
  if (matches.length !== 1) {
    throw responseError(
      `NIBIO GML must contain exactly one ${description}; received ${matches.length}.`,
    );
  }
  const match = matches[0];
  if (match === undefined) {
    throw responseError(`NIBIO GML omitted ${description}.`);
  }
  return match;
}

function optionalElement(
  xml: string,
  qualifiedTag: string,
  description: string,
): XmlElement | undefined {
  const matches = [...elements(xml, qualifiedTag), ...selfClosingElements(xml, qualifiedTag)];
  if (matches.length > 1) {
    throw responseError(`NIBIO GML repeated ${description}; received ${matches.length} values.`);
  }
  return matches[0];
}

function scalar(
  xml: string,
  qualifiedTag: string,
  description: string,
  required = false,
): string | undefined {
  const element = optionalElement(xml, qualifiedTag, description);
  if (element === undefined) {
    if (required) throw responseError(`NIBIO GML omitted required ${description}.`);
    return undefined;
  }
  if (/<[A-Za-z_:]/u.test(element.body)) {
    throw responseError(`NIBIO GML returned nested markup inside ${description}.`);
  }
  const value = decodeXml(element.body).trim();
  if (value.length === 0) {
    if (required) throw responseError(`NIBIO GML returned empty ${description}.`);
    return undefined;
  }
  return value;
}

function nonNegativeInteger(value: string, description: string): number {
  if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw responseError(`NIBIO GML returned invalid ${description}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw responseError(`NIBIO GML returned unsafe ${description}.`);
  }
  return parsed;
}

function classificationCode<Code extends string>(
  value: string | undefined,
  allowed: ReadonlySet<Code>,
  description: string,
): Code | undefined {
  if (value === undefined) return undefined;
  if (!allowed.has(value as Code)) {
    throw responseError(`NIBIO returned undocumented AR50 ${description} code ${value}.`);
  }
  return value as Code;
}

function ensureEpsg4326(value: string): GeoJsonCrsMetadata {
  const crs = resolveGeoJsonCrs(value, nibioProvider.id);
  if (crs.identifier !== "EPSG:4326") {
    throw responseError("NIBIO returned a GML geometry outside the requested EPSG:4326 CRS.");
  }
  return crs;
}

function parseRing(container: string, gmlPrefix: string, description: string): GeoJsonLinearRing {
  const linearRing = oneElement(
    container,
    tag(gmlPrefix, "LinearRing"),
    `${description} LinearRing`,
  );
  const posList = oneElement(linearRing.body, tag(gmlPrefix, "posList"), `${description} posList`);
  const dimension = attribute(posList.attributes, "srsDimension");
  if (dimension !== undefined && dimension !== "2") {
    throw responseError(
      `NIBIO returned ${description} with unsupported coordinate dimension ${dimension}.`,
    );
  }
  const tokens = decodeXml(posList.body).trim().split(/\s+/u);
  if (tokens.length < 8 || tokens.length % 2 !== 0 || tokens.some((token) => token.length === 0)) {
    throw responseError(`NIBIO returned malformed two-dimensional coordinates for ${description}.`);
  }

  const coordinates: GeoJsonLinearRing = [];
  for (let index = 0; index < tokens.length; index += 2) {
    const latitude = Number(tokens[index]);
    const longitude = Number(tokens[index + 1]);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw responseError(`NIBIO returned a non-finite coordinate in ${description}.`);
    }
    // EPSG:4326 GML uses latitude-longitude axis order. GeoJSON is longitude-latitude.
    coordinates.push([longitude, latitude]);
  }

  const parsed = geoJsonLinearRingSchema.safeParse(coordinates);
  if (!parsed.success) {
    throw responseError(`NIBIO returned an invalid ${description}.`, parsed.error);
  }
  return parsed.data;
}

function parsePolygon(
  polygon: XmlElement,
  gmlPrefix: string,
  inheritedCrs: string | undefined,
): GeoJsonPolygonGeometry {
  const crsName = attribute(polygon.attributes, "srsName") ?? inheritedCrs;
  if (crsName === undefined) {
    throw responseError("NIBIO GML Polygon omitted srsName.");
  }
  ensureEpsg4326(crsName);
  const exterior = oneElement(polygon.body, tag(gmlPrefix, "exterior"), "Polygon exterior");
  const interiors = elements(polygon.body, tag(gmlPrefix, "interior"));
  return {
    type: "Polygon",
    coordinates: [
      parseRing(exterior.body, gmlPrefix, "Polygon exterior"),
      ...interiors.map((interior, index) =>
        parseRing(interior.body, gmlPrefix, `Polygon interior ${index + 1}`),
      ),
    ],
  };
}

function parseGeometry(
  featureBody: string,
  mapServerPrefix: string,
  gmlPrefix: string,
): { geometry: LandResourceGeometry; crs?: GeoJsonCrsMetadata } {
  const geometryElement = optionalElement(
    featureBody,
    tag(mapServerPrefix, "msGeometry"),
    "msGeometry",
  );
  if (geometryElement === undefined) return { geometry: null };

  const nil =
    attribute(geometryElement.attributes, "xsi:nil") ??
    attribute(geometryElement.attributes, "nil");
  if (nil === "true" || nil === "1" || geometryElement.body.trim().length === 0) {
    return { geometry: null };
  }

  const firstGeometry = new RegExp(
    `^\\s*<${escapeRegExp(gmlPrefix)}:(Polygon|MultiSurface)\\b([^>]*)>`,
    "iu",
  ).exec(geometryElement.body);
  if (firstGeometry?.[1] === undefined) {
    throw responseError(
      "NIBIO returned an unsupported GML geometry; AR50 supports Polygon and MultiSurface only.",
    );
  }

  if (firstGeometry[1].toLowerCase() === "polygon") {
    const polygon = oneElement(geometryElement.body, tag(gmlPrefix, "Polygon"), "Polygon geometry");
    const crsName = attribute(polygon.attributes, "srsName");
    if (crsName === undefined) throw responseError("NIBIO GML Polygon omitted srsName.");
    return {
      geometry: parsePolygon(polygon, gmlPrefix, undefined),
      crs: ensureEpsg4326(crsName),
    };
  }

  const multiSurface = oneElement(
    geometryElement.body,
    tag(gmlPrefix, "MultiSurface"),
    "MultiSurface geometry",
  );
  const crsName = attribute(multiSurface.attributes, "srsName");
  const polygons = elements(multiSurface.body, tag(gmlPrefix, "Polygon"));
  if (polygons.length === 0) {
    throw responseError("NIBIO returned an empty GML MultiSurface.");
  }
  const geometry: GeoJsonMultiPolygon = {
    type: "MultiPolygon",
    coordinates: polygons.map((polygon) => parsePolygon(polygon, gmlPrefix, crsName).coordinates),
  };
  const firstPolygon = polygons[0];
  if (firstPolygon === undefined) {
    throw responseError("NIBIO returned an empty GML MultiSurface.");
  }
  const firstPolygonCrs = attribute(firstPolygon.attributes, "srsName");
  const resolvedCrs = crsName ?? firstPolygonCrs;
  if (resolvedCrs === undefined) {
    throw responseError("NIBIO GML MultiSurface omitted srsName.");
  }
  return { geometry, crs: ensureEpsg4326(resolvedCrs) };
}

function optionalProperty(
  value: string | undefined,
  key: keyof LandResourceProperties,
): Partial<LandResourceProperties> {
  return value === undefined ? {} : { [key]: value };
}

function parseFeature(
  memberBody: string,
  mapServerPrefix: string,
  gmlPrefix: string,
): { feature: LandResourceFeature; crs?: GeoJsonCrsMetadata } {
  const featureElement = oneElement(memberBody, tag(mapServerPrefix, "AR50"), "AR50 feature");
  const localId = scalar(featureElement.body, tag(mapServerPrefix, "lokalid"), "lokalid", true);
  if (localId === undefined) {
    throw responseError("NIBIO GML omitted required lokalid.");
  }
  const upstreamId =
    attribute(featureElement.attributes, `${gmlPrefix}:id`) ??
    attribute(featureElement.attributes, "gml:id");
  if (upstreamId !== `AR50.${localId}`) {
    throw responseError("NIBIO returned an AR50 feature identifier inconsistent with lokalid.");
  }
  const parsedGeometry = parseGeometry(featureElement.body, mapServerPrefix, gmlPrefix);
  return {
    feature: {
      type: "Feature",
      id: upstreamId,
      geometry: parsedGeometry.geometry,
      properties: {
        id: localId,
        ...optionalProperty(
          scalar(featureElement.body, tag(mapServerPrefix, "objtype"), "objtype"),
          "objectType",
        ),
        ...optionalProperty(
          classificationCode(
            scalar(featureElement.body, tag(mapServerPrefix, "arealtype"), "arealtype"),
            LAND_TYPE_CODES,
            "arealtype",
          ),
          "landTypeCode",
        ),
        ...optionalProperty(
          classificationCode(
            scalar(featureElement.body, tag(mapServerPrefix, "skogbonitet"), "skogbonitet"),
            FOREST_PRODUCTIVITY_CODES,
            "skogbonitet",
          ),
          "forestProductivityCode",
        ),
        ...optionalProperty(
          classificationCode(
            scalar(featureElement.body, tag(mapServerPrefix, "treslag"), "treslag"),
            TREE_TYPE_CODES,
            "treslag",
          ),
          "treeTypeCode",
        ),
        ...optionalProperty(
          classificationCode(
            scalar(featureElement.body, tag(mapServerPrefix, "jordbruk"), "jordbruk"),
            AGRICULTURE_CODES,
            "jordbruk",
          ),
          "agricultureCode",
        ),
        ...optionalProperty(
          classificationCode(
            scalar(
              featureElement.body,
              tag(mapServerPrefix, "vegetasjonsdekke"),
              "vegetasjonsdekke",
            ),
            VEGETATION_COVER_CODES,
            "vegetasjonsdekke",
          ),
          "vegetationCoverCode",
        ),
        ...optionalProperty(
          scalar(featureElement.body, tag(mapServerPrefix, "informasjon"), "informasjon"),
          "information",
        ),
        ...optionalProperty(
          scalar(featureElement.body, tag(mapServerPrefix, "navnerom"), "navnerom"),
          "namespace",
        ),
        ...optionalProperty(
          scalar(featureElement.body, tag(mapServerPrefix, "oppdateringsdato"), "oppdateringsdato"),
          "updatedAt",
        ),
      },
    },
    ...(parsedGeometry.crs === undefined ? {} : { crs: parsedGeometry.crs }),
  };
}

function collectionCrs(xml: string, gmlPrefix: string): GeoJsonCrsMetadata | undefined {
  const envelope = elements(xml, tag(gmlPrefix, "Envelope"))[0];
  const crsName = envelope === undefined ? undefined : attribute(envelope.attributes, "srsName");
  return crsName === undefined ? undefined : ensureEpsg4326(crsName);
}

/**
 * Parses the deliberately narrow WFS 2.0 / GML 3.2 shape returned by AR50.
 *
 * This avoids a DOM dependency so the provider remains portable to Node, Deno,
 * Bun and browser-like runtimes. It is not a general XML or GML parser.
 */
export function parseAr50Gml(xml: string): ParsedAr50Page {
  if (xml.trim().length === 0 || /<!DOCTYPE|<!ENTITY|\0/iu.test(xml)) {
    throw responseError("NIBIO returned unsafe or empty XML.");
  }
  if (
    /<(?:[A-Za-z_][\w.-]*:)?(?:ExceptionReport|ServiceExceptionReport|ExceptionText)\b/iu.test(xml)
  ) {
    throw responseError("NIBIO returned a WFS exception document.");
  }

  const wfsPrefix = namespacePrefix(xml, WFS_NAMESPACE);
  const gmlPrefix = namespacePrefix(xml, GML_NAMESPACE);
  const mapServerPrefix = namespacePrefix(xml, MAPSERVER_NAMESPACE);
  const collectionOpening = new RegExp(
    `<${tag(wfsPrefix, "FeatureCollection")}\\b([^>]*)>`,
    "iu",
  ).exec(xml);
  if (collectionOpening?.[1] === undefined) {
    throw responseError("NIBIO GML omitted the WFS FeatureCollection.");
  }
  if (!new RegExp(`</${tag(wfsPrefix, "FeatureCollection")}\\s*>\\s*$`, "iu").test(xml)) {
    throw responseError("NIBIO returned an incomplete WFS FeatureCollection.");
  }

  const rawMatched = attribute(collectionOpening[1], "numberMatched");
  const rawReturned = attribute(collectionOpening[1], "numberReturned");
  if (rawMatched === undefined || rawReturned === undefined) {
    throw responseError("NIBIO GML omitted numberMatched or numberReturned pagination metadata.");
  }
  const numberMatched =
    rawMatched === "unknown" ? "unknown" : nonNegativeInteger(rawMatched, "numberMatched");
  const numberReturned = nonNegativeInteger(rawReturned, "numberReturned");

  const members = elements(xml, tag(wfsPrefix, "member"));
  if (members.length !== numberReturned) {
    throw responseError("NIBIO numberReturned does not match the AR50 feature count.");
  }

  let crs = collectionCrs(xml, gmlPrefix);
  const features = members.map((member) => {
    const parsed = parseFeature(member.body, mapServerPrefix, gmlPrefix);
    if (crs !== undefined && parsed.crs !== undefined && crs.identifier !== parsed.crs.identifier) {
      throw responseError("NIBIO changed CRS within one AR50 feature page.");
    }
    crs ??= parsed.crs;
    return parsed.feature;
  });

  return {
    features,
    crs: crs ?? ensureEpsg4326("EPSG:4326"),
    numberMatched,
    numberReturned,
  };
}
