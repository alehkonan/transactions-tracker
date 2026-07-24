import z from "zod";
import { AccountSchema } from "./account.schema";
import { CurrencyCodeSchema } from "./currency.schema";

export const TransactionNecessityLevel = z.enum(["LOW", "MEDIUM", "HIGH", "ESSENTIAL"]);

export const TransactionCategory = z.object({
  id: z.number(),
  name: z.string(),
  defaultNecessityLevel: TransactionNecessityLevel.optional(),
});

export const TransactionSchema = z.object({
  id: z.number(),
  categoryId: TransactionCategory.shape.id.optional(),
  necessityLevel: TransactionNecessityLevel.optional(),
  // numeric(14,2) — Drizzle represents it as a decimal string to keep precision.
  incomeAmount: z.string().optional(),
  incomeAccountId: AccountSchema.shape.id.optional(),
  incomeCurrencyCode: CurrencyCodeSchema.optional(),
  outcomeAmount: z.string().optional(),
  outcomeAccountId: AccountSchema.shape.id.optional(),
  outcomeCurrencyCode: CurrencyCodeSchema.optional(),
  createdAt: z.date(),
  comment: z.string().optional(),
});
