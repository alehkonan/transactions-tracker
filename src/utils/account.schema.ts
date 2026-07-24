import z from "zod";
import { CurrencyCodeSchema } from "./currency.schema";

export const AccountTypeSchema = z.enum(["CURRENT", "SAVING"]);

export const AccountStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);

export const AccountSchema = z.object({
  id: z.number(),
  name: z.string(),
  // numeric(14,2) — Drizzle represents it as a decimal string to keep precision.
  balance: z.string(),
  type: AccountTypeSchema,
  currencyCode: CurrencyCodeSchema,
  status: AccountStatusSchema,
});
