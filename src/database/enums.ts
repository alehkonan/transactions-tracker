import { pgEnum } from "drizzle-orm/pg-core";

export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "ARCHIVED"]);

export const accountTypeEnum = pgEnum("account_type", ["CURRENT", "SAVING"]);

export const currencyCodeEnum = pgEnum("currency_code", [
  "USD",
  "GEL",
  "BYN",
  "KZT",
  "RUB",
  "TRY",
  "EUR",
  "UZS",
]);

export const transactionTypeEnum = pgEnum("transaction_type", ["INCOME", "EXPENSE", "TRANSFER"]);

export const necessityLevelEnum = pgEnum("necessity_level", ["LOW", "MEDIUM", "HIGH", "ESSENTIAL"]);
