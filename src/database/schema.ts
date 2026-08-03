import { integer, numeric, pgEnum, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

export const accountTypeEnum = pgEnum("account_type", ["CURRENT", "SAVING"]);
export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "ARCHIVED"]);
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
export const necessityLevelEnum = pgEnum("necessity_level", ["LOW", "MEDIUM", "HIGH", "ESSENTIAL"]);

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  balance: money("balance").notNull().default("0"),
  type: accountTypeEnum("type").notNull().default("CURRENT"),
  currencyCode: currencyCodeEnum("currency_code").notNull().default("USD"),
  status: accountStatusEnum("status").notNull().default("ACTIVE"),
});

export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  defaultNecessityLevel: necessityLevelEnum("default_necessity_level"),
});

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  categoryId: integer("category_id").references(() => categories.id),
  necessityLevel: necessityLevelEnum("necessity_level"),
  incomeAccountId: integer("income_account_id").references(() => accounts.id),
  incomeAmount: money("income_amount"),
  incomeCurrency: currencyCodeEnum("income_currency"),
  outcomeAccountId: integer("outcome_account_id").references(() => accounts.id),
  outcomeAmount: money("outcome_amount"),
  outcomeCurrency: currencyCodeEnum("outcome_currency"),
  comment: text("comment"),
});
