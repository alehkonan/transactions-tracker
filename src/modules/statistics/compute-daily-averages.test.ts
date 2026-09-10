import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computeDailyAverages } from "~/modules/statistics/compute-daily-averages";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

const today = new Date(2026, 8, 10, 12);

function account(overrides: Partial<AccountWithBalance> = {}): AccountWithBalance {
  return {
    id: "usd",
    name: "Current",
    initialBalance: "0",
    balance: "100",
    currencyCode: "USD",
    status: "ACTIVE",
    type: "CURRENT",
    profileId: "profile",
    updatedAt: today,
    deletedAt: null,
    ...overrides,
  };
}

function transaction(overrides: Partial<SyncedTransaction> = {}): SyncedTransaction {
  return {
    id: "expense",
    amount: "-93",
    type: "EXPENSE",
    necessityLevel: "MEDIUM",
    comment: null,
    accountId: "usd",
    categoryId: null,
    profileId: "profile",
    createdAt: today,
    updatedAt: today,
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(today);
});

afterEach(() => vi.useRealTimers());

describe("computeDailyAverages summary calculations", () => {
  it("includes the first calendar day and all of today, counting days without records as zero", () => {
    const averages = computeDailyAverages({
      accounts: [account()],
      usdRates: { USD: 1 },
      period: "3m",
      transactions: [
        transaction({ id: "start", amount: "-46", createdAt: new Date(2026, 5, 10) }),
        transaction({ id: "tonight", amount: "-47", createdAt: new Date(2026, 8, 10, 23, 59, 59) }),
        transaction({ id: "income", type: "INCOME", amount: "186" }),
        transaction({ id: "before", amount: "-1000", createdAt: new Date(2026, 5, 9, 23, 59, 59) }),
        transaction({ id: "tomorrow", amount: "-1000", createdAt: new Date(2026, 8, 11) }),
        transaction({
          id: "future-income",
          type: "INCOME",
          amount: "1000",
          createdAt: new Date(2026, 8, 11),
        }),
      ],
    });

    // June 10 through September 10 inclusive, not just the two days with spending.
    expect(averages.days).toBe(93);
    expect(averages.rangeLabel).toBe("Jun 10 – Sep 10");
    expect(averages.expense).toEqual({ totalUsd: 93, perDayUsd: 1 });
    expect(averages.income).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(averages.runway.days).toBe(100);
  });

  it("uses the entire 3m or 6m denominator even when all records are recent", () => {
    const options = {
      accounts: [account({ balance: "93" })],
      transactions: [transaction(), transaction({ id: "income", type: "INCOME", amount: "186" })],
      usdRates: { USD: 1 },
    };
    const threeMonths = computeDailyAverages({ ...options, period: "3m" });
    const sixMonths = computeDailyAverages({ ...options, period: "6m" });

    expect(threeMonths.days).toBe(93);
    expect(sixMonths.days).toBe(185);
    expect(sixMonths.rangeLabel).toBe("Mar 10 – Sep 10");
    expect(threeMonths.expense).toEqual({ totalUsd: 93, perDayUsd: 1 });
    expect(sixMonths.expense).toEqual({ totalUsd: 93, perDayUsd: 0.5 });
    expect(threeMonths.income).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(sixMonths.income).toEqual({ totalUsd: 186, perDayUsd: 1.01 });
    expect(threeMonths.runway.days).toBe(93);
    expect(sixMonths.runway.days).toBe(185);
  });

  it("combines active current and savings balances but still counts archived spending and income", () => {
    const averages = computeDailyAverages({
      accounts: [
        account(),
        account({ id: "savings", type: "SAVING", balance: "250", currencyCode: "GEL" }),
        account({ id: "archived", status: "ARCHIVED", balance: "100000", currencyCode: "GEL" }),
      ],
      transactions: [
        transaction(),
        transaction({ id: "archived-expense", accountId: "archived", amount: "-232.50" }),
        transaction({
          id: "archived-income",
          accountId: "archived",
          type: "INCOME",
          amount: "465",
        }),
      ],
      usdRates: { USD: 1, GEL: 2.5 },
      period: "3m",
    });

    expect(averages.expense).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(averages.income).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(averages.runway.balanceUsd).toBe(200);
    expect(averages.runway.days).toBe(100);
  });

  it("excludes both transfer legs from averages and does not offset runway spending with income", () => {
    const options = {
      accounts: [account()],
      usdRates: { USD: 1 },
      period: "3m" as const,
    };
    const withoutIncome = computeDailyAverages({ ...options, transactions: [transaction()] });
    const withIncomeAndTransfers = computeDailyAverages({
      ...options,
      transactions: [
        transaction(),
        transaction({ id: "income", type: "INCOME", amount: "9300" }),
        transaction({ id: "transfer-out", type: "TRANSFER", amount: "-4650" }),
        transaction({ id: "transfer-in", type: "TRANSFER", amount: "4650" }),
      ],
    });

    expect(withIncomeAndTransfers.expense).toEqual({ totalUsd: 93, perDayUsd: 1 });
    expect(withIncomeAndTransfers.income).toEqual({ totalUsd: 9300, perDayUsd: 100 });
    expect(withIncomeAndTransfers.runway).toEqual(withoutIncome.runway);
  });

  it("converts balances and historical records using the supplied device rates, not transaction-date rates", () => {
    const options = {
      accounts: [account({ currencyCode: "GEL", balance: "465" })],
      transactions: [
        transaction({ id: "old", amount: "-232.50", createdAt: new Date(2026, 5, 10) }),
        transaction({ id: "recent", amount: "-232.50" }),
        transaction({ id: "income", type: "INCOME", amount: "930" }),
      ],
      period: "3m" as const,
    };
    const originalRates = computeDailyAverages({ ...options, usdRates: { GEL: 2.5 } });
    const updatedRates = computeDailyAverages({ ...options, usdRates: { GEL: 5 } });

    expect(originalRates.expense).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(originalRates.income).toEqual({ totalUsd: 372, perDayUsd: 4 });
    expect(originalRates.runway.balanceUsd).toBe(186);
    expect(updatedRates.expense).toEqual({ totalUsd: 93, perDayUsd: 1 });
    expect(updatedRates.income).toEqual({ totalUsd: 186, perDayUsd: 2 });
    expect(updatedRates.runway.balanceUsd).toBe(93);
    expect(updatedRates.runway.days).toBe(93);
  });

  it.each([
    { amount: "-1", balance: "1.01", displayedPerDay: 0.01 },
    { amount: "-0.01", balance: "0.01", displayedPerDay: 0 },
  ])(
    "uses unrounded spending for runway even when $amount displays as $displayedPerDay per day",
    ({ amount, balance, displayedPerDay }) => {
      const averages = computeDailyAverages({
        accounts: [account({ balance })],
        transactions: [transaction({ amount })],
        usdRates: { USD: 1 },
        period: "3m",
      });

      expect(averages.expense.perDayUsd).toBe(displayedPerDay);
      expect(averages.runway.days).toBe(93);
      expect(averages.runway.days).not.toBe(Math.floor(Number(balance) / displayedPerDay));
      expect(averages.runway.emptyOnLabel).toBe("Dec 12, 2026");
    },
  );

  it("rounds runway down to whole days", () => {
    const averages = computeDailyAverages({
      accounts: [account({ balance: "2.99" })],
      transactions: [transaction()],
      usdRates: { USD: 1 },
      period: "3m",
    });

    expect(averages.runway).toEqual({
      balanceUsd: 2.99,
      days: 2,
      label: "2 days",
      shortLabel: "2d",
      emptyOnLabel: "Sep 12, 2026",
    });
  });

  it("has no finite estimate without expenses, even with income or transfers", () => {
    const averages = computeDailyAverages({
      accounts: [account()],
      transactions: [
        transaction({ type: "INCOME", amount: "930" }),
        transaction({ id: "transfer", type: "TRANSFER", amount: "-930" }),
      ],
      usdRates: { USD: 1 },
      period: "3m",
    });

    expect(averages.expense).toEqual({ totalUsd: 0, perDayUsd: 0 });
    expect(averages.runway).toEqual({
      balanceUsd: 100,
      days: null,
      label: null,
      shortLabel: null,
      emptyOnLabel: null,
    });
  });

  it.each(["0", "-100", "0.99"])(
    "has zero whole days at a balance of %s with positive spending",
    (balance) => {
      const averages = computeDailyAverages({
        accounts: [account({ balance })],
        transactions: [transaction()],
        usdRates: { USD: 1 },
        period: "3m",
      });

      expect(averages.runway).toEqual({
        balanceUsd: Number(balance),
        days: 0,
        label: "0 days",
        shortLabel: "0d",
        emptyOnLabel: "Sep 10, 2026",
      });
    },
  );
});
