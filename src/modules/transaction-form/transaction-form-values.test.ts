import { describe, expect, it } from "vitest";
import { calculateAccountBalancePreview, getDefaultFormValues } from "./transaction-form-values";

describe("calculateAccountBalancePreview", () => {
  it("keeps the current balance for an unchanged expense edit", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "89.90",
        selectedAccountId: "account-a",
        amount: "10.10",
        type: "EXPENSE",
        transaction: { accountId: "account-a", amount: "-10.10" },
      }),
    ).toBe("89.90");
  });

  it("reverses the original expense before applying an amount change", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "90.00",
        selectedAccountId: "account-a",
        amount: "25.55",
        type: "EXPENSE",
        transaction: { accountId: "account-a", amount: "-10.00" },
      }),
    ).toBe("74.45");
  });

  it("reverses the original income before applying the edited income", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "110.10",
        selectedAccountId: "account-a",
        amount: "20.20",
        type: "INCOME",
        transaction: { accountId: "account-a", amount: "10.10" },
      }),
    ).toBe("120.20");
  });

  it("applies only the edited amount when the selected account changes", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "50.10",
        selectedAccountId: "account-b",
        amount: "20.20",
        type: "EXPENSE",
        transaction: { accountId: "account-a", amount: "-10.00" },
      }),
    ).toBe("29.90");
  });

  it("does not preview values that cannot be stored as money", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "100.00",
        selectedAccountId: "account-a",
        amount: "0x10",
        type: "EXPENSE",
      }),
    ).toBeUndefined();
    expect(
      calculateAccountBalancePreview({
        balance: "100.00",
        selectedAccountId: "account-a",
        amount: "1.234",
        type: "EXPENSE",
      }),
    ).toBeUndefined();
  });

  it("preserves the original transfer leg sign while editing", () => {
    expect(
      calculateAccountBalancePreview({
        balance: "90.00",
        selectedAccountId: "account-a",
        amount: "20.00",
        type: "TRANSFER",
        transaction: { accountId: "account-a", amount: "-10.00" },
      }),
    ).toBe("80.00");

    expect(
      calculateAccountBalancePreview({
        balance: "110.00",
        selectedAccountId: "account-b",
        amount: "20.00",
        type: "TRANSFER",
        transaction: { accountId: "account-b", amount: "10.00" },
      }),
    ).toBe("120.00");
  });
});

describe("getDefaultFormValues", () => {
  it("makes the visible create-mode choices explicit", () => {
    expect(getDefaultFormValues(undefined)).toMatchObject({
      type: "EXPENSE",
      necessityLevel: "MEDIUM",
    });
  });
});
