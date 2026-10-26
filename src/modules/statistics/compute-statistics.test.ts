import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeStatistics } from "./compute-statistics";
import type {
  SyncedAccount,
  SyncedAllocation,
  SyncedSphere,
  SyncedTransaction,
} from "~/modules/sync/sync-types";

const today = new Date(2026, 8, 10, 12);

function account(overrides: Partial<SyncedAccount> = {}): SyncedAccount {
  return {
    id: "bank",
    profileId: "profile",
    name: "Bank",
    currencyCode: "USD",
    initialBalance: "0",
    status: "ACTIVE",
    type: "CURRENT",
    updatedAt: today,
    deletedAt: null,
    ...overrides,
  };
}

function transaction(
  id: string,
  amount: string,
  overrides: Partial<SyncedTransaction> = {},
): SyncedTransaction {
  return {
    id,
    amount,
    profileId: "profile",
    accountId: "bank",
    categoryId: "groceries",
    type: "EXPENSE",
    necessityLevel: "MEDIUM",
    comment: null,
    createdAt: today,
    updatedAt: today,
    deletedAt: null,
    ...overrides,
  };
}

function allocation(row: SyncedTransaction, sphereId = "operating"): SyncedAllocation {
  return {
    id: `allocation-${row.id}`,
    profileId: row.profileId,
    sphereId,
    transactionId: row.id,
    openingAccountId: null,
    currencyCode: "USD",
    amount: row.amount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  };
}

function sphere(id: string, type: SyncedSphere["type"]): SyncedSphere {
  return {
    id,
    type,
    name: id,
    profileId: "profile",
    archived: false,
    hasHistory: true,
    updatedAt: today,
    deletedAt: null,
  };
}

function fixture(): Parameters<typeof computeStatistics>[0] {
  const transactions = [
    transaction("salary", "3000", { type: "INCOME", categoryId: null }),
    transaction("groceries", "-800"),
    transaction("flights", "-1200", { categoryId: "travel" }),
  ];
  return {
    profileId: "profile",
    accounts: [account()],
    transactions,
    spheres: [
      sphere("operating", "OPERATING"),
      sphere("travel", "FUNDS"),
      sphere("capital", "CAPITAL"),
    ],
    allocations: [
      ...transactions.map((row) => allocation(row, row.id === "flights" ? "travel" : "operating")),
      {
        ...allocation(transactions[0]),
        id: "reserve-out",
        transactionId: null,
        reallocationId: "reservation",
        amount: "-1200",
      },
      {
        ...allocation(transactions[0], "travel"),
        id: "reserve-in",
        transactionId: null,
        reallocationId: "reservation",
        amount: "1200",
      },
    ],
    categories: [
      { id: "groceries", name: "Groceries", colorId: null, colorHex: null },
      { id: "travel", name: "Travel", colorId: null, colorHex: null },
    ],
    usdRates: { USD: 1 },
    period: "3m",
    isHydrated: true,
    pending: [],
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(today);
});
afterEach(() => vi.useRealTimers());

describe("Operating Spending and Runway", () => {
  it("counts groceries once, excludes a travel reservation and Funds expense, and treats refunds as income", () => {
    const options = fixture();
    const result = computeStatistics(options);
    expect(result.averages.expense.totalUsd).toBe(800);
    expect(result.averages.runway.balanceUsd).toBe(1000);
    expect(result.averages.runway.days).toBe(116);
    expect(result.trend.at(-1)?.cumulativeUsd).toBe(800);
    expect(
      result.categorySpending.map(({ name, totalUsd, count }) => ({ name, totalUsd, count })),
    ).toEqual([{ name: "Groceries", totalUsd: 800, count: 1 }]);

    const refund = transaction("refund", "100", { type: "INCOME" });
    const refunded = computeStatistics({
      ...options,
      transactions: [...options.transactions, refund],
      allocations: [...options.allocations, allocation(refund)],
    });
    expect(refunded.averages.expense).toEqual(result.averages.expense);
    expect(refunded.averages.income.totalUsd).toBe(3100);
    expect(refunded.averages.runway.balanceUsd).toBe(1100);
    expect(refunded.averages.runway.days).toBe(127);
    expect(refunded.trend).toEqual(result.trend);
    expect(refunded.categorySpending).toEqual(result.categorySpending);
  });

  it("includes archived holdings and Operating expenses, regardless of account legacy type", () => {
    const options = fixture();
    options.accounts[0].status = "ARCHIVED";
    options.accounts.push(account({ id: "savings", type: "SAVING", initialBalance: "500" }));
    const result = computeStatistics(options);
    expect(result.averages.expense.totalUsd).toBe(800);
    expect(result.averages.runway.balanceUsd).toBe(1500);
    expect(result.averages.runway.days).toBe(174);
  });

  it("excludes Capital expenses, both transfer legs, opening allocations, and standalone negative allocations from all spending reports", () => {
    const options = fixture();
    options.accounts[0].initialBalance = "500";
    const additions = [
      transaction("investment", "-200", { createdAt: new Date(2026, 7, 1) }),
      transaction("transfer-out", "-300", { type: "TRANSFER", createdAt: new Date(2026, 6, 1) }),
      transaction("transfer-in", "300", { type: "TRANSFER", createdAt: new Date(2026, 6, 1) }),
    ];
    options.transactions.push(...additions);
    options.allocations.push(
      ...additions.map((row) => allocation(row, row.type === "EXPENSE" ? "capital" : "operating")),
      {
        ...allocation(additions[0]),
        id: "opening",
        transactionId: null,
        openingAccountId: "bank",
        amount: "500",
      },
    );
    const result = computeStatistics(options);
    expect(result.months.map((month) => month.value)).toEqual(["2026-09"]);
    expect(result.averages.expense.totalUsd).toBe(800);
    expect(result.averages.runway.balanceUsd).toBe(1300);
    expect(result.trend.at(-1)?.cumulativeUsd).toBe(800);
    expect(result.categorySpending).toHaveLength(1);
    expect(computeStatistics({ ...options, month: "2026-08" }).categorySpending).toEqual([]);
  });

  it("applies corrections to the original expense's amount, reporting period, category, and sphere", () => {
    const options = fixture();
    const groceries = options.transactions[1];
    groceries.amount = "-600";
    options.allocations[1].amount = "-600";
    const corrected = computeStatistics(options);
    expect(corrected.averages.expense.totalUsd).toBe(600);
    expect(corrected.averages.runway.balanceUsd).toBe(1200);
    expect(corrected.categorySpending[0].totalUsd).toBe(600);

    groceries.createdAt = new Date(2026, 4, 9);
    groceries.categoryId = "travel";
    options.allocations[1].createdAt = groceries.createdAt;
    const moved = computeStatistics(options);
    expect(moved.months.map((month) => month.value)).toEqual(["2026-05"]);
    expect(moved.averages.expense.totalUsd).toBe(0);
    expect(moved.averages.runway.days).toBeNull();
    expect(moved.trend.at(-1)?.cumulativeUsd).toBe(600);
    expect(moved.categorySpending[0].name).toBe("Travel");

    options.allocations[1].sphereId = "travel";
    const reattributed = computeStatistics({ ...options, period: "1y" });
    expect(reattributed.months).toEqual([]);
    expect(reattributed.averages.expense.totalUsd).toBe(0);
    expect(reattributed.averages.runway.days).toBeNull();
  });

  it("converts combined figures using current shared rates without changing source currencies or sphere amounts", () => {
    const options = fixture();
    options.accounts[0].currencyCode = "GEL";
    options.accounts.push(account({ id: "usd", initialBalance: "500", status: "ARCHIVED" }));
    options.allocations.forEach((row) => {
      row.currencyCode = "GEL";
    });
    const sources = structuredClone(options);
    const first = computeStatistics({ ...options, usdRates: { GEL: 2.5, USD: 1 } });
    const updated = computeStatistics({ ...options, usdRates: { GEL: 5, USD: 1 } });
    expect(first.averages.expense.totalUsd).toBe(320);
    expect(first.averages.runway.balanceUsd).toBe(900);
    expect(first.trend.at(-1)?.cumulativeUsd).toBe(320);
    expect(first.categorySpending[0].totalUsd).toBe(320);
    expect(updated.averages.expense.totalUsd).toBe(160);
    expect(updated.averages.runway.balanceUsd).toBe(700);
    expect(options).toEqual(sources);
  });

  it("scopes all inputs to the selected profile and ignores deleted source rows", () => {
    const options = fixture();
    const stranger = transaction("other", "-90000", {
      profileId: "other",
      accountId: "other-bank",
    });
    const deleted = transaction("deleted", "-10000", { deletedAt: today });
    options.accounts.push(
      account({ id: "other-bank", profileId: "other", initialBalance: "999999" }),
      account({ id: "deleted-bank", initialBalance: "999999", deletedAt: today }),
    );
    options.transactions.push(stranger, deleted);
    options.allocations.push(allocation(stranger), allocation(deleted));
    const result = computeStatistics(options);
    expect(result.averages.historyComplete).toBe(true);
    expect(result.averages.expense.totalUsd).toBe(800);
    expect(result.averages.runway.balanceUsd).toBe(1000);
    expect(result.trend.at(-1)?.cumulativeUsd).toBe(800);
  });

  it.each(["accounts", "transactions", "allocations", "spheres"] as const)(
    "withholds finite Runway while %s are still loading",
    (table) => {
      const result = computeStatistics({ ...fixture(), pending: [table] });
      expect(result.averages.historyComplete).toBe(false);
      expect(result.averages.runway.days).toBeNull();
      expect(result.averages.runway.label).toBeNull();
      expect(result.averages.runway.emptyOnLabel).toBeNull();
    },
  );

  it("withholds finite Runway before hydration or without a selected profile", () => {
    expect(computeStatistics({ ...fixture(), isHydrated: false }).averages.runway.days).toBeNull();
    expect(computeStatistics({ ...fixture(), profileId: null }).averages.runway.days).toBeNull();
  });

  it.each([
    "missing",
    "deleted",
    "wrong-profile",
    "stale-amount",
    "stale-date",
    "stale-currency",
    "missing-sphere",
  ])("withholds finite Runway with %s expense attribution", (reason) => {
    const options = fixture();
    const groceries = options.allocations[1];
    if (reason === "missing") options.allocations.splice(1, 1);
    if (reason === "deleted") groceries.deletedAt = today;
    if (reason === "wrong-profile") groceries.profileId = "other";
    if (reason === "stale-amount") groceries.amount = "-500";
    if (reason === "stale-date") groceries.createdAt = new Date(2026, 8, 9);
    if (reason === "stale-currency") groceries.currencyCode = "GEL";
    if (reason === "missing-sphere") options.spheres = [];
    const result = computeStatistics(options);
    expect(result.averages.historyComplete).toBe(false);
    expect(result.averages.runway.days).toBeNull();
  });
});
