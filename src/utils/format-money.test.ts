import { describe, expect, it } from "vitest";
import { formatMoney } from "./format-money";

describe("formatMoney", () => {
  it("formats USD with its narrow symbol", () => {
    expect(formatMoney("12.50", "USD")).toBe("$12.50");
  });

  it("formats GEL with its narrow symbol", () => {
    expect(formatMoney("12.50", "GEL")).toBe("₾12.50");
  });

  it("pads whole numbers to two decimal places", () => {
    expect(formatMoney("12", "USD")).toBe("$12.00");
  });

  it("formats negative amounts with a typographic minus", () => {
    expect(formatMoney("-5.25", "USD")).toBe("\u2212$5.25");
  });

  it("returns an empty string when amount is null", () => {
    expect(formatMoney(null, "USD")).toBe("");
  });

  it("returns an empty string when currency is null", () => {
    expect(formatMoney("12.50", null)).toBe("");
  });

  it("returns an empty string when both are null", () => {
    expect(formatMoney(null, null)).toBe("");
  });

  it("falls back to the raw code for a well-formed but unknown currency", () => {
    expect(formatMoney("12.50", "ZZZ")).toBe(`ZZZ 12.50`);
  });

  it("falls back to amount + currency for a malformed currency string", () => {
    expect(formatMoney("12.50", "banana")).toBe("12.50 banana");
  });

  it("falls back to amount + currency for an empty currency string", () => {
    expect(formatMoney("12.50", "")).toBe("12.50 ");
  });
});
