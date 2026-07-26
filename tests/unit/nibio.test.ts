import { describe, expect, it, vi } from "vitest";

import { HttpClient } from "../../src/core/client.js";
import { ProviderError, ResponseValidationError } from "../../src/core/errors.js";
import { NibioClient } from "../../src/providers/nibio/client.js";
import { parseAr50Gml } from "../../src/providers/nibio/gml.js";
import { resolvedConfig, sequenceFetch } from "./helpers.js";

const exterior = "59 10 59 11 60 11 60 10 59 10";
const interior = "59.2 10.2 59.2 10.4 59.4 10.4 59.4 10.2 59.2 10.2";

function polygon(id: string, withHole = false, crs = "urn:ogc:def:crs:EPSG::4326"): string {
  return `<gml:Polygon gml:id="AR50.${id}.1" srsName="${crs}"><gml:exterior><gml:LinearRing><gml:posList srsDimension="2">${exterior}</gml:posList></gml:LinearRing></gml:exterior>${withHole ? `<gml:interior><gml:LinearRing><gml:posList srsDimension="2">${interior}</gml:posList></gml:LinearRing></gml:interior>` : ""}</gml:Polygon>`;
}

function feature(id: string, geometry: string | null = polygon(id)): string {
  return `<wfs:member><ms:AR50 gml:id="AR50.${id}">${
    geometry === null
      ? '<ms:msGeometry xsi:nil="true"/>'
      : `<ms:msGeometry>${geometry}</ms:msGeometry>`
  }<ms:lokalid>${id}</ms:lokalid><ms:objtype>ArealressursFlate</ms:objtype><ms:arealtype>10</ms:arealtype><ms:skogbonitet>98</ms:skogbonitet><ms:treslag>98</ms:treslag><ms:jordbruk>98</ms:jordbruk><ms:vegetasjonsdekke>98</ms:vegetasjonsdekke><ms:informasjon>A &amp; B</ms:informasjon><ms:navnerom>NO_NIBIO_AR50_2024</ms:navnerom><ms:oppdateringsdato>2023-04-19 00:00:00</ms:oppdateringsdato></ms:AR50></wfs:member>`;
}

function collection(
  members: string[],
  numberMatched: number | "unknown" = members.length,
  collectionCrs = "urn:ogc:def:crs:EPSG::4326",
): string {
  return `<?xml version="1.0" encoding="UTF-8"?><wfs:FeatureCollection xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:ms="http://mapserver.gis.umn.edu/mapserver" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" numberMatched="${numberMatched}" numberReturned="${members.length}"><wfs:boundedBy><gml:Envelope srsName="${collectionCrs}"><gml:lowerCorner>59 10</gml:lowerCorner><gml:upperCorner>60 11</gml:upperCorner></gml:Envelope></wfs:boundedBy>${members.join("")}</wfs:FeatureCollection>`;
}

function xmlResponse(xml: string): Response {
  return new Response(xml, {
    headers: { "Content-Type": 'text/xml; subtype="gml/3.2.1"; charset=UTF-8' },
  });
}

function clientFor(fetch: typeof globalThis.fetch): NibioClient {
  return new NibioClient(new HttpClient(resolvedConfig(fetch)));
}

describe("AR50 GML parser", () => {
  it("converts EPSG:4326 latitude-longitude GML and preserves polygon holes", () => {
    const result = parseAr50Gml(collection([feature("3165365", polygon("3165365", true))]));

    expect(result.features[0]).toMatchObject({
      id: "AR50.3165365",
      properties: {
        id: "3165365",
        objectType: "ArealressursFlate",
        landTypeCode: "10",
        information: "A & B",
      },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [10, 59],
            [11, 59],
            [11, 60],
            [10, 60],
            [10, 59],
          ],
          [
            [10.2, 59.2],
            [10.4, 59.2],
            [10.4, 59.4],
            [10.2, 59.4],
            [10.2, 59.2],
          ],
        ],
      },
    });
    expect(result.crs).toMatchObject({
      identifier: "EPSG:4326",
      axisOrder: "longitude-latitude",
      original: "urn:ogc:def:crs:EPSG::4326",
    });
  });

  it("converts MultiSurface to MultiPolygon and accepts null geometry", () => {
    const multiSurface = `<gml:MultiSurface srsName="urn:ogc:def:crs:EPSG::4326"><gml:surfaceMember>${polygon("1")}</gml:surfaceMember><gml:surfaceMember>${polygon("2")}</gml:surfaceMember></gml:MultiSurface>`;
    const result = parseAr50Gml(collection([feature("1", multiSurface), feature("2", null)]));

    expect(result.features[0]?.geometry).toMatchObject({
      type: "MultiPolygon",
    });
    expect(
      result.features[0]?.geometry?.type === "MultiPolygon"
        ? result.features[0].geometry.coordinates
        : [],
    ).toHaveLength(2);
    expect(result.features[1]?.geometry).toBeNull();
  });

  it("rejects unsupported CRS metadata and WFS exception documents", () => {
    expect(() =>
      parseAr50Gml(collection([feature("1", polygon("1", false, "EPSG:25833"))], 1, "EPSG:25833")),
    ).toThrow(ResponseValidationError);
    expect(() =>
      parseAr50Gml(
        '<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1"><ows:ExceptionText>bad filter</ows:ExceptionText></ows:ExceptionReport>',
      ),
    ).toThrow(ResponseValidationError);
  });

  it("rejects undocumented AR50 classification codes", () => {
    const invalid = feature("1").replace(
      "<ms:arealtype>10</ms:arealtype>",
      "<ms:arealtype>42</ms:arealtype>",
    );
    expect(() => parseAr50Gml(collection([invalid]))).toThrow(ResponseValidationError);
  });
});

describe("NibioClient", () => {
  it("uses a fixed AR50 WFS point filter and returns explicit CRS metadata", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => {
      void _input;
      return xmlResponse(collection([feature("3165365")]));
    });
    const result = await clientFor(fetch as typeof globalThis.fetch).getLandResourcesAt({
      latitude: 59.91,
      longitude: 10.75,
      limit: 1,
    });

    const request = new URL(String(fetch.mock.calls[0]?.[0]));
    expect(request.origin).toBe("https://wfs.nibio.no");
    expect(request.pathname).toBe("/cgi-bin/ar50_2");
    expect(request.searchParams.get("TYPENAMES")).toBe("ms:AR50");
    expect(request.searchParams.get("SRSNAME")).toBe("EPSG:4326");
    expect(request.searchParams.get("SORTBY")).toBe("lokalid");
    expect(request.searchParams.get("COUNT")).toBe("1");
    const filter = request.searchParams.get("FILTER") ?? "";
    expect(filter).toContain("<fes:Intersects>");
    expect(filter).toContain("<fes:ValueReference>msGeometry</fes:ValueReference>");
    expect(filter).toContain("<gml:pos>10.75 59.91</gml:pos>");
    expect(result.data.features[0]?.id).toBe("AR50.3165365");
    expect(result.data.crs.identifier).toBe("EPSG:4326");
    expect(result.data.sourceCrs).toMatchObject({
      identifier: "EPSG:4258",
      axisOrder: "latitude-longitude",
    });
    expect(result.source.attribution).toBe("Kilde: NIBIO.");
    expect(result.source.license).toContain("NLOD");
  });

  it("paginates bbox searches with count/startIndex and exact numberMatched", async () => {
    const { fetch, mock } = sequenceFetch(
      xmlResponse(collection([feature("1")], 2)),
      xmlResponse(collection([feature("2")], 2)),
    );
    const result = await clientFor(fetch).searchLandResources({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 2,
      pageSize: 1,
    });

    const first = new URL(String(mock.mock.calls[0]?.[0]));
    const second = new URL(String(mock.mock.calls[1]?.[0]));
    const filter = first.searchParams.get("FILTER") ?? "";
    expect(filter).toContain("<gml:Polygon");
    expect(filter).toContain(
      '<gml:posList srsDimension="2">10 59 11 59 11 60 10 60 10 59</gml:posList>',
    );
    expect(first.searchParams.get("STARTINDEX")).toBe("0");
    expect(second.searchParams.get("STARTINDEX")).toBe("1");
    expect(result.data.features.map((item) => item.id)).toEqual(["AR50.1", "AR50.2"]);
    expect(result.data.pagination).toMatchObject({
      pagesFetched: 2,
      returned: 2,
      truncated: false,
    });
  });

  it("uses conservative truncation when numberMatched is unknown", async () => {
    const fetch = vi.fn(async () => xmlResponse(collection([feature("1")], "unknown")));
    const result = await clientFor(fetch as typeof globalThis.fetch).searchLandResources({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 1,
      pageSize: 1,
    });

    expect(result.data.pagination).toMatchObject({
      returned: 1,
      truncated: true,
      nextOffset: 1,
    });
  });

  it("returns an empty complete result and aborts before fetch", async () => {
    const empty = await clientFor(
      vi.fn(async () => xmlResponse(collection([]))) as typeof globalThis.fetch,
    ).searchLandResources({
      boundingBox: { west: 10, south: 59, east: 11, north: 60 },
      limit: 10,
    });
    expect(empty.data.features).toEqual([]);
    expect(empty.data.pagination.truncated).toBe(false);

    const fetch = vi.fn();
    const controller = new AbortController();
    controller.abort("test cancellation");
    await expect(
      clientFor(fetch as typeof globalThis.fetch).getLandResourcesAt(
        { latitude: 59.91, longitude: 10.75, limit: 1 },
        { signal: controller.signal },
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
