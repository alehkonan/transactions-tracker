import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";
import { money } from "./custom-types";
import {
  accountStatusEnum,
  accountTypeEnum,
  credentialDeviceTypeEnum,
  currencyCodeEnum,
  necessityLevelEnum,
  transactionTypeEnum,
  webauthnChallengeTypeEnum,
} from "./enums";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").unique().notNull(),
  /**
   * Opaque WebAuthn user handle (base64url) sent to the authenticator as `user.id`. Kept separate
   * from the primary key so the value stored on the user's device leaks nothing about the row, and
   * so it can never be reused for a different account.
   */
  webauthnUserId: text("webauthn_user_id").unique().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A passkey registered against a user — one row per authenticator. */
export const credentialsTable = pgTable(
  "credentials",
  {
    /** The authenticator's own credential ID, base64url-encoded. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onUpdate: "cascade", onDelete: "cascade" }),
    /** COSE-encoded public key, base64url. */
    publicKey: text("public_key").notNull(),
    /**
     * Signature counter last reported by the authenticator. `bigint` because the spec allows the
     * full uint32 range, which overflows postgres' signed `integer`.
     */
    counter: bigint("counter", { mode: "number" }).notNull().default(0),
    transports: text("transports").array(),
    deviceType: credentialDeviceTypeEnum("device_type").notNull(),
    /** Whether a multi-device credential is currently synced to the provider's cloud. */
    backedUp: boolean("backed_up").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("credentials_user_id_idx").on(table.userId)],
);

/**
 * A logged-in session, holding only the long-lived refresh token — the short-lived access token is
 * a signed cookie that is never stored, so the common case resolves without reading this table at
 * all (see `session.server.ts`). Revoking a session is still a single `DELETE`, it just takes
 * effect when the access cookie next expires.
 *
 * Only the SHA-256 hash is stored: a database leak alone does not hand out usable cookies.
 */
export const sessionsTable = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onUpdate: "cascade", onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").unique().notNull(),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("sessions_user_id_idx").on(table.userId)],
);

/**
 * A challenge issued for an in-flight WebAuthn ceremony, deleted the moment it is verified so it
 * can never be replayed. Registration rows also park the requested username until the ceremony
 * succeeds — the user row itself is only created once the authenticator's attestation checks out.
 */
export const webauthnChallengesTable = pgTable("webauthn_challenges", {
  id: serial("id").primaryKey(),
  challenge: text("challenge").unique().notNull(),
  type: webauthnChallengeTypeEnum("type").notNull(),
  username: text("username"),
  webauthnUserId: text("webauthn_user_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const profilesTable = pgTable(
  "profiles",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    /**
     * The owning user — many profiles per user. Nullable only to carry the profiles that predate
     * authentication through the migration; the first account created adopts them (see `signUp`),
     * and every profile made since then has an owner.
     */
    userId: integer("user_id").references(() => usersTable.id, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
  },
  (table) => [index("profiles_user_id_idx").on(table.userId)],
);

export const colorsTable = pgTable("colors", {
  id: serial("id").primaryKey(),
  hex: varchar("hex", { length: 7 }).unique().notNull(),
});

export const categoriesTable = pgTable(
  "categories",
  {
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
  },
  (table) => [index("categories_profile_id_idx").on(table.profileId)],
);

export const accountsTable = pgTable(
  "accounts",
  {
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
  },
  // Every read in the app is scoped to a profile, and transactions reach their profile through
  // this column — without the index that scoping is a sequential scan of the whole table.
  (table) => [index("accounts_profile_id_idx").on(table.profileId)],
);

export const transactionsTable = pgTable(
  "transactions",
  {
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
  },
  // Composite rather than two indexes: the join to `accounts` and the date-range filter always
  // arrive together (see `getTransactions`), and this ordering also serves the `desc` sort.
  (table) => [index("transactions_account_id_created_at_idx").on(table.accountId, table.createdAt)],
);
