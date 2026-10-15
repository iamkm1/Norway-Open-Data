import { describe, expect, it } from "vitest";

import { ResponseValidationError } from "../../src/index.js";
import { parseXml, xmlChild, xmlChildren } from "../../src/core/xml.js";

/** Returns what a synchronous call throws, so its fields can be matched. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const STATION_LIST = `<tide xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
xsi:noNamespaceSchemaLocation="http://api.sehavniva.no/stationinfo.xsd">
<meta licenseurl="http://kartverket.no/data/lisens/"/>
<stationinfo>
<location name="Andenes" code="ANX" latitude="69.326067" longitude="16.134848" type="PERM"/>
<location name="Bodø" code="BOO" latitude="67.292330" longitude="14.399770" type="PERM"/>
</stationinfo>
</tide>`;

describe("parseXml", () => {
  it("parses elements, prefixed attributes and nesting from a provider document", () => {
    const root = parseXml(STATION_LIST);

    expect(root.name).toBe("tide");
    expect(root.attributes["xsi:noNamespaceSchemaLocation"]).toBe(
      "http://api.sehavniva.no/stationinfo.xsd",
    );
    expect(xmlChild(root, "meta")?.attributes["licenseurl"]).toBe(
      "http://kartverket.no/data/lisens/",
    );
    const stations = xmlChildren(xmlChild(root, "stationinfo") ?? root, "location");
    expect(stations.map((station) => station.attributes["name"])).toEqual(["Andenes", "Bodø"]);
    expect(stations[1]?.children).toEqual([]);
    expect(xmlChild(root, "missing")).toBeUndefined();
  });

  it("decodes predefined entities and numeric references in attributes and text", () => {
    const root = parseXml(
      `<?xml version="1.0"?><tide><nodata info="N61°30.0&apos; &amp; &#69;&#x39;"/>` +
        `<error>Position &lt;outside&gt; &quot;area&quot;</error></tide>`,
    );

    expect(xmlChild(root, "nodata")?.attributes["info"]).toBe("N61°30.0' & E9");
    expect(xmlChild(root, "error")?.text).toBe('Position <outside> "area"');
  });

  it("skips a byte-order mark, comments and processing instructions and keeps CDATA", () => {
    const root = parseXml(
      '﻿<?xml version="1.0" encoding="utf-8"?>\n<!-- generated -->\n' +
        "<root><?render fast?><a>one<!-- inner -->two<![CDATA[<three & four>]]></a></root>\n" +
        "<!-- trailing -->\n",
    );

    expect(xmlChild(root, "a")?.text).toBe("onetwo<three & four>");
  });

  it("normalizes literal line breaks and tabs inside attribute values", () => {
    const root = parseXml("<a note='first\nsecond\tthird'/>");
    expect(root.attributes["note"]).toBe("first second third");
  });

  it("keeps whitespace text but ignores whitespace around the root", () => {
    const root = parseXml("  \n<a> padded </a>\n  ");
    expect(root.text).toBe(" padded ");
  });

  it.each([
    ['<!DOCTYPE a [<!ENTITY x "boom">]><a>&x;</a>', "document type"],
    ["<a>&x;</a>", 'undeclared entity "&x;"'],
    ["<a>AT&T</a>", "unterminated entity"],
    ["<a>&#0;</a>", "invalid character"],
    ["<a>&#xD800;</a>", "invalid character"],
    ["<a>&#1114112;</a>", "invalid character"],
    ["<a><b></a>", "closes <a>"],
    ["<a></b>", "closes <b>"],
    ["<a>", "ends before <a> is closed"],
    ["<a/><b/>", "more than one root"],
    ["text<a/>", "character data outside the root"],
    ["<a/>trailing", "character data outside the root"],
    ["<![CDATA[x]]><a/>", "character data outside the root"],
    ['<a x="1" x="2"/>', 'repeats the attribute "x"'],
    ["<a x=1/>", "unquoted attribute value"],
    ["<a x/>", "attribute without a value"],
    ['<a x="<"/>', '"<" inside an attribute value'],
    ["<a><!-- open</a>", "unterminated comment"],
    ["<a><![CDATA[open</a>", "unterminated CDATA section"],
    ["<?xml version='1.0'<a/>", "unterminated processing instruction"],
    ['<a x="open/>', "unterminated attribute value"],
    ["<1a/>", "malformed opening tag"],
    ['<a x="1"y="2"/>', "malformed <a> tag"],
    ["<a #/>", "malformed <a> tag"],
    ["<a></ >", "malformed closing tag"],
    ["<a></a x>", "malformed closing tag"],
    ["", "contains no root element"],
    ["<!-- only a comment -->", "contains no root element"],
  ])("rejects malformed input %j", (source, reason) => {
    expect(() => parseXml(source, { provider: "test" })).toThrow(ResponseValidationError);
    expect(() => parseXml(source, { provider: "test" })).toThrow(reason);
  });

  it("names the provider on the error it raises", () => {
    expect(thrownBy(() => parseXml("<a>", { provider: "kartverket-tides" }))).toMatchObject({
      provider: "kartverket-tides",
      message: expect.stringContaining("kartverket-tides XML response"),
    });
    expect(() => parseXml("<a>")).toThrow("The XML document is not well-formed");
  });

  it("refuses documents beyond the configured length", () => {
    expect(() => parseXml("<a>12345</a>", { maxLength: 8 })).toThrow("exceeds 8 characters");
    expect(
      thrownBy(() => parseXml("<a>12345</a>", { maxLength: 8, provider: "test" })),
    ).toMatchObject({ provider: "test" });
  });

  it("refuses documents nested beyond the configured depth", () => {
    expect(parseXml("<a><b><c/></b></a>", { maxDepth: 2 }).name).toBe("a");
    expect(() => parseXml("<a><b><c></c></b></a>", { maxDepth: 2 })).toThrow(
      "deeper than 2 levels",
    );
  });

  it("rethrows unexpected failures unchanged", () => {
    const hostile = {
      length: 4,
      charCodeAt: () => {
        throw new TypeError("not a string");
      },
    } as unknown as string;
    expect(() => parseXml(hostile)).toThrow(TypeError);
  });
});
