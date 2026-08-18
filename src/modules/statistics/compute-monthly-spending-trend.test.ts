import { describe, expect, it } from "vitest";
import { computeAvailableSpendingMonths } from "./compute-available-spending-months";
import { computeMonthlySpendingTrend } from "./compute-monthly-spending-trend";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { SyncedTransaction } from "~/modules/sync/sync-types";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";

const accounts: AccountWithBalance[] = [
  {
    id: "usd",
    name: "Cash",
    initialBalance: "0",
    balance: "0",
    currencyCode: "USD",
    status: "ACTIVE",
    type: "CURRENT",
    profileId: PROFILE_ID,
    updatedAt: new Date(2026, 0, 1),
    deletedAt: null,
  },
  {
    id: "gel",
    name: "Lari",
    initialBalance: "0",
    balance: "0",
    currencyCode: "GEL",
    status: "ACTIVE",
    type: "CURRENT",
    profileId: PROFILE_ID,
    updatedAt: new Date(2026, 0, 1),
    deletedAt: null,
  },
];

function transaction(
  overrides: Partial<SyncedTransaction> & { id: string; amount: string; createdAt: Date },
): SyncedTransaction {
  return {
    type: "EXPENSE",
    necessityLevel: "MEDIUM",
    comment: null,
    accountId: "usd",
    categoryId: null,
    profileId: PROFILE_ID,
    updatedAt: overrides.createdAt,
    deletedAt: null,
    ...overrides,
  };
}

const usdRates = { USD: 1, GEL: 2.5 };

describe("computeMonthlySpendingTrend", () => {
  it("accumulates spending per day as positive USD", () => {
    const trend = computeMonthlySpendingTrend({
      transactions: [
        transaction({ id: "t1", amount: "-10.00", createdAt: new Date(2026, 0, 2, 9) }),
        transaction({ id: "t2", amount: "-5.00", createdAt: new Date(2026, 0, 2, 18) }),
        // 25 GEL is 10 USD at 2.5 per USD.
        transaction({
          id: "t3",
          amount: "-25.00",
          accountId: "gel",
          createdAt: new Date(2026, 0, 4),
        }),
      ],
      accounts,
      usdRates,
      month: "2026-01",
    });

    expect(trend).toHaveLength(31);
    expect(trend[0].cumulativeUsd).toBe(0);
    expect(trend[1].cumulativeUsd).toBe(15);
    expect(trend[2].cumulativeUsd).toBe(15);
    expect(trend[3].cumulativeUsd).toBe(25);
    expect(trend.at(-1)?.cumulativeUsd).toBe(25);
  });

  it("counts a late-evening purchase in the local month it was made in", () => {
    const trend = computeMonthlySpendingTrend({
      transactions: [
        transaction({ id: "t1", amount: "-8.00", createdAt: new Date(2026, 0, 31, 23, 30) }),
      ],
      accounts,
      usdRates,
      month: "2026-01",
    });

    expect(trend.at(-1)?.cumulativeUsd).toBe(8);
  });

  it("leaves out transfers and income", () => {
    const trend = computeMonthlySpendingTrend({
      transactions: [
        transaction({
          id: "t1",
          amount: "-100.00",
          type: "TRANSFER",
          createdAt: new Date(2026, 0, 5),
        }),
        transaction({ id: "t2", amount: "50.00", type: "INCOME", createdAt: new Date(2026, 0, 5) }),
      ],
      accounts,
      usdRates,
      month: "2026-01",
    });

    expect(trend.at(-1)?.cumulativeUsd).toBe(0);
  });

  it("sizes the series to the month, February included", () => {
    const trend = computeMonthlySpendingTrend({
      transactions: [],
      accounts,
      usdRates,
      month: "2026-02",
    });

    expect(trend).toHaveLength(28);
  });
});

describe("computeAvailableSpendingMonths", () => {
  it("lists the months that have spending, newest first, without duplicates", () => {
    const months = computeAvailableSpendingMonths([
      transaction({ id: "t1", amount: "-1.00", createdAt: new Date(2026, 0, 5) }),
      transaction({ id: "t2", amount: "-1.00", createdAt: new Date(2026, 0, 25) }),
      transaction({ id: "t3", amount: "-1.00", createdAt: new Date(2025, 10, 1) }),
      transaction({ id: "t4", amount: "5.00", type: "INCOME", createdAt: new Date(2024, 5, 1) }),
    ]);

    expect(months.map((month) => month.value)).toEqual(["2026-01", "2025-11"]);
  });
});
