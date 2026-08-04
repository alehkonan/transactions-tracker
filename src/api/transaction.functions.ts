import { createServerFn } from "@tanstack/react-start";
import { eq, inArray } from "drizzle-orm";
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
        category: categoriesTable.name,
        necessityLevel: transactionsTable.necessityLevel,
        type: transactionsTable.type,
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

export const deleteTransactions = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(z.array(z.number()))
  .handler(async ({ data: ids }) => {
    if (ids.length === 0) return;
    await getDb().delete(transactionsTable).where(inArray(transactionsTable.id, ids));
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

    const db = getDb();
    for (let i = 0; i < rows.length; i += INSERT_CHUNK_SIZE) {
      await db.insert(transactionsTable).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }

    return { count: inputs.length };
  });
