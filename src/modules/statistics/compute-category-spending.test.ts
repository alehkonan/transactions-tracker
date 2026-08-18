import { describe, expect, it } from "vitest";
import { computeCategorySpending } from "./compute-category-spending";
import type { AccountWithBalance } from "~/modules/accounts/compute-balances";
import type { CategoryRow } from "~/modules/categories/to-category-rows";
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

const categories: CategoryRow[] = [
  { id: "food", name: "Food", colorId: 1, colorHex: "#ff0000" },
  { id: "rent", name: "Rent", colorId: 2, colorHex: "#00ff00" },
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

const options = {
  accounts,
  categories,
  usdRates,
  month: "2026-01",
};

describe("computeCategorySpending", () => {
  it("ranks categories by USD spending, largest first, with counts and shares", () => {
    const spending = computeCategorySpending({
      ...options,
      transactions: [
        transaction({
          id: "t1",
          amount: "-10.00",
          categoryId: "food",
          createdAt: new Date(2026, 0, 2),
        }),
        transaction({
          id: "t2",
          amount: "-40.00",
          categoryId: "rent",
          createdAt: new Date(2026, 0, 3),
        }),
        transaction({
          id: "t3",
          amount: "-5.00",
          categoryId: "food",
          createdAt: new Date(2026, 0, 4),
        }),
      ],
    });

    expect(spending.map((entry) => [entry.name, entry.totalUsd, entry.count])).toEqual([
      ["Rent", 40, 1],
      ["Food", 15, 2],
    ]);
    expect(spending.map((entry) => entry.share).reduce((a, b) => a + b, 0)).toBeCloseTo(1);
    expect(spending[0].share).toBeCloseTo(40 / 55);
  });

  it("converts other currencies to USD before comparing", () => {
    const spending = computeCategorySpending({
      ...options,
      transactions: [
        // 25 GEL is 10 USD at 2.5 per USD.
        transaction({
          id: "t1",
          amount: "-25.00",
          accountId: "gel",
          categoryId: "food",
          createdAt: new Date(2026, 0, 4),
        }),
        transaction({
          id: "t2",
          amount: "-5.00",
          categoryId: "rent",
          createdAt: new Date(2026, 0, 5),
        }),
      ],
    });

    expect(spending.map((entry) => [entry.name, entry.totalUsd])).toEqual([
      ["Food", 10],
      ["Rent", 5],
    ]);
  });

  it("groups uncategorised rows under 'No category'", () => {
    const spending = computeCategorySpending({
      ...options,
      transactions: [transaction({ id: "t1", amount: "-7.00", createdAt: new Date(2026, 0, 2) })],
    });

    expect(spending).toEqual([
      {
        categoryId: null,
        name: "No category",
        colorHex: null,
        count: 1,
        totalUsd: 7,
        share: 1,
      },
    ]);
  });

  it("leaves out income, transfers, and rows outside the month", () => {
    const spending = computeCategorySpending({
      ...options,
      transactions: [
        transaction({
          id: "t1",
          amount: "-100.00",
          type: "TRANSFER",
          createdAt: new Date(2026, 0, 5),
        }),
        transaction({ id: "t2", amount: "50.00", type: "INCOME", createdAt: new Date(2026, 0, 5) }),
        transaction({
          id: "t3",
          amount: "-9.00",
          categoryId: "food",
          createdAt: new Date(2025, 11, 31),
        }),
        transaction({
          id: "t4",
          amount: "-9.00",
          categoryId: "food",
          createdAt: new Date(2026, 1, 1),
        }),
      ],
    });

    expect(spending).toEqual([]);
  });

  it("returns an empty list for a month with no spending", () => {
    expect(computeCategorySpending({ ...options, transactions: [] })).toEqual([]);
  });
});
