import { describe, expect, it } from "vitest";

import { parseCsvDocument, parseCsvRecords } from "../../src/providers/norges-bank/csv.js";

describe("parseCsvDocument", () => {
  it("parses quoted fields containing commas and newlines", () => {
    const doc = parseCsvDocument('a,b\n"x,y","line1\nline2"\n');
    expect(doc.header).toEqual(["a", "b"]);
    expect(doc.records).toEqual([{ a: "x,y", b: "line1\nline2" }]);
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    const doc = parseCsvDocument('a\n"he said ""hi"""\n');
    expect(doc.records).toEqual([{ a: 'he said "hi"' }]);
  });

  it("strips a leading BOM and parses a final row without a trailing newline", () => {
    expect(parseCsvRecords("﻿a,b\n1,2")).toEqual([{ a: "1", b: "2" }]);
  });

  it("throws on a quote in the middle of an unquoted field", () => {
    expect(() => parseCsvDocument('x"y')).toThrow(/Unexpected quote/);
  });

  it("throws on an unterminated quoted field", () => {
    expect(() => parseCsvDocument('"abc')).toThrow(/Unterminated quoted/);
  });

  it("throws when the header is missing", () => {
    expect(() => parseCsvDocument("")).toThrow(/omitted its header/);
  });

  it("throws when a header column is empty", () => {
    expect(() => parseCsvDocument("a,,c\n1,2,3\n")).toThrow(/omitted its header/);
  });

  it("throws on duplicate header columns", () => {
    expect(() => parseCsvDocument("a,b,a\n1,2,3\n")).toThrow(/duplicates/);
  });

  it("throws when a row has an unexpected column count", () => {
    expect(() => parseCsvDocument("a,b\n1,2,3")).toThrow(/unexpected column count/);
  });
});
