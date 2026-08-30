import { describe, expect, it } from "vitest";
import { filterTransactions } from "./filter-transactions";
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

// Local times on purpose: the filter's bounds are the days the user picked, not UTC days.
const rows = [
  row({ id: "before", createdAt: new Date(2026, 0, 9, 23, 59) }),
  row({ id: "start-of-from", createdAt: new Date(2026, 0, 10, 0, 0) }),
  row({ id: "middle", createdAt: new Date(2026, 0, 11, 12, 0) }),
  row({ id: "end-of-to", createdAt: new Date(2026, 0, 12, 23, 59) }),
  row({
    id: "after",
    createdAt: new Date(2026, 0, 13, 0, 0),
    account: "Bank",
    comment: "Airport taxi",
    currencyCode: "EUR",
  }),
  row({ id: "groceries", createdAt: new Date(2026, 0, 14, 9, 0), category: "Food" }),
  row({
    id: "lunch",
    createdAt: new Date(2026, 0, 15, 13, 0),
    category: "Food",
    necessityLevel: "ESSENTIAL",
  }),
];

const ids = (result: TransactionRow[]) => result.map((entry) => entry.id);

describe("filterTransactions", () => {
  it("returns everything when nothing is filtered", () => {
    expect(filterTransactions(rows, {})).toHaveLength(rows.length);
  });

  it("includes both bounding days in full", () => {
    expect(ids(filterTransactions(rows, { from: "2026-01-10", to: "2026-01-12" }))).toEqual([
      "start-of-from",
      "middle",
      "end-of-to",
    ]);
  });

  it("filters on a lower bound alone", () => {
    expect(ids(filterTransactions(rows, { from: "2026-01-13" }))).toEqual([
      "after",
      "groceries",
      "lunch",
    ]);
  });

  it("filters on an upper bound alone", () => {
    expect(ids(filterTransactions(rows, { to: "2026-01-09" }))).toEqual(["before"]);
  });

  it("matches an account by name", () => {
    expect(ids(filterTransactions(rows, { account: "Bank" }))).toEqual(["after"]);
  });

  it("matches a category by name", () => {
    expect(ids(filterTransactions(rows, { category: "Food" }))).toEqual(["groceries", "lunch"]);
  });

  it("applies the date range and the account together", () => {
    expect(
      filterTransactions(rows, { from: "2026-01-10", to: "2026-01-12", account: "Bank" }),
    ).toEqual([]);
  });

  it("combines the account and category filters", () => {
    expect(ids(filterTransactions(rows, { account: "Cash", category: "Food" }))).toEqual([
      "groceries",
      "lunch",
    ]);
  });

  it("matches trimmed, case-insensitive text across transaction fields", () => {
    expect(ids(filterTransactions(rows, { search: " food " }))).toEqual(["groceries", "lunch"]);
    expect(ids(filterTransactions(rows, { search: "AIRPORT" }))).toEqual(["after"]);
    expect(ids(filterTransactions(rows, { search: "eur" }))).toEqual(["after"]);
    expect(ids(filterTransactions(rows, { search: "essential" }))).toEqual(["lunch"]);
  });
});
