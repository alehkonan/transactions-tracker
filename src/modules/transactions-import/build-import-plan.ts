import { currencyCodeEnum } from "~/database/enums";
import { newRow } from "~/modules/sync/mutations";
import { assertTransferPair } from "~/modules/transactions/linked-transfer";
import { isMoneyInput, negateMoney } from "~/utils/money";
import { uuidV7 } from "~/utils/uuid-v7";
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
  const normalized = raw.trim().replace(",", ".");
  if (!isMoneyInput(normalized, { allowNegative: true })) return undefined;
  const value = Number(normalized);
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
    if (row.outcomeAccountName && !accountCurrencies.get(row.outcomeAccountName)?.trim()) {
      accountCurrencies.set(row.outcomeAccountName, row.outcomeCurrencyShortTitle);
    }
    if (row.incomeAccountName && !accountCurrencies.get(row.incomeAccountName)?.trim()) {
      accountCurrencies.set(row.incomeAccountName, row.incomeCurrencyShortTitle);
    }
  }

  return { categoryNames, accountCurrencies };
}

/**
 * Plans an import: the categories and accounts it has to create and one transaction per side of
 * each CSV row. Existing account currencies are fixed; mismatching rows are reported. Both sides of
 * a row with income *and* an outcome are tagged TRANSFER, since they move money between the user's
 * own accounts rather than in or out of them.
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
  const existingAccountIds = new Set(context.accounts.map((account) => account.id));
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
      continue;
    }

    const payload: AccountPayload = {
      name,
      initialBalance: "0",
      currencyCode: currencyCode ?? "USD",
      status: "ACTIVE",
      type: "CURRENT", // Legacy protocol metadata, not a financial classification.
      profileId,
    };
    if (isUnsupported) noteUnsupportedCurrency(rawCurrency, name, payload.currencyCode);
    const row = newRow(payload);
    accountsByName.set(name, row);
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

    // Validate every used side of every row, including later claims about a newly created account.
    // Check both before writing either transfer leg, so a mismatch cannot import half a transfer.
    const sides = [
      {
        amount: outcomeAmount,
        name: row.outcomeAccountName,
        rawCurrency: row.outcomeCurrencyShortTitle,
      },
      {
        amount: incomeAmount,
        name: row.incomeAccountName,
        rawCurrency: row.incomeCurrencyShortTitle,
      },
    ];
    for (const side of sides) {
      if (!(side.amount > 0) || !side.rawCurrency.trim()) continue;
      const account = accountsByName.get(side.name);
      if (!account) continue; // The existing unknown-account feedback below names the missing side.
      const currency = normalizeCurrencyCode(side.rawCurrency);
      // Keep the explicit fallback warning for brand-new unsupported currencies. An existing
      // account never accepts money labelled with another (including unsupported) currency.
      const newUnsupportedAccount =
        !existingAccountIds.has(account.id) &&
        !currency &&
        side.rawCurrency.trim().toUpperCase() ===
          accountCurrencies.get(side.name)?.trim().toUpperCase();
      if (newUnsupportedAccount || currency === account.currencyCode) continue;
      failures.push({
        row: rowNumber,
        reason: `Currency mismatch for account "${account.name}": the file uses ${side.rawCurrency.trim().toUpperCase()}, but the account uses ${account.currencyCode}. Choose a matching account or correct the file.`,
      });
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
      const transferId = uuidV7();
      const outgoing: TransactionPayload = {
        ...shared,
        type: "TRANSFER",
        transferId,
        categoryId: null,
        accountId: outcomeAccountId,
        amount: negateMoney(outcomeAmount.toFixed(2)),
      };
      const incoming: TransactionPayload = {
        ...shared,
        type: "TRANSFER",
        transferId,
        categoryId: null,
        accountId: incomeAccountId,
        amount: incomeAmount.toFixed(2),
      };
      try {
        assertTransferPair([outgoing, incoming], [...accountsByName.values()]);
      } catch (error) {
        failures.push({ row: rowNumber, reason: (error as Error).message });
        return;
      }
      addTransaction(outgoing);
      addTransaction(incoming);
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
