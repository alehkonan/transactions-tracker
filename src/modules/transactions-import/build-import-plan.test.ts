import { describe, expect, it } from "vitest";
import { buildImportPlan } from "./build-import-plan";
import type { ImportContext } from "./build-import-plan";
import type { ImportRow } from "./utils";
import type { LocalChange } from "~/modules/sync/mutations";
import type { SyncedAccount, SyncedCategory, SyncedTable } from "~/modules/sync/sync-types";

const PROFILE_ID = "01890000-0000-7000-8000-000000000001";

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    categoryName: "",
    comment: "",
    outcomeAccountName: "",
    outcome: "",
    outcomeCurrencyShortTitle: "",
    incomeAccountName: "",
    income: "",
    incomeCurrencyShortTitle: "",
    createdDate: "2026-03-01",
    ...overrides,
  };
}

function account(overrides: Partial<SyncedAccount> = {}): SyncedAccount {
  return {
    id: "01890000-0000-7000-8000-0000000000a1",
    name: "Wallet",
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

function category(overrides: Partial<SyncedCategory> = {}): SyncedCategory {
  return {
    id: "01890000-0000-7000-8000-0000000000c1",
    name: "Food",
    colorId: 1,
    profileId: PROFILE_ID,
    updatedAt: new Date("2026-01-01"),
    deletedAt: null,
    ...overrides,
  };
}

function context(overrides: Partial<ImportContext> = {}): ImportContext {
  return { profileId: PROFILE_ID, accounts: [], categories: [], colors: [], ...overrides };
}

/** The upserts a plan makes against one table, in order. */
function upserts<Table extends SyncedTable>(changes: LocalChange[], table: Table) {
  return changes.filter(
    (change): change is Extract<LocalChange, { op: "upsert"; table: Table }> =>
      change.op === "upsert" && change.table === table,
  );
}

describe("buildImportPlan", () => {
  it("files an outcome against the named account as a negative expense", () => {
    const plan = buildImportPlan(
      [row({ outcomeAccountName: "Wallet", outcome: "12.50", categoryName: "Food" })],
      context({ accounts: [account()], categories: [category()] }),
    );

    expect(plan.failures).toEqual([]);
    const [transaction] = upserts(plan.changes, "transactions");
    expect(transaction.payload).toMatchObject({
      type: "EXPENSE",
      amount: "-12.50",
      accountId: account().id,
      categoryId: category().id,
      profileId: PROFILE_ID,
    });
  });

  it("records a row with both sides as two TRANSFER legs", () => {
    const plan = buildImportPlan(
      [
        row({
          outcomeAccountName: "Wallet",
          outcome: "40",
          incomeAccountName: "Savings",
          income: "40",
        }),
      ],
      context({ accounts: [account(), account({ id: "b", name: "Savings" })] }),
    );

    const legs = upserts(plan.changes, "transactions");
    expect(legs.map((leg) => leg.payload)).toMatchObject([
      { type: "TRANSFER", amount: "-40.00" },
      { type: "TRANSFER", amount: "40.00" },
    ]);
  });

  it("creates the categories and accounts the file mentions, before the rows using them", () => {
    const plan = buildImportPlan(
      [row({ categoryName: "Rent", outcomeAccountName: "Card", outcome: "800" })],
      context(),
    );

    const [newCategory] = upserts(plan.changes, "categories");
    const [newAccount] = upserts(plan.changes, "accounts");
    const [transaction] = upserts(plan.changes, "transactions");

    expect(newCategory.payload).toMatchObject({ name: "Rent", colorId: null });
    // The palette is the server's to key, so a brand-new color travels as a hex.
    expect(newCategory.payload).toHaveProperty("colorHex", expect.stringMatching(/^#[0-9a-f]{6}$/));
    expect(newAccount.payload).toMatchObject({ name: "Card", currencyCode: "USD" });

    // Order is what makes the batch pushable: the parents exist before their dependents.
    expect(plan.changes.indexOf(newCategory)).toBeLessThan(plan.changes.indexOf(transaction));
    expect(plan.changes.indexOf(newAccount)).toBeLessThan(plan.changes.indexOf(transaction));
    expect(transaction.payload).toMatchObject({
      accountId: newAccount.row.id,
      categoryId: newCategory.row.id,
    });
  });

  it("rejects a mismatching row without changing the account's currency or holdings", () => {
    const plan = buildImportPlan(
      [
        row({
          outcomeAccountName: "Wallet",
          outcome: "5",
          outcomeCurrencyShortTitle: "eur",
        }),
      ],
      context({ accounts: [account()] }),
    );

    expect(upserts(plan.changes, "accounts")).toEqual([]);
    expect(upserts(plan.changes, "transactions")).toEqual([]);
    expect(plan.createdTransactionIds).toEqual([]);
    expect(plan.failures).toEqual([
      {
        row: 1,
        reason:
          'Currency mismatch for account "Wallet": the file uses EUR, but the account uses USD. Choose a matching account or correct the file.',
      },
    ]);
  });

  it("warns about a currency it has no code for, rather than quietly using dollars", () => {
    const plan = buildImportPlan(
      [
        row({ outcomeAccountName: "Millennium", outcome: "20", outcomeCurrencyShortTitle: "PLN" }),
        row({ outcomeAccountName: "Wallet", outcome: "5", outcomeCurrencyShortTitle: "pln" }),
      ],
      context({ accounts: [account()] }),
    );

    // Only a new account can use the explicitly warned unsupported-currency fallback.
    expect(plan.createdTransactionIds).toHaveLength(1);
    expect(plan.failures).toEqual([
      {
        row: 2,
        reason:
          'Currency mismatch for account "Wallet": the file uses PLN, but the account uses USD. Choose a matching account or correct the file.',
      },
    ]);
    expect(plan.warnings).toEqual([
      {
        currency: "PLN",
        accounts: [
          // Created in dollars, since the file names a currency this app cannot store...
          { name: "Millennium", currencyCode: "USD" },
        ],
      },
    ]);
  });

  it("checks both transfer currencies before importing either leg", () => {
    const plan = buildImportPlan(
      [
        row({
          outcomeAccountName: "Wallet",
          outcome: "10",
          outcomeCurrencyShortTitle: "USD",
          incomeAccountName: "Euro card",
          income: "10",
          incomeCurrencyShortTitle: "USD",
        }),
      ],
      context({
        accounts: [account(), account({ id: "euro", name: "Euro card", currencyCode: "EUR" })],
      }),
    );

    expect(upserts(plan.changes, "transactions")).toEqual([]);
    expect(upserts(plan.changes, "accounts")).toEqual([]);
    expect(plan.failures).toEqual([
      {
        row: 1,
        reason:
          'Currency mismatch for account "Euro card": the file uses USD, but the account uses EUR. Choose a matching account or correct the file.',
      },
    ]);
  });

  it.each(["EUR", "PLN"])(
    "rejects a later %s claim for an account created in USD in the same file",
    (currency) => {
      const plan = buildImportPlan(
        [
          row({ outcomeAccountName: "Card", outcome: "10", outcomeCurrencyShortTitle: "USD" }),
          row({ outcomeAccountName: "Card", outcome: "20", outcomeCurrencyShortTitle: currency }),
        ],
        context(),
      );

      expect(
        upserts(plan.changes, "accounts").map((change) => change.payload.currencyCode),
      ).toEqual(["USD"]);
      expect(upserts(plan.changes, "transactions").map((change) => change.payload.amount)).toEqual([
        "-10.00",
      ]);
      expect(plan.failures).toMatchObject([
        { row: 2, reason: expect.stringContaining("Currency mismatch") },
      ]);
      expect(plan.warnings).toEqual([]);
    },
  );

  it("allows a supported currency named after a blank currency cell without guessing a conversion", () => {
    const plan = buildImportPlan(
      [
        row({ outcomeAccountName: "Card", outcome: "10" }),
        row({ outcomeAccountName: "Card", outcome: "20", outcomeCurrencyShortTitle: "eur" }),
      ],
      context(),
    );

    expect(upserts(plan.changes, "accounts").map((change) => change.payload.currencyCode)).toEqual([
      "EUR",
    ]);
    expect(upserts(plan.changes, "transactions").map((change) => change.payload.amount)).toEqual([
      "-10.00",
      "-20.00",
    ]);
    expect(plan.failures).toEqual([]);
  });

  it("reuses matching currencies without changing archived accounts or opening balances", () => {
    const existing = account({ currencyCode: "EUR", initialBalance: "125.50", status: "ARCHIVED" });
    const plan = buildImportPlan(
      [row({ incomeAccountName: "Wallet", income: "5", incomeCurrencyShortTitle: " eur " })],
      context({ accounts: [existing] }),
    );

    expect(upserts(plan.changes, "accounts")).toEqual([]);
    expect(upserts(plan.changes, "transactions").map((change) => change.payload.amount)).toEqual([
      "5.00",
    ]);
    expect(plan.failures).toEqual([]);
    expect(existing).toMatchObject({
      currencyCode: "EUR",
      initialBalance: "125.50",
      status: "ARCHIVED",
    });
  });

  it("says nothing about a blank currency column, which claims nothing", () => {
    const plan = buildImportPlan(
      [row({ outcomeAccountName: "Card", outcome: "20" })],
      context({ accounts: [] }),
    );

    expect(plan.warnings).toEqual([]);
  });

  it("reports unusable rows instead of dropping them silently", () => {
    const plan = buildImportPlan(
      [
        row({ createdDate: "not a date", outcomeAccountName: "Wallet", outcome: "1" }),
        row({ outcomeAccountName: "Wallet", outcome: "abc" }),
        row({ outcomeAccountName: "Wallet" }),
      ],
      context({ accounts: [account()] }),
    );

    expect(plan.createdTransactionIds).toEqual([]);
    expect(plan.failures).toEqual([
      { row: 1, reason: 'Invalid date: "not a date"' },
      { row: 2, reason: 'Invalid outcome amount: "abc"' },
      { row: 3, reason: "Both income and outcome are empty or zero" },
    ]);
  });
});
