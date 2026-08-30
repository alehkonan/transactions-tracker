import { currencyCodeEnum } from "~/database/enums";
import { newRow } from "~/modules/sync/mutations";
import { negateMoney } from "~/utils/money";
import { generateUniqueHexColors } from "./generate-hex-colors";
import { parseImportDate } from "./parse-import-date";
import type { ImportRow } from "./utils";
import type { LocalChange } from "~/modules/sync/mutations";
import type {
  AccountPayload,
  CategoryPayload,
  Color,
  SyncedAccount,
  SyncedCategory,
  TransactionPayload,
} from "~/modules/sync/sync-types";

/**
 * Turning parsed CSV rows into local writes.
 *
 * This used to be `importTransactions`, a server function that did the same work in SQL. It is a
 * pure function over the working set now: the client already holds every account, category and
 * color it needs to match against, so an import is decided in memory and lands in the outbox — which
 * makes it instant, offline-capable, and finally testable without a database.
 *
 * The one thing the client cannot decide is a color *id*, so new categories carry the hex instead
 * (see `generate-hex-colors.ts`).
 */

type CurrencyCode = (typeof currencyCodeEnum.enumValues)[number];

export type ImportFailure = { row: number; reason: string };

/**
 * A currency the file names that this app has no code for. The rows still import — the money is
 * real either way — but the account ends up denominated in something the file never said, which is
 * only honest if the import says so.
 */
export type ImportWarning = {
  /** The unsupported short title, as the file spelled it. */
  currency: string;
  /** The accounts filed under it, and the currency each one actually ended up with. */
  accounts: { name: string; currencyCode: CurrencyCode }[];
};

export type ImportPlan = {
  changes: LocalChange[];
  failures: ImportFailure[];
  warnings: ImportWarning[];
  /** What "discard" would have to delete — the accounts and categories are left alone, as before. */
  createdTransactionIds: string[];
};

/** What the plan is built against: this profile's live records, and the palette to avoid. */
export type ImportContext = {
  profileId: string;
  accounts: SyncedAccount[];
  categories: SyncedCategory[];
  colors: Color[];
};

function splitCategoryNames(raw: string): string[] {
  return raw
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);
}

/** Narrows a raw currency short title to a known `currencyCodeEnum` value, if it matches one. */
function normalizeCurrencyCode(raw: string): CurrencyCode | undefined {
  const upper = raw.trim().toUpperCase();
  return (currencyCodeEnum.enumValues as readonly string[]).includes(upper)
    ? (upper as CurrencyCode)
    : undefined;
}

/** Parses a CSV money cell; empty is a valid zero, anything non-numeric is `undefined`. */
function parseAmount(raw: string): number | undefined {
  if (!raw.trim()) return 0;
  const value = Number(raw.trim().replace(",", "."));
  return Number.isFinite(value) ? value : undefined;
}

/** The category and account names the file mentions, each with the currency it claims. */
function collectNames(rows: ImportRow[]): {
  categoryNames: Set<string>;
  accountCurrencies: Map<string, string>;
} {
  const categoryNames = new Set<string>();
  const accountCurrencies = new Map<string, string>();

  for (const row of rows) {
    for (const name of splitCategoryNames(row.categoryName)) categoryNames.add(name);
    if (row.outcomeAccountName && !accountCurrencies.has(row.outcomeAccountName)) {
      accountCurrencies.set(row.outcomeAccountName, row.outcomeCurrencyShortTitle);
    }
    if (row.incomeAccountName && !accountCurrencies.has(row.incomeAccountName)) {
      accountCurrencies.set(row.incomeAccountName, row.incomeCurrencyShortTitle);
    }
  }

  return { categoryNames, accountCurrencies };
}

/**
 * Plans an import: the categories and accounts it has to create, the accounts whose currency it
 * corrects, and one transaction per side of each CSV row — both sides of a row that has an income
 * *and* an outcome are tagged TRANSFER, since they move money between the user's own accounts
 * rather than in or out of them.
 *
 * Nothing is applied here. The caller commits the changes, which is what puts them in the store, on
 * disk and in the outbox in one go.
 */
export function buildImportPlan(rows: ImportRow[], context: ImportContext): ImportPlan {
  const { profileId } = context;
  const { categoryNames, accountCurrencies } = collectNames(rows);
  const changes: LocalChange[] = [];

  // A soft-deleted record is gone as far as every client is concerned, so a matching name has to
  // create a fresh one rather than resurrect it. (Tombstones never reach the store, so this is
  // simply what the store holds.)
  const categoryIdByName = new Map(
    context.categories.map((category) => [category.name, category.id]),
  );
  const missingCategoryNames = [...categoryNames].filter((name) => !categoryIdByName.has(name));
  const hexes = generateUniqueHexColors(
    missingCategoryNames.length,
    context.colors.map((color) => color.hex),
  );

  missingCategoryNames.forEach((name, index) => {
    // No `colorId` yet: the hex is what the server resolves into one, and the canonical row that
    // comes back is what tints the category. Until the push lands it draws untinted.
    const payload: CategoryPayload = { name, colorId: null, profileId, colorHex: hexes[index] };
    const row = newRow({ name, colorId: null, profileId });
    categoryIdByName.set(name, row.id);
    changes.push({ op: "upsert", table: "categories", row, payload });
  });

  const accountsByName = new Map(context.accounts.map((account) => [account.name, account]));
  const accountIdByName = new Map<string, string>();
  const unsupportedCurrencies = new Map<string, ImportWarning["accounts"]>();

  const noteUnsupportedCurrency = (raw: string, name: string, currencyCode: CurrencyCode) => {
    const currency = raw.trim().toUpperCase();
    const accounts = unsupportedCurrencies.get(currency);
    if (accounts) accounts.push({ name, currencyCode });
    else unsupportedCurrencies.set(currency, [{ name, currencyCode }]);
  };

  for (const [name, rawCurrency] of accountCurrencies) {
    const currencyCode = normalizeCurrencyCode(rawCurrency);
    // A blank currency column says nothing; a filled one this app can't place is worth reporting.
    const isUnsupported = rawCurrency.trim().length > 0 && currencyCode === undefined;
    const existing = accountsByName.get(name);

    if (existing) {
      accountIdByName.set(name, existing.id);
      if (isUnsupported) noteUnsupportedCurrency(rawCurrency, existing.name, existing.currencyCode);
      // An account whose currency has drifted from what the file says is corrected, as the server
      // import did. Everything else about it is left exactly as it is.
      if (currencyCode && currencyCode !== existing.currencyCode && existing.profileId != null) {
        const payload: AccountPayload = {
          name: existing.name,
          initialBalance: existing.initialBalance,
          currencyCode,
          status: existing.status,
          type: existing.type,
          profileId: existing.profileId,
        };
        changes.push({
          op: "upsert",
          table: "accounts",
          row: { ...existing, currencyCode },
          payload,
        });
      }
      continue;
    }

    const payload: AccountPayload = {
      name,
      initialBalance: "0",
      currencyCode: currencyCode ?? "USD",
      status: "ACTIVE",
      type: "CURRENT",
      profileId,
    };
    if (isUnsupported) noteUnsupportedCurrency(rawCurrency, name, payload.currencyCode);
    const row = newRow(payload);
    accountIdByName.set(name, row.id);
    changes.push({ op: "upsert", table: "accounts", row, payload });
  }

  const failures: ImportFailure[] = [];
  const createdTransactionIds: string[] = [];

  const addTransaction = (payload: TransactionPayload) => {
    const row = newRow(payload);
    createdTransactionIds.push(row.id);
    changes.push({ op: "upsert", table: "transactions", row, payload });
  };

  rows.forEach((row, index) => {
    const rowNumber = index + 1;

    const createdAt = parseImportDate(row.createdDate);
    if (!row.createdDate.trim() || Number.isNaN(createdAt.getTime())) {
      failures.push({ row: rowNumber, reason: `Invalid date: "${row.createdDate}"` });
      return;
    }

    const outcomeAmount = parseAmount(row.outcome);
    if (outcomeAmount === undefined) {
      failures.push({ row: rowNumber, reason: `Invalid outcome amount: "${row.outcome}"` });
      return;
    }
    const incomeAmount = parseAmount(row.income);
    if (incomeAmount === undefined) {
      failures.push({ row: rowNumber, reason: `Invalid income amount: "${row.income}"` });
      return;
    }
    if (!(outcomeAmount > 0) && !(incomeAmount > 0)) {
      failures.push({ row: rowNumber, reason: "Both income and outcome are empty or zero" });
      return;
    }

    const categoryName = splitCategoryNames(row.categoryName)[0];
    const shared = {
      createdAt,
      categoryId: (categoryName ? categoryIdByName.get(categoryName) : null) ?? null,
      comment: row.comment.trim() || null,
      necessityLevel: "MEDIUM",
      profileId,
    } satisfies Partial<TransactionPayload>;

    if (outcomeAmount > 0 && incomeAmount > 0) {
      const outcomeAccountId = accountIdByName.get(row.outcomeAccountName);
      const incomeAccountId = accountIdByName.get(row.incomeAccountName);
      if (!outcomeAccountId || !incomeAccountId) {
        const unknownName = !outcomeAccountId ? row.outcomeAccountName : row.incomeAccountName;
        failures.push({ row: rowNumber, reason: `Unknown account: "${unknownName}"` });
        return;
      }
      addTransaction({
        ...shared,
        type: "TRANSFER",
        accountId: outcomeAccountId,
        amount: negateMoney(outcomeAmount.toFixed(2)),
      });
      addTransaction({
        ...shared,
        type: "TRANSFER",
        accountId: incomeAccountId,
        amount: incomeAmount.toFixed(2),
      });
      return;
    }

    if (outcomeAmount > 0) {
      const accountId = accountIdByName.get(row.outcomeAccountName);
      if (!accountId) {
        failures.push({ row: rowNumber, reason: `Unknown account: "${row.outcomeAccountName}"` });
        return;
      }
      addTransaction({
        ...shared,
        type: "EXPENSE",
        accountId,
        amount: negateMoney(outcomeAmount.toFixed(2)),
      });
      return;
    }

    const accountId = accountIdByName.get(row.incomeAccountName);
    if (!accountId) {
      failures.push({ row: rowNumber, reason: `Unknown account: "${row.incomeAccountName}"` });
      return;
    }
    addTransaction({
      ...shared,
      type: "INCOME",
      accountId,
      amount: incomeAmount.toFixed(2),
    });
  });

  const warnings = [...unsupportedCurrencies].map(
    ([currency, accounts]): ImportWarning => ({ currency, accounts }),
  );

  return { changes, failures, warnings, createdTransactionIds };
}
