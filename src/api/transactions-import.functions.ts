import { createServerFn } from "@tanstack/react-start";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { currencyCodeEnum } from "~/database/enums";
import { getDb } from "~/database/getDb.server";
import { accountsTable, categoriesTable, colorsTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";
import {
  groupAmountsByAccount,
  INSERT_CHUNK_SIZE,
  negateMoney,
  sumMoney,
} from "./transaction.functions";

type CurrencyCode = (typeof currencyCodeEnum.enumValues)[number];
type TransactionType = "INCOME" | "EXPENSE" | "TRANSFER";

const importRowSchema = z.object({
  categoryName: z.string(),
  comment: z.string(),
  outcomeAccountName: z.string(),
  outcome: z.string(),
  outcomeCurrencyShortTitle: z.string(),
  incomeAccountName: z.string(),
  income: z.string(),
  incomeCurrencyShortTitle: z.string(),
  createdDate: z.string(),
});

export type ImportFailure = { row: number; reason: string };

export type ImportReport = {
  createdCount: number;
  failedCount: number;
  failures: ImportFailure[];
  durationMs: number;
  createdTransactionIds: number[];
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

function toHex(x: number): string {
  return Math.round(255 * x)
    .toString(16)
    .padStart(2, "0");
}

function hslToHex(hue: number, saturationPct: number, lightnessPct: number): string {
  const s = saturationPct / 100;
  const l = lightnessPct / 100;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

/** Generates `count` random hex colors that collide with neither `existingHexes` nor each other. */
function generateUniqueHexColors(count: number, existingHexes: Iterable<string>): string[] {
  const used = new Set(existingHexes);
  const result: string[] = [];
  let attempts = 0;

  while (result.length < count && attempts < count * 50 + 200) {
    attempts++;
    const hue = Math.floor(Math.random() * 360);
    const saturation = 55 + Math.floor(Math.random() * 25);
    const lightness = 45 + Math.floor(Math.random() * 15);
    const hex = hslToHex(hue, saturation, lightness);
    if (used.has(hex)) continue;
    used.add(hex);
    result.push(hex);
  }

  if (result.length < count) throw new Error("Could not generate enough unique category colors.");
  return result;
}

type PreparedRow = {
  createdAt: Date;
  categoryId?: number;
  comment?: string;
  type: TransactionType;
  accountId: number;
  amount: string;
};

/**
 * Imports transactions from parsed CSV rows: creates any missing categories (each with a
 * freshly generated color) and accounts (with their CSV-derived currency, correcting existing
 * accounts whose currency has drifted), then inserts one `transactionsTable` row per side of
 * each CSV row — both sides for a row that has both an income and an outcome are tagged
 * TRANSFER since they move money between the user's own accounts rather than in/out of them.
 * Category/account lookups and creations are scoped to the profile selected when the import was
 * started, so importing under one profile can't reuse or leak into another's accounts/categories.
 */
export const importTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.array(importRowSchema))
  .handler(async ({ data: rows, context }): Promise<ImportReport> => {
    const startedAt = Date.now();

    const { profileId } = context;
    if (profileId == null) throw new Error("No profile selected.");

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

    const report = await getDb().transaction(async (tx) => {
      const categoryMap = new Map<string, number>();
      if (categoryNames.size > 0) {
        const existingCategories = await tx.query.categoriesTable.findMany({
          where: and(
            inArray(categoriesTable.name, [...categoryNames]),
            eq(categoriesTable.profileId, profileId),
          ),
          columns: { id: true, name: true },
        });
        for (const category of existingCategories) categoryMap.set(category.name, category.id);

        const missingCategoryNames = [...categoryNames].filter((name) => !categoryMap.has(name));
        if (missingCategoryNames.length > 0) {
          const existingColors = await tx.select({ hex: colorsTable.hex }).from(colorsTable);
          const hexes = generateUniqueHexColors(
            missingCategoryNames.length,
            existingColors.map((color) => color.hex),
          );
          const insertedColors = await tx
            .insert(colorsTable)
            .values(hexes.map((hex) => ({ hex })))
            .returning({ id: colorsTable.id });
          const insertedCategories = await tx
            .insert(categoriesTable)
            .values(
              missingCategoryNames.map((name, i) => ({
                name,
                colorId: insertedColors[i].id,
                profileId,
              })),
            )
            .returning({ id: categoriesTable.id, name: categoriesTable.name });
          for (const category of insertedCategories) categoryMap.set(category.name, category.id);
        }
      }

      const accountMap = new Map<string, number>();
      if (accountCurrencies.size > 0) {
        const existingAccounts = await tx.query.accountsTable.findMany({
          where: and(
            inArray(accountsTable.name, [...accountCurrencies.keys()]),
            eq(accountsTable.profileId, profileId),
          ),
          columns: { id: true, name: true, currencyCode: true },
        });
        for (const account of existingAccounts) {
          accountMap.set(account.name, account.id);
          const desiredCurrency = normalizeCurrencyCode(accountCurrencies.get(account.name) ?? "");
          if (desiredCurrency && desiredCurrency !== account.currencyCode) {
            await tx
              .update(accountsTable)
              .set({ currencyCode: desiredCurrency })
              .where(eq(accountsTable.id, account.id));
          }
        }

        const missingAccountNames = [...accountCurrencies.keys()].filter(
          (name) => !accountMap.has(name),
        );
        if (missingAccountNames.length > 0) {
          const insertedAccounts = await tx
            .insert(accountsTable)
            .values(
              missingAccountNames.map((name) => ({
                name,
                currencyCode: normalizeCurrencyCode(accountCurrencies.get(name) ?? "") ?? "USD",
                profileId,
              })),
            )
            .returning({ id: accountsTable.id, name: accountsTable.name });
          for (const account of insertedAccounts) accountMap.set(account.name, account.id);
        }
      }

      const preparedRows: PreparedRow[] = [];
      const failures: ImportFailure[] = [];

      rows.forEach((row, index) => {
        const rowNumber = index + 1;

        const createdAt = new Date(row.createdDate);
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
          categoryId: categoryName ? categoryMap.get(categoryName) : undefined,
          comment: row.comment.trim() || undefined,
        };

        if (outcomeAmount > 0 && incomeAmount > 0) {
          const outcomeAccountId = accountMap.get(row.outcomeAccountName);
          const incomeAccountId = accountMap.get(row.incomeAccountName);
          if (!outcomeAccountId || !incomeAccountId) {
            const unknownName = !outcomeAccountId ? row.outcomeAccountName : row.incomeAccountName;
            failures.push({ row: rowNumber, reason: `Unknown account: "${unknownName}"` });
            return;
          }
          preparedRows.push({
            ...shared,
            type: "TRANSFER",
            accountId: outcomeAccountId,
            amount: negateMoney(outcomeAmount.toFixed(2)),
          });
          preparedRows.push({
            ...shared,
            type: "TRANSFER",
            accountId: incomeAccountId,
            amount: incomeAmount.toFixed(2),
          });
          return;
        }

        if (outcomeAmount > 0) {
          const accountId = accountMap.get(row.outcomeAccountName);
          if (!accountId) {
            failures.push({
              row: rowNumber,
              reason: `Unknown account: "${row.outcomeAccountName}"`,
            });
            return;
          }
          preparedRows.push({
            ...shared,
            type: "EXPENSE",
            accountId,
            amount: negateMoney(outcomeAmount.toFixed(2)),
          });
          return;
        }

        const accountId = accountMap.get(row.incomeAccountName);
        if (!accountId) {
          failures.push({ row: rowNumber, reason: `Unknown account: "${row.incomeAccountName}"` });
          return;
        }
        preparedRows.push({
          ...shared,
          type: "INCOME",
          accountId,
          amount: incomeAmount.toFixed(2),
        });
      });

      const createdTransactionIds: number[] = [];
      for (let i = 0; i < preparedRows.length; i += INSERT_CHUNK_SIZE) {
        const inserted = await tx
          .insert(transactionsTable)
          .values(preparedRows.slice(i, i + INSERT_CHUNK_SIZE))
          .returning({ id: transactionsTable.id });
        createdTransactionIds.push(...inserted.map((row) => row.id));
      }

      const deltas = groupAmountsByAccount(preparedRows);
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }

      return {
        createdCount: preparedRows.length,
        failedCount: failures.length,
        failures,
        createdTransactionIds,
      };
    });

    return { ...report, durationMs: Date.now() - startedAt };
  });
