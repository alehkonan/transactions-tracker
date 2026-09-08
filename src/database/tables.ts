import {
  bigserial,
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uuid,
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

/** A password credential kept separate from the user and replaceable without changing identity. */
export const passwordCredentialsTable = pgTable("password_credentials", {
  userId: integer("user_id")
    .primaryKey()
    .references(() => usersTable.id, { onUpdate: "cascade", onDelete: "cascade" }),
  /** Self-describing, versioned scrypt encoding containing parameters, salt, and derived key. */
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
 * Durable, privacy-preserving authentication attempts used by rolling-window rate limits.
 * Identifiers are stored only as AUTH_SECRET-keyed HMAC digests.
 */
export const authAttemptsTable = pgTable(
  "auth_attempts",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    kind: text("kind").notNull(),
    keyDigest: text("key_digest").notNull(),
    attemptedAt: timestamp("attempted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("auth_attempts_kind_key_digest_attempted_at_idx").on(
      table.kind,
      table.keyDigest,
      table.attemptedAt,
    ),
    index("auth_attempts_attempted_at_idx").on(table.attemptedAt),
  ],
);

/**
 * A durable acknowledgement of an outbox mutation.
 *
 * The composite key deliberately includes the user: mutation ids are client-generated and only
 * identify one user's delivery. Receipts are written in the same transaction as their mutations,
 * so a retry can distinguish a lost response after commit from work that never committed.
 */
export const mutationReceiptsTable = pgTable(
  "mutation_receipts",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onUpdate: "cascade", onDelete: "cascade" }),
    mutationId: uuid("mutation_id").notNull(),
    appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mutationId] })],
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

/**
 * The columns every replicated table carries, so a client can ask "what changed since X" and see
 * deletions as well as edits (see `docs/offline-first-sync.md`).
 *
 * `updatedAt` is maintained by the mutations that write user-visible fields — postgres only applies
 * the default on insert, so an `update` that forgets to bump it is invisible to a delta pull.
 * `deletedAt` is the tombstone: the columns exist from here on, but nothing sets one until deletes
 * become soft in the write-path phase.
 */
const syncColumns = {
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/**
 * Synced tables are keyed by UUID rather than `serial`: a client that is offline has to be able to
 * mint an id itself, and have it be the final one, instead of inserting under a temporary id and
 * rewriting every foreign key that points at it once the server hands out the real one.
 *
 * The default is `gen_random_uuid()` (v4) for the rows this server still inserts on the client's
 * behalf; ids minted on the client are v7, whose leading timestamp keeps inserts local in the
 * btree. Nothing here depends on which of the two a given row got — ordering comes from
 * `updatedAt`, with the id only breaking ties.
 */
const syncedId = () => uuid("id").primaryKey().defaultRandom();

export const profilesTable = pgTable(
  "profiles",
  {
    id: syncedId(),
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
    ...syncColumns,
  },
  // A profile's own scoping column is its owner, so this stands in for the plain `user_id` index:
  // a composite serves an equality on its leading column just as well.
  (table) => [
    index("profiles_user_id_updated_at_id_idx").on(table.userId, table.updatedAt, table.id),
  ],
);

export const colorsTable = pgTable("colors", {
  id: serial("id").primaryKey(),
  hex: varchar("hex", { length: 7 }).unique().notNull(),
});

export const categoriesTable = pgTable(
  "categories",
  {
    id: syncedId(),
    name: text("name").notNull(),
    profileId: uuid("profile_id").references(() => profilesTable.id, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
    colorId: integer("color_id").references(() => colorsTable.id, {
      onUpdate: "cascade",
      onDelete: "set null",
    }),
    ...syncColumns,
  },
  (table) => [
    index("categories_profile_id_updated_at_id_idx").on(table.profileId, table.updatedAt, table.id),
  ],
);

export const accountsTable = pgTable(
  "accounts",
  {
    id: syncedId(),
    name: text("name").notNull(),
    /** Opening amount the account started with, before any transaction. */
    initialBalance: money("initial_balance").notNull().default("0"),
    /**
     * `initialBalance` plus the sum of the account's transactions.
     *
     * Server-side only — a denormalized cache that two offline devices would fight over, so it
     * never rides along in a sync payload; clients derive it from the transactions they already
     * hold. Writes that only move this column deliberately leave `updatedAt` alone, since a
     * derived value changing is not a change any client needs to hear about.
     */
    balance: money("balance").notNull().default("0"),
    currencyCode: currencyCodeEnum("currency_code").notNull().default("USD"),
    status: accountStatusEnum("status").notNull().default("ACTIVE"),
    type: accountTypeEnum("type").notNull().default("CURRENT"),
    profileId: uuid("profile_id").references(() => profilesTable.id, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
    ...syncColumns,
  },
  // Every read in the app is scoped to a profile — without the leading column here that scoping is
  // a sequential scan of the whole table — and a delta pull walks the same rows in `updated_at`
  // order, so one composite serves both.
  (table) => [
    index("accounts_profile_id_updated_at_id_idx").on(table.profileId, table.updatedAt, table.id),
  ],
);

export const transactionsTable = pgTable(
  "transactions",
  {
    id: syncedId(),
    type: transactionTypeEnum("type").notNull(),
    necessityLevel: necessityLevelEnum("necessity_level").notNull().default("MEDIUM"),
    amount: money("amount").notNull(),
    comment: text("comment"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    accountId: uuid("account_id").references(() => accountsTable.id, {
      onUpdate: "cascade",
      onDelete: "cascade",
    }),
    categoryId: uuid("category_id").references(() => categoriesTable.id, {
      onUpdate: "cascade",
      onDelete: "set null",
    }),
    /**
     * Denormalized from the owning account. A transaction has no profile of its own, but reaching
     * for one through `accounts` on every read turned each profile scope into a subquery or a join;
     * carrying it here makes both the scope and the delta pull a single indexed scan.
     *
     * Every write has to set it to the account's profile — nothing in the database enforces that
     * the two agree.
     */
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profilesTable.id, { onUpdate: "cascade", onDelete: "cascade" }),
    ...syncColumns,
  },
  (table) => [
    // Composite rather than two indexes: the join to `accounts` and the date-range filter always
    // arrive together (see `getTransactions`), and this ordering also serves the `desc` sort.
    index("transactions_account_id_created_at_idx").on(table.accountId, table.createdAt),
    index("transactions_profile_id_updated_at_id_idx").on(
      table.profileId,
      table.updatedAt,
      table.id,
    ),
  ],
);
