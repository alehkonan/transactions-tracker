import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import {
  accounts,
  categories,
  currencyCodeEnum,
  necessityLevelEnum,
  transactions,
} from "~/database/schema";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

const incomeAccounts = alias(accounts, "income_accounts");
const outcomeAccounts = alias(accounts, "outcome_accounts");

export const getTransactions = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    return getDb()
      .select({
        id: transactions.id,
        createdAt: transactions.createdAt,
        category: categories.name,
        necessityLevel: transactions.necessityLevel,
        incomeAccount: incomeAccounts.name,
        incomeAmount: transactions.incomeAmount,
        incomeCurrency: transactions.incomeCurrency,
        outcomeAccount: outcomeAccounts.name,
        outcomeAmount: transactions.outcomeAmount,
        outcomeCurrency: transactions.outcomeCurrency,
        comment: transactions.comment,
      })
      .from(transactions)
      .leftJoin(categories, eq(transactions.categoryId, categories.id))
      .leftJoin(incomeAccounts, eq(transactions.incomeAccountId, incomeAccounts.id))
      .leftJoin(outcomeAccounts, eq(transactions.outcomeAccountId, outcomeAccounts.id));
  });

export type TransactionRow = Awaited<ReturnType<typeof getTransactions>>[number];

const transactionInputSchema = z.object({
  createdAt: z.string().optional(),
  categoryId: z.number().optional(),
  necessityLevel: z.enum(necessityLevelEnum.enumValues).optional(),
  incomeAccountId: z.number().optional(),
  incomeAmount: z.string().optional(),
  incomeCurrency: z.enum(currencyCodeEnum.enumValues).optional(),
  outcomeAccountId: z.number().optional(),
  outcomeAmount: z.string().optional(),
  outcomeCurrency: z.enum(currencyCodeEnum.enumValues).optional(),
});

// Postgres allows at most 65535 bind parameters per query; each row here uses up to 8.
const INSERT_CHUNK_SIZE = 1000;

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
      await db.insert(transactions).values(rows.slice(i, i + INSERT_CHUNK_SIZE));
    }

    return { count: inputs.length };
  });
