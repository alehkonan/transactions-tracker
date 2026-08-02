import { describe, expect, it } from "vitest";
import { formatDateTime } from "./formatDate";

describe("formatDateTime", () => {
  it("formats a date as yyyy-MM-dd HH:mm", () => {
    expect(formatDateTime(new Date(2026, 7, 2, 14, 35))).toBe("2026-08-02 14:35");
  });

  it("pads single-digit month, day, hours, and minutes", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 3, 7))).toBe("2026-01-05 03:07");
  });

  it("formats midnight as 00:00", () => {
    expect(formatDateTime(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31 00:00");
  });
});
