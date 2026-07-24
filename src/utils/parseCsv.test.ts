import { describe, expect, it } from "vitest";
import { parseCsv } from "./parseCsv";

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n4,5,6")).toEqual({
      headers: ["a", "b", "c"],
      rows: [
        ["1", "2", "3"],
        ["4", "5", "6"],
      ],
    });
  });

  it("returns empty rows when only a header line is present", () => {
    expect(parseCsv("a,b,c")).toEqual({ headers: ["a", "b", "c"], rows: [] });
  });

  it("returns empty headers and rows for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] });
  });

  it("ignores a trailing newline instead of emitting an empty row", () => {
    expect(parseCsv("a,b\n1,2\n")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("parses the final line when it has no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] });
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual({
      headers: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    });
  });

  it("auto-detects a semicolon delimiter", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual({
      headers: ["a", "b", "c"],
      rows: [["1", "2", "3"]],
    });
  });

  it("auto-detects a tab delimiter", () => {
    expect(parseCsv("a\tb\n1\t2")).toEqual({
      headers: ["a", "b"],
      rows: [["1", "2"]],
    });
  });

  it("does not split on commas when the delimiter is a semicolon", () => {
    expect(parseCsv("amount;note\n1,50;hello")).toEqual({
      headers: ["amount", "note"],
      rows: [["1,50", "hello"]],
    });
  });

  it("honors an explicit delimiter over auto-detection", () => {
    expect(parseCsv("a;b,c\n1;2,3", ";")).toEqual({
      headers: ["a", "b,c"],
      rows: [["1", "2,3"]],
    });
  });

  it("keeps commas inside quoted fields", () => {
    expect(parseCsv('a,b\n"1,000",2')).toEqual({
      headers: ["a", "b"],
      rows: [["1,000", "2"]],
    });
  });

  it("unescapes doubled quotes inside quoted fields", () => {
    expect(parseCsv('a\n"she said ""hi"""')).toEqual({
      headers: ["a"],
      rows: [['she said "hi"']],
    });
  });

  it("keeps newlines inside quoted fields", () => {
    expect(parseCsv('a,b\n"line1\nline2",2')).toEqual({
      headers: ["a", "b"],
      rows: [["line1\nline2", "2"]],
    });
  });

  it("preserves empty fields", () => {
    expect(parseCsv("a,b,c\n1,,3")).toEqual({
      headers: ["a", "b", "c"],
      rows: [["1", "", "3"]],
    });
  });

  it("strips a leading BOM from the first header", () => {
    expect(parseCsv("﻿a,b\n1,2")).toEqual({
      headers: ["a", "b"],
      rows: [["1", "2"]],
    });
  });
});
