import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { money } from "./custom-types";
import {
  accountStatusEnum,
  accountTypeEnum,
  currencyCodeEnum,
  necessityLevelEnum,
  transactionTypeEnum,
} from "./enums";

export const profilesTable = pgTable("profiles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
});

export const colorsTable = pgTable("colors", {
  id: serial("id").primaryKey(),
  hex: varchar("hex", { length: 7 }).unique().notNull(),
});

export const categoriesTable = pgTable("categories", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  profileId: integer("profile_id").references(() => profilesTable.id, {
    onUpdate: "cascade",
    onDelete: "cascade",
  }),
  colorId: integer("color_id").references(() => colorsTable.id, {
    onUpdate: "cascade",
    onDelete: "set null",
  }),
});

export const accountsTable = pgTable("accounts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  /** Opening amount the account started with, before any transaction. */
  initialBalance: money("initial_balance").notNull().default("0"),
  /** `initialBalance` plus the sum of the account's transactions. */
  balance: money("balance").notNull().default("0"),
  currencyCode: currencyCodeEnum("currency_code").notNull().default("USD"),
  status: accountStatusEnum("status").notNull().default("ACTIVE"),
  type: accountTypeEnum("type").notNull().default("CURRENT"),
  profileId: integer("profile_id").references(() => profilesTable.id, {
    onUpdate: "cascade",
    onDelete: "cascade",
  }),
});

export const transactionsTable = pgTable("transactions", {
  id: serial("id").primaryKey(),
  type: transactionTypeEnum("type").notNull(),
  necessityLevel: necessityLevelEnum("necessity_level").notNull().default("MEDIUM"),
  amount: money("amount").notNull(),
  comment: text("comment"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  accountId: integer("account_id").references(() => accountsTable.id, {
    onUpdate: "cascade",
    onDelete: "cascade",
  }),
  categoryId: integer("category_id").references(() => categoriesTable.id, {
    onUpdate: "cascade",
    onDelete: "set null",
  }),
});
