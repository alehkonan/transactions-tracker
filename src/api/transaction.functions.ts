import { createServerFn } from "@tanstack/react-start";
import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { necessityLevelEnum, transactionTypeEnum } from "~/database/enums";
import { getDb } from "~/database/getDb.server";
import { accountsTable, categoriesTable, transactionsTable } from "~/database/tables";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getTransactions = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    return getDb()
      .select({
        id: transactionsTable.id,
        createdAt: transactionsTable.createdAt,
        categoryId: transactionsTable.categoryId,
        category: categoriesTable.name,
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
      .leftJoin(accountsTable, eq(transactionsTable.accountId, accountsTable.id));
  });

export type TransactionRow = Awaited<ReturnType<typeof getTransactions>>[number];

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
const INSERT_CHUNK_SIZE = 1000;

/** Sums decimal money strings via integer cents, to avoid floating-point drift from repeated addition. */
function sumMoney(amounts: string[]): string {
  const totalCents = amounts.reduce((sum, amount) => sum + Math.round(Number(amount) * 100), 0);
  return (totalCents / 100).toFixed(2);
}

function negateMoney(amount: string): string {
  const trimmed = amount.trim();
  return trimmed.startsWith("-") ? trimmed.slice(1) : `-${trimmed}`;
}

/** Groups signed amounts by the account they affect, dropping rows with no account. */
function groupAmountsByAccount(
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
