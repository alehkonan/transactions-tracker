import { describe, expect, it } from "vitest";
import { groupTransactionsByDay } from "./group-transactions-by-day";
import type { TransactionRow } from "./to-transaction-rows";

function row(overrides: Partial<TransactionRow> & { id: string; createdAt: Date }): TransactionRow {
  return {
    categoryId: null,
    category: null,
    categoryColorHex: null,
    necessityLevel: "MEDIUM",
    type: "EXPENSE",
    accountId: "a",
    account: "Cash",
    amount: "-10.00",
    currencyCode: "USD",
    comment: null,
    approxAmountUsd: "-10.00",
    ...overrides,
  };
}

// Local times on purpose: a transaction belongs to the day the user had, not to a UTC one.
const rows = [
  row({ id: "late", createdAt: new Date(2026, 0, 12, 23, 30) }),
  row({ id: "morning", createdAt: new Date(2026, 0, 12, 8, 0) }),
  row({ id: "midnight", createdAt: new Date(2026, 0, 11, 0, 0) }),
];

describe("groupTransactionsByDay", () => {
  it("groups rows into local calendar days", () => {
    const byDay = groupTransactionsByDay(rows);

    expect([...byDay.keys()]).toEqual(["2026-01-12", "2026-01-11"]);
    expect(byDay.get("2026-01-12")?.map((entry) => entry.id)).toEqual(["late", "morning"]);
    expect(byDay.get("2026-01-11")?.map((entry) => entry.id)).toEqual(["midnight"]);
  });

  it("keeps the order it was given, so a newest-first list stays newest-first", () => {
    const byDay = groupTransactionsByDay(rows.toReversed());

    expect([...byDay.keys()]).toEqual(["2026-01-11", "2026-01-12"]);
  });

  it("has no days at all for no rows", () => {
    expect(groupTransactionsByDay([]).size).toBe(0);
  });
});
