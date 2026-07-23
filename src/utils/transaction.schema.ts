import z from "zod";
import { AccountSchema } from "./account.schema";

export const TransactionNecessityLevel = z.enum(["LOW", "MEDIUM", "HIGH", "ESSENTIAL"]);

export const TransactionType = z.enum(["INCOME", "OUTCOME", "TRANSFER", "DEBT"]);

export const TransactionCategory = z.object({
  id: z.number(),
  name: z.string(),
  defaultNecessityLevel: TransactionNecessityLevel.optional(),
});

export const TransactionSchema = z.object({
  id: z.number(),
  srcAccountId: AccountSchema.shape.id.optional(),
  destAccountId: AccountSchema.shape.id.optional(),
  categoryId: TransactionCategory.shape.id.optional(),
  necessityLevel: TransactionNecessityLevel.optional(),
  amount: z.number(),
});
