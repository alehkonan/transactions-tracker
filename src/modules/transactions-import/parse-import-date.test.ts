import { describe, expect, it } from "vitest";
import { parseImportDate } from "./parse-import-date";

describe("parseImportDate", () => {
  it("interprets a bare ISO date at the start of its day in Asia/Tbilisi", () => {
    expect(parseImportDate("2026-03-01").toISOString()).toBe("2026-02-28T20:00:00.000Z");
  });

  it("interprets a bare ISO date-time as Asia/Tbilisi wall-clock time", () => {
    expect(parseImportDate("2026-03-01T14:30:45.123").toISOString()).toBe(
      "2026-03-01T10:30:45.123Z",
    );
  });

  it("preserves explicit UTC and numeric-offset timestamps", () => {
    expect(parseImportDate("2026-03-01T14:30:00Z").toISOString()).toBe("2026-03-01T14:30:00.000Z");
    expect(parseImportDate("2026-03-01T14:30:00+02:00").toISOString()).toBe(
      "2026-03-01T12:30:00.000Z",
    );
  });

  it("rejects invalid ISO calendar dates", () => {
    expect(Number.isNaN(parseImportDate("2026-02-29").getTime())).toBe(true);
  });
});
