import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "~/database/getDb.server";
import { currencyCodeEnum, necessityLevelEnum, transactions } from "~/database/schema";
import { authMiddleware } from "./auth.middleware";
import { loggerMiddleware } from "./logger.middleware";

export const getTransactions = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async () => {
    return getDb().select().from(transactions);
  });

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
