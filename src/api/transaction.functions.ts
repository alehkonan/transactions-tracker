import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { getDb } from "~/database/getDb.server";
import { accountsTable, categoriesTable, colorsTable, transactionsTable } from "~/database/tables";
import { toCsv } from "~/utils/toCsv";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { profileMiddleware } from "./profile.middleware";

/** Parses a `yyyy-MM-dd` filter bound as a local-midnight Date. */
function parseDateOnly(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

const transactionsFilterSchema = z
  .object({
    from: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    to: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    account: z.string().optional(),
  })
  .optional();

export const getTransactions = createServerFn()
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(transactionsFilterSchema)
  .handler(async ({ data, context }) => {
    if (context.profileId == null) return [];

    const conditions = [eq(accountsTable.profileId, context.profileId)];
    if (data?.from) conditions.push(gte(transactionsTable.createdAt, parseDateOnly(data.from)));
    if (data?.to) {
      const exclusiveEnd = parseDateOnly(data.to);
      exclusiveEnd.setDate(exclusiveEnd.getDate() + 1);
      conditions.push(lt(transactionsTable.createdAt, exclusiveEnd));
    }
    if (data?.account) conditions.push(eq(accountsTable.name, data.account));

    const [rows, rates] = await Promise.all([
      getDb()
        .select({
          id: transactionsTable.id,
          createdAt: transactionsTable.createdAt,
          categoryId: transactionsTable.categoryId,
          category: categoriesTable.name,
          categoryColorHex: colorsTable.hex,
          necessityLevel: transactionsTable.necessityLevel,
          type: transactionsTable.type,
          accountId: transactionsTable.accountId,
          account: accountsTable.name,
          amount: transactionsTable.amount,
          currencyCode: accountsTable.currencyCode,
          comment: transactionsTable.comment,
        })
        .from(transactionsTable)
        .leftJoin(categoriesTable, eq(transactionsTable.categoryId, categoriesTable.id))
        .leftJoin(colorsTable, eq(categoriesTable.colorId, colorsTable.id))
        .leftJoin(accountsTable, eq(transactionsTable.accountId, accountsTable.id))
        .where(and(...conditions))
        .orderBy(desc(transactionsTable.createdAt)),
      getUsdRates(),
    ]);

    return rows.map((row) =>
      Object.assign(row, {
        approxAmountUsd:
          row.currencyCode != null
            ? (Number(row.amount) / (rates[row.currencyCode] ?? 1)).toFixed(2)
            : null,
      }),
    );
  });

export type TransactionRow = Awaited<ReturnType<typeof getTransactions>>[number];

/** Exports the selected profile's transactions as CSV, with account/category ids replaced by names. */
export const exportTransactionsToCsv = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    const transactions = await getTransactions();

    const rows = transactions.map((row) => [
      row.createdAt.toISOString(),
      row.type,
      row.account,
      row.category,
      row.necessityLevel,
      row.amount,
      row.currencyCode,
      row.comment,
    ]);

    const csv = toCsv(
      ["Date", "Type", "Account", "Category", "Necessity level", "Amount", "Currency", "Comment"],
      rows,
    );
    return { csv, count: transactions.length };
  });

const transactionInputSchema = z.object({
  createdAt: z.string().optional(),
  categoryId: z.number().optional(),
  necessityLevel: z.enum(necessityLevelEnum.enumValues).optional(),
  type: z.enum(transactionTypeEnum.enumValues),
  accountId: z.number().optional(),
  amount: z.string(),
  comment: z.string().optional(),
});

// Postgres allows at most 65535 bind parameters per query; each row here uses up to 6.
export const INSERT_CHUNK_SIZE = 1000;

/** Sums decimal money strings via integer cents, to avoid floating-point drift from repeated addition. */
export function sumMoney(amounts: string[]): string {
  const totalCents = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  return (totalCents / 100).toFixed(2);
}

export function negateMoney(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
}

/** Groups signed amounts by the account they affect, dropping rows with no account. */
export function groupAmountsByAccount(
  rows: { accountId?: number | null; amount: string }[],
): Map<number, string[]> {
  const byAccount = new Map<number, string[]>();
  for (const { accountId, amount } of rows) {
    if (accountId == null) continue;
    byAccount.set(accountId, [...(byAccount.get(accountId) ?? []), amount]);
  }
  return byAccount;
}

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(z.number()))
  .handler(async ({ data: ids }) => {
    if (ids.length === 0) return;

    await getDb().transaction(async (tx) => {
      const removed = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(inArray(transactionsTable.id, ids));

      await tx.delete(transactionsTable).where(inArray(transactionsTable.id, ids));

      // Deleting a transaction reverses its effect on the account's balance.
      const deltas = groupAmountsByAccount(
        removed.map((row) => ({ accountId: row.accountId, amount: negateMoney(row.amount) })),
      );
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });
  });

export const createTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(transactionInputSchema))
  .handler(async ({ data: inputs }) => {
    if (inputs.length === 0) return { count: 0 };

    const rows = inputs.map(({ createdAt, ...input }) => ({
      ...input,
      createdAt: createdAt ? new Date(createdAt) : undefined,
    }));

    await getDb().transaction(async (tx) => {
      for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
        await tx.insert(transactionsTable).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
      }

      const deltas = groupAmountsByAccount(inputs);
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });

    return { count: inputs.length };
  });

export const updateTransaction = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.object({ id: z.number(), ...transactionInputSchema.shape }))
  .handler(async ({ data: { id, createdAt, ...input } }) => {
    await getDb().transaction(async (tx) => {
      const [previous] = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(eq(transactionsTable.id, id));

      await tx
        .update(transactionsTable)
        .set({ ...input, createdAt: createdAt ? new Date(createdAt) : undefined })
        .where(eq(transactionsTable.id, id));

      // Reverse the row's old effect and apply its new one; if the account didn't
      // change, these net out to a single delta on that account.
      const deltas = groupAmountsByAccount([
        ...(previous
          ? [{ accountId: previous.accountId, amount: negateMoney(previous.amount) }]
          : []),
        { accountId: input.accountId, amount: input.amount },
      ]);
      for (const [accountId, amounts] of deltas) {
        await tx
          .update(accountsTable)
          .set({ balance: sql`${accountsTable.balance} + ${sumMoney(amounts)}` })
          .where(eq(accountsTable.id, accountId));
      }
    });
  });
