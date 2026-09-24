import { and, asc, eq, inArray } from "drizzle-orm";
import {
  accountsTable,
  categoriesTable,
  colorsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";
import type { TouchedIds } from "./apply-mutations.server";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "~/database/get-db.server";
import type {
  Color,
  SyncedAccount,
  SyncedCategory,
  SyncedProfile,
  SyncedRows,
  SyncedTable,
  SyncedTransaction,
} from "~/modules/sync/sync-types";

export type CanonicalRowReadOperation =
  | "canonical.read-owned-profiles"
  | `canonical.read.${SyncedTable}`;

type CanonicalRowReadOperationRunner = <Result>(
  operation: CanonicalRowReadOperation,
  query: () => Promise<Result>,
) => Promise<Result>;

const runCanonicalRowRead: CanonicalRowReadOperationRunner = (_operation, query) => query();

/**
 * The columns an account may replicate. Its derived `balance` stays server-side and is recomputed by
 * `applyMutations` instead of becoming another value for two offline devices to fight over.
 */
export const profileSyncColumns = {
  id: profilesTable.id,
  name: profilesTable.name,
  userId: profilesTable.userId,
  updatedAt: profilesTable.updatedAt,
  deletedAt: profilesTable.deletedAt,
} satisfies Record<keyof SyncedProfile, AnyPgColumn>;

export const accountSyncColumns = {
  id: accountsTable.id,
  name: accountsTable.name,
  initialBalance: accountsTable.initialBalance,
  currencyCode: accountsTable.currencyCode,
  status: accountsTable.status,
  type: accountsTable.type,
  profileId: accountsTable.profileId,
  updatedAt: accountsTable.updatedAt,
  deletedAt: accountsTable.deletedAt,
} satisfies Record<keyof SyncedAccount, AnyPgColumn>;

export const categorySyncColumns = {
  id: categoriesTable.id,
  name: categoriesTable.name,
  profileId: categoriesTable.profileId,
  colorId: categoriesTable.colorId,
  updatedAt: categoriesTable.updatedAt,
  deletedAt: categoriesTable.deletedAt,
} satisfies Record<keyof SyncedCategory, AnyPgColumn>;

export const transactionSyncColumns = {
  id: transactionsTable.id,
  type: transactionsTable.type,
  necessityLevel: transactionsTable.necessityLevel,
  amount: transactionsTable.amount,
  comment: transactionsTable.comment,
  createdAt: transactionsTable.createdAt,
  accountId: transactionsTable.accountId,
  categoryId: transactionsTable.categoryId,
  profileId: transactionsTable.profileId,
  updatedAt: transactionsTable.updatedAt,
  deletedAt: transactionsTable.deletedAt,
} satisfies Record<keyof SyncedTransaction, AnyPgColumn>;

/** Reads exactly the rows touched by a push, in the shape shared with the local stores. */
export async function readCanonicalRows(
  db: Executor,
  userId: number,
  touched: TouchedIds,
  runOperation: CanonicalRowReadOperationRunner = runCanonicalRowRead,
  provenProfileIds?: string[],
): Promise<SyncedRows> {
  const ids = {
    profiles: [...touched.profiles],
    accounts: [...touched.accounts],
    categories: [...touched.categories],
    transactions: [...touched.transactions],
  };

  const profileIds =
    provenProfileIds ??
    (
      await runOperation("canonical.read-owned-profiles", () =>
        db
          .select({ id: profilesTable.id })
          .from(profilesTable)
          .where(eq(profilesTable.userId, userId)),
      )
    ).map((profile) => profile.id);

  const [profiles, accounts, categories, transactions] = await Promise.all([
    ids.profiles.length === 0
      ? []
      : runOperation("canonical.read.profiles", () =>
          db
            .select(profileSyncColumns)
            .from(profilesTable)
            .where(and(inArray(profilesTable.id, ids.profiles), eq(profilesTable.userId, userId))),
        ),
    ids.accounts.length === 0
      ? []
      : runOperation("canonical.read.accounts", () =>
          db
            .select(accountSyncColumns)
            .from(accountsTable)
            .where(
              and(
                inArray(accountsTable.id, ids.accounts),
                inArray(accountsTable.profileId, profileIds),
              ),
            ),
        ),
    ids.categories.length === 0
      ? []
      : runOperation("canonical.read.categories", () =>
          db
            .select(categorySyncColumns)
            .from(categoriesTable)
            .where(
              and(
                inArray(categoriesTable.id, ids.categories),
                inArray(categoriesTable.profileId, profileIds),
              ),
            ),
        ),
    ids.transactions.length === 0
      ? []
      : runOperation("canonical.read.transactions", () =>
          db
            .select(transactionSyncColumns)
            .from(transactionsTable)
            .where(
              and(
                inArray(transactionsTable.id, ids.transactions),
                inArray(transactionsTable.profileId, profileIds),
              ),
            ),
        ),
  ]);

  return { profiles, accounts, categories, transactions };
}

/** The palette refreshed after a push, including colors minted by an import. */
export async function readColors(db: Executor): Promise<Color[]> {
  return db.select().from(colorsTable).orderBy(asc(colorsTable.id));
}
