import { describe, expect, it } from "vitest";
import {
  computeBalanceTotals,
  computeProfileSummaries,
  toAccountsWithBalance,
} from "./compute-balances";
import type { SyncedAccount, SyncedProfile, SyncedTransaction } from "~/modules/sync/sync-types";

const PROFILE_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROFILE_ID = "22222222-2222-2222-2222-222222222222";

function account(overrides: Partial<SyncedAccount> & { id: string }): SyncedAccount {
  return {
    name: `Account ${overrides.id}`,
    initialBalance: "0",
    currencyCode: "USD",
    status: "ACTIVE",
    type: "CURRENT",
    profileId: PROFILE_ID,
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

function transaction(
  overrides: Partial<SyncedTransaction> & { id: string; amount: string },
): SyncedTransaction {
  return {
    type: "EXPENSE",
    necessityLevel: "MEDIUM",
    comment: null,
    createdAt: new Date("2026-01-02"),
    accountId: "a",
    categoryId: null,
    profileId: PROFILE_ID,
    updatedAt: new Date("2026-01-02"),
    deletedAt: null,
    ...overrides,
  };
}

const usdRates = { USD: 1, GEL: 2.5 };

describe("toAccountsWithBalance", () => {
  it("adds the account's transactions to its opening amount", () => {
    const accounts = toAccountsWithBalance(
      [account({ id: "a", initialBalance: "100.00" })],
      [
        transaction({ id: "t1", amount: "-30.50", accountId: "a" }),
        transaction({ id: "t2", amount: "10.25", accountId: "a" }),
      ],
    );

    expect(accounts[0].balance).toBe("79.75");
  });

  it("ignores transactions filed against another account", () => {
    const accounts = toAccountsWithBalance(
      [account({ id: "a", initialBalance: "10.00" })],
      [transaction({ id: "t1", amount: "-5.00", accountId: "b" })],
    );

    expect(accounts[0].balance).toBe("10.00");
  });

  it("ignores transactions with no account at all", () => {
    const accounts = toAccountsWithBalance(
      [account({ id: "a", initialBalance: "10.00" })],
      [transaction({ id: "t1", amount: "-5.00", accountId: null })],
    );

    expect(accounts[0].balance).toBe("10.00");
  });

  it("stays exact over many additions, where repeated float addition would drift", () => {
    const accounts = toAccountsWithBalance(
      [account({ id: "a", initialBalance: "0" })],
      Array.from({ length: 10 }, (_, index) =>
        transaction({ id: `t${index}`, amount: "0.10", accountId: "a" }),
      ),
    );

    expect(accounts[0].balance).toBe("1.00");
  });
});

describe("computeBalanceTotals", () => {
  it("groups by status and type, converting to USD", () => {
    const accounts = toAccountsWithBalance(
      [
        account({ id: "a", initialBalance: "100.00" }),
        account({ id: "b", initialBalance: "50.00", type: "SAVING", currencyCode: "GEL" }),
        account({ id: "c", initialBalance: "7.00", status: "ARCHIVED" }),
      ],
      [],
    );

    expect(computeBalanceTotals(accounts, usdRates)).toEqual({
      currentBalanceUsd: "100.00",
      // 50 GEL at 2.5 per USD.
      savingsBalanceUsd: "20.00",
      archivedBalanceUsd: "7.00",
    });
  });

  it("treats an unknown currency as 1:1 rather than dropping the amount", () => {
    const accounts = toAccountsWithBalance([account({ id: "a", initialBalance: "5.00" })], []);

    expect(computeBalanceTotals(accounts, {}).currentBalanceUsd).toBe("5.00");
  });
});

describe("computeProfileSummaries", () => {
  const profiles: SyncedProfile[] = [
    {
      id: PROFILE_ID,
      name: "Mine",
      userId: 1,
      updatedAt: new Date("2026-01-01"),
      deletedAt: null,
    },
    {
      id: OTHER_PROFILE_ID,
      name: "Other",
      userId: 1,
      updatedAt: new Date("2026-01-01"),
      deletedAt: null,
    },
  ];

  it("counts and totals each profile's own rows", () => {
    const summaries = computeProfileSummaries(
      profiles,
      [
        account({ id: "a", initialBalance: "100.00" }),
        account({ id: "b", initialBalance: "300.00", profileId: OTHER_PROFILE_ID }),
      ],
      [
        transaction({ id: "t1", amount: "-25.00", accountId: "a" }),
        transaction({
          id: "t2",
          amount: "-100.00",
          accountId: "b",
          profileId: OTHER_PROFILE_ID,
        }),
      ],
      usdRates,
    );

    expect(summaries[0]).toEqual({
      id: PROFILE_ID,
      name: "Mine",
      accountCount: 1,
      transactionCount: 1,
      currentBalanceUsd: "75.00",
      savingsBalanceUsd: "0.00",
    });
    expect(summaries[1].currentBalanceUsd).toBe("200.00");
  });

  it("leaves archived accounts out of the totals but still counts them", () => {
    const summaries = computeProfileSummaries(
      [profiles[0]],
      [
        account({ id: "a", initialBalance: "100.00" }),
        account({ id: "b", initialBalance: "900.00", status: "ARCHIVED" }),
      ],
      [],
      usdRates,
    );

    expect(summaries[0].accountCount).toBe(2);
    expect(summaries[0].currentBalanceUsd).toBe("100.00");
  });
});
