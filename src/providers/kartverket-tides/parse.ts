/**
 * Converts the tide API's XML into the SDK's types.
 *
 * Kartverket publishes no XML schema for this API, so the shapes accepted here
 * are the ones its protocol document and live responses use. Every attribute the
 * SDK reads is validated; elements and attributes it does not read are ignored,
 * because the provider states that new ones may be added to existing requests.
 */
import { z } from "zod";

import { ProviderError, ResponseValidationError } from "../../core/errors.js";
import { parseXml, xmlChild, xmlChildren, type XmlElement } from "../../core/xml.js";
import { kartverketTidesProvider as provider } from "./provider.js";
import type {
  TideEvent,
  TideLevel,
  TideLocation,
  TideStation,
  WaterLevelSeries,
  WaterLevelValue,
} from "./types.js";

const timestampSchema = z.iso.datetime({ offset: true });
const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

function optional<K extends string, T>(key: K, value: T | undefined): Partial<Record<K, T>> {
  return value === undefined ? {} : ({ [key]: value } as Record<K, T>);
}

function invalid(message: string): ResponseValidationError {
  return new ResponseValidationError(`Kartverket's tide API ${message}`, { provider: provider.id });
}

function optionalAttribute(element: XmlElement, name: string): string | undefined {
  const value = element.attributes[name]?.trim();
  return value === undefined || value.length === 0 ? undefined : value;
}

function requiredAttribute(element: XmlElement, name: string): string {
  const value = optionalAttribute(element, name);
  if (value === undefined) throw invalid(`omitted "${name}" on <${element.name}>.`);
  return value;
}

function decimal(element: XmlElement, name: string, value: string): number {
  if (!DECIMAL_PATTERN.test(value)) {
    throw invalid(`sent a non-numeric "${name}" on <${element.name}>.`);
  }
  return Number(value);
}

function numberAttribute(element: XmlElement, name: string): number {
  return decimal(element, name, requiredAttribute(element, name));
}

function optionalNumberAttribute(element: XmlElement, name: string): number | undefined {
  const value = optionalAttribute(element, name);
  return value === undefined ? undefined : decimal(element, name, value);
}

function timestampAttribute(element: XmlElement, name: string): string {
  const value = requiredAttribute(element, name);
  if (!timestampSchema.safeParse(value).success) {
    throw invalid(`sent an invalid "${name}" timestamp on <${element.name}>.`);
  }
  return value;
}

function requiredChild(element: XmlElement, name: string): XmlElement {
  const child = xmlChild(element, name);
  if (child === undefined) throw invalid(`omitted <${name}> from <${element.name}>.`);
  return child;
}

/**
 * Parses a response and returns its `<tide>` root.
 *
 * The API reports invalid parameters as an HTTP 200 whose document is a bare
 * `<error>` element; that is raised as a {@link ProviderError} carrying the
 * provider's own explanation.
 */
export function parseTideDocument(xml: string): XmlElement {
  const root = parseXml(xml, { provider: provider.id });
  if (root.name === "error") {
    const reason = root.text.trim();
    throw new ProviderError(
      `Kartverket's tide API rejected the request: ${reason.length === 0 ? "no reason given" : reason}.`,
      { provider: provider.id },
    );
  }
  if (root.name !== "tide") throw invalid(`returned <${root.name}> instead of <tide>.`);
  return root;
}

/** Collects the service notices attached to a response. */
export function serviceMessages(root: XmlElement): string[] {
  return xmlChildren(root, "service").flatMap((element) =>
    ["info", "cominfo"].flatMap((name) => {
      const value = optionalAttribute(element, name);
      return value === undefined ? [] : [value];
    }),
  );
}

/** Whether a data element says the position has no sea-level data. */
export function hasNoData(element: XmlElement): boolean {
  return xmlChild(element, "nodata") !== undefined;
}

function parseLocation(element: XmlElement): TideLocation {
  return {
    name: requiredAttribute(element, "name"),
    code: requiredAttribute(element, "code"),
    latitude: numberAttribute(element, "latitude"),
    longitude: numberAttribute(element, "longitude"),
    ...optional("factor", optionalNumberAttribute(element, "factor")),
    ...optional("delayMinutes", optionalNumberAttribute(element, "delay")),
    ...optional("surgeStationName", optionalAttribute(element, "obsname")),
    ...optional("surgeStationCode", optionalAttribute(element, "obscode")),
    // The protocol document notes that `desc` and `descr` are being harmonized.
    ...optional(
      "description",
      optionalAttribute(element, "descr") ?? optionalAttribute(element, "desc"),
    ),
  };
}

/** Parses the permanent-station list. */
export function parseStations(root: XmlElement): TideStation[] {
  const list = requiredChild(root, "stationinfo");
  // Live responses use <location>; the protocol document's example uses <station>.
  return list.children
    .filter((child) => child.name === "location" || child.name === "station")
    .map((element) => ({
      code: requiredAttribute(element, "code"),
      name: requiredAttribute(element, "name"),
      latitude: numberAttribute(element, "latitude"),
      longitude: numberAttribute(element, "longitude"),
      ...optional("type", optionalAttribute(element, "type")),
    }));
}

function parseValue(element: XmlElement): WaterLevelValue {
  const lowerPercentile = optionalNumberAttribute(element, "lowerpercentile");
  const lowPercentile = optionalNumberAttribute(element, "lowpercentile");
  const highPercentile = optionalNumberAttribute(element, "highpercentile");
  const higherPercentile = optionalNumberAttribute(element, "higherpercentile");
  const hasUncertainty = [lowerPercentile, lowPercentile, highPercentile, higherPercentile].some(
    (value) => value !== undefined,
  );
  return {
    time: timestampAttribute(element, "time"),
    value: numberAttribute(element, "value"),
    ...optional("flag", optionalAttribute(element, "flag")),
    ...(hasUncertainty
      ? {
          uncertainty: {
            ...optional("lowerPercentile", lowerPercentile),
            ...optional("lowPercentile", lowPercentile),
            ...optional("highPercentile", highPercentile),
            ...optional("higherPercentile", higherPercentile),
          },
        }
      : {}),
  };
}

function parseSeries(element: XmlElement): WaterLevelSeries {
  const qualityFlag = optionalNumberAttribute(element, "qualityFlag");
  return {
    type: requiredAttribute(element, "type"),
    unit: requiredAttribute(element, "unit"),
    ...(qualityFlag === undefined
      ? {}
      : {
          quality: {
            flag: qualityFlag,
            ...optional("class", optionalAttribute(element, "qualityClass")),
            ...optional("description", optionalAttribute(element, "qualityDescription")),
          },
        }),
    values: xmlChildren(element, "waterlevel").map(parseValue),
  };
}

/** The parts of a `locationdata` response the SDK uses. */
export type ParsedLocationData = {
  location: TideLocation;
  referenceLevel: string;
  series: WaterLevelSeries[];
};

/**
 * Parses a `locationdata` response, or returns `undefined` when Kartverket says
 * it has no sea-level data for the position, such as inland or far offshore.
 */
export function parseLocationData(root: XmlElement): ParsedLocationData | undefined {
  const data = requiredChild(root, "locationdata");
  if (hasNoData(data)) return undefined;
  const referenceLevel = requiredChild(data, "reflevelcode").text.trim();
  if (referenceLevel.length === 0) throw invalid("sent an empty reference level code.");
  return {
    location: parseLocation(requiredChild(data, "location")),
    referenceLevel,
    series: xmlChildren(data, "data").map(parseSeries),
  };
}

/** Converts a tide-table series into high and low events. */
export function tideEvents(series: readonly WaterLevelSeries[]): {
  unit: string;
  events: TideEvent[];
} {
  const [prediction, ...rest] = series;
  if (prediction === undefined || rest.length > 0) {
    throw invalid(`returned ${series.length} series for a tide table instead of one.`);
  }
  return {
    unit: prediction.unit,
    events: prediction.values.map((value) => {
      if (value.flag !== "high" && value.flag !== "low") {
        throw invalid(`marked a tide-table entry "${value.flag ?? ""}" instead of high or low.`);
      }
      return { time: value.time, value: value.value, kind: value.flag };
    }),
  };
}

/** The parts of a `locationlevels` response the SDK uses. */
export type ParsedLocationLevels = {
  location: TideLocation;
  referenceLevel: string;
  unit: string;
  levels: TideLevel[];
};

/**
 * Parses a `locationlevels` response, or returns `undefined` when Kartverket says
 * it has no sea-level data for the position.
 */
export function parseLocationLevels(root: XmlElement): ParsedLocationLevels | undefined {
  const container = requiredChild(root, "locationlevel");
  if (hasNoData(container)) return undefined;
  return {
    location: parseLocation(requiredChild(container, "location")),
    referenceLevel: requiredAttribute(container, "reflevel"),
    unit: requiredAttribute(container, "unit"),
    levels: xmlChildren(container, "reflevel").map((element) => ({
      code: requiredAttribute(element, "code"),
      name: requiredAttribute(element, "name"),
      ...optional(
        "description",
        optionalAttribute(element, "descr") ?? optionalAttribute(element, "desc"),
      ),
      value: numberAttribute(element, "value"),
      type: requiredAttribute(element, "type"),
      ...optional("info", optionalAttribute(element, "info")),
      ...optional("epoch", optionalAttribute(element, "epoch")),
    })),
  };
}
