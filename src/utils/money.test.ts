import { describe, expect, it } from "vitest";
import { isMoneyInput } from "./money";

describe("isMoneyInput", () => {
  it.each(["0", "12", "12.3", "12.34", ".5", "999999999999.99"])(
    "accepts a numeric(14,2) amount: %s",
    (value) => expect(isMoneyInput(value)).toBe(true),
  );

  it.each(["", "1.", "1.234", "0x10", "1e3", "NaN", "1000000000000", "-1"])(
    "rejects a non-money amount: %s",
    (value) => expect(isMoneyInput(value)).toBe(false),
  );

  it("accepts signed balances only when requested", () => {
    expect(isMoneyInput("-12.34", { allowNegative: true })).toBe(true);
    expect(isMoneyInput("-12.34")).toBe(false);
  });
});
