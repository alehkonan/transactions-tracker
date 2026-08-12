import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { getDb } from "~/database/get-db.server";
import { accountsTable, categoriesTable, colorsTable, transactionsTable } from "~/database/tables";
import { toCsv } from "~/utils/to-csv";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { assertAccountsInProfile, assertCategoriesInProfile } from "./ownership.server";
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

/**
 * Restricts a transaction-level query to rows reachable from `profileId`. Transactions have no
 * profile of their own — they inherit one through the account they belong to.
 */
function transactionsInProfile(profileId: number) {
  return sql`${transactionsTable.accountId} in (
    select ${accountsTable.id} from ${accountsTable}
    where ${accountsTable.profileId} = ${profileId}
  )`;
}

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.array(z.number()))
  .handler(async ({ data: ids, context }) => {
    if (ids.length === 0 || context.profileId == null) return;

    // Ids come from the client, so both statements below are scoped to the caller's own
    // transactions. Reading through the same filter also keeps the balance deltas honest:
    // rows the caller cannot see cannot move anyone's balance either.
    const scope = and(inArray(transactionsTable.id, ids), transactionsInProfile(context.profileId));

    await getDb().transaction(async (tx) => {
      const removed = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(scope);

      await tx.delete(transactionsTable).where(scope);

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
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.array(transactionInputSchema))
  .handler(async ({ data: inputs, context }) => {
    if (inputs.length === 0) return { count: 0 };
    if (context.profileId == null) return { count: 0 };

    // Nothing may be filed against an account or category outside the caller's profile.
    await Promise.all([
      assertAccountsInProfile(
        context.profileId,
        inputs.map((input) => input.accountId),
      ),
      assertCategoriesInProfile(
        context.profileId,
        inputs.map((input) => input.categoryId),
      ),
    ]);

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
  .middleware([loggerMiddleware, authMiddleware, profileMiddleware])
  .validator(z.object({ id: z.number(), ...transactionInputSchema.shape }))
  .handler(async ({ data: { id, createdAt, ...input }, context }) => {
    if (context.profileId == null) return;

    // Both the row being edited and the account/category it is being moved onto have to be the
    // caller's, or an edit could reach across profiles in either direction.
    const profileId = context.profileId;
    await Promise.all([
      assertAccountsInProfile(profileId, [input.accountId]),
      assertCategoriesInProfile(profileId, [input.categoryId]),
    ]);

    const scope = and(eq(transactionsTable.id, id), transactionsInProfile(profileId));

    await getDb().transaction(async (tx) => {
      const [previous] = await tx
        .select({ accountId: transactionsTable.accountId, amount: transactionsTable.amount })
        .from(transactionsTable)
        .where(scope);

      // No visible row means it is not the caller's to edit — bail before touching any balance.
      if (!previous) return;

      await tx
        .update(transactionsTable)
        .set({ ...input, createdAt: createdAt ? new Date(createdAt) : undefined })
        .where(scope);

      // Reverse the row's old effect and apply its new one; if the account didn't
      // change, these net out to a single delta on that account.
      const deltas = groupAmountsByAccount([
        { accountId: previous.accountId, amount: negateMoney(previous.amount) },
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
