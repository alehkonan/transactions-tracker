import { describe, expect, it } from "vitest";
import { pickMoneyTicks } from "~/modules/statistics/spending-trend-ticks";

describe("spending trend USD ticks", () => {
  it("fits a small total instead of flattening it against a $500 ceiling", () => {
    expect(pickMoneyTicks(12.34)).toEqual([0, 5, 10, 15]);
  });

  it("keeps cent-sized labels distinct and handles empty ranges", () => {
    expect(pickMoneyTicks(0.12)).toEqual([0, 0.05, 0.1, 0.15]);
    expect(pickMoneyTicks(0.01)).toEqual([0, 0.01, 0.02, 0.03, 0.04]);
    expect(pickMoneyTicks(0)).toEqual([0, 0.01, 0.02, 0.03, 0.04]);
  });

  it.each([0, 0.01, 0.99, 12.34, 1980, 10000, 1e6, 1e12, 1e100, Number.MAX_VALUE])(
    "bounds allocation and covers %s without non-finite or duplicate ticks",
    (maximum) => {
      const ticks = pickMoneyTicks(maximum);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks[0]).toBe(0);
      expect(ticks.at(-1)).toBeGreaterThanOrEqual(maximum);
      expect(ticks.every(Number.isFinite)).toBe(true);
      expect(ticks.every((tick, index) => index === 0 || tick > ticks[index - 1])).toBe(true);
    },
  );

  it.each([NaN, Infinity, -Infinity, -10])("has a safe fallback for %s", (value) => {
    expect(pickMoneyTicks(value)).toEqual(pickMoneyTicks(0));
  });
});
