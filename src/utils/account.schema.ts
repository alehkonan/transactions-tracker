import z from "zod";
import { CurrencyCodeSchema } from "./currency.schema";

export const AccountTypeSchema = z.enum(["CURRENT", "SAVING"]);

export const AccountStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  balance: z.number(),
  type: AccountTypeSchema,
  currencyCode: CurrencyCodeSchema,
  status: AccountStatusSchema,
});
