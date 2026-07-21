import { integer, pgEnum, pgTable, real, serial, text } from "drizzle-orm/pg-core";

export const accountTypeEnum = pgEnum("account_type", ["CURRENT", "SAVING"]);
export const accountStatusEnum = pgEnum("account_status", ["ACTIVE", "ARCHIVED"]);
export const currencyCodeEnum = pgEnum("currency_code", ["USD", "GEL"]);
export const necessityLevelEnum = pgEnum("necessity_level", ["LOW", "MEDIUM", "HIGH", "ESSENTIAL"]);
export const transactionTypeEnum = pgEnum("transaction_type", ["INCOME", "OUTCOME", "TRANSFER", "DEBT"]);

export const accounts = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  balance: real("balance").notNull().default(0),
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
  type: transactionTypeEnum("type").notNull(),
  amount: real("amount").notNull(),
  srcAccountId: integer("src_account_id").references(() => accounts.id),
  destAccountId: integer("dest_account_id").references(() => accounts.id),
  categoryId: integer("category_id").references(() => categories.id),
  necessityLevel: necessityLevelEnum("necessity_level"),
});
