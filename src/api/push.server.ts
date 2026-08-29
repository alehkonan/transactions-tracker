import { and, asc, eq, inArray } from "drizzle-orm";
import {
  accountsTable,
  categoriesTable,
  colorsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";
import type { TouchedIds } from "./apply-mutations.server";
import type { Executor } from "~/database/get-db.server";
import type { Color, SyncedRows } from "~/modules/sync/sync-types";

/**
 * The columns an account may replicate. Its derived `balance` stays server-side and is recomputed by
 * `applyMutations` instead of becoming another value for two offline devices to fight over.
 */
const accountSyncColumns = {
  id: accountsTable.id,
  name: accountsTable.name,
  initialBalance: accountsTable.initialBalance,
  currencyCode: accountsTable.currencyCode,
  status: accountsTable.status,
  type: accountsTable.type,
  profileId: accountsTable.profileId,
  updatedAt: accountsTable.updatedAt,
  deletedAt: accountsTable.deletedAt,
};

/** Reads exactly the rows touched by a push, in the shape shared with the local stores. */
export async function readCanonicalRows(
  db: Executor,
  userId: number,
  touched: TouchedIds,
): Promise<SyncedRows> {
  const ids = {
    profiles: [...touched.profiles],
    accounts: [...touched.accounts],
    categories: [...touched.categories],
    transactions: [...touched.transactions],
  };

  const ownProfiles = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));
  const profileIds = ownProfiles.map((profile) => profile.id);

  const [profiles, accounts, categories, transactions] = await Promise.all([
    ids.profiles.length === 0
      ? []
      : db
          .select()
          .from(profilesTable)
          .where(and(inArray(profilesTable.id, ids.profiles), eq(profilesTable.userId, userId))),
    ids.accounts.length === 0
      ? []
      : db
          .select(accountSyncColumns)
          .from(accountsTable)
          .where(
            and(
              inArray(accountsTable.id, ids.accounts),
              inArray(accountsTable.profileId, profileIds),
            ),
          ),
    ids.categories.length === 0
      ? []
      : db
          .select()
          .from(categoriesTable)
          .where(
            and(
              inArray(categoriesTable.id, ids.categories),
              inArray(categoriesTable.profileId, profileIds),
            ),
          ),
    ids.transactions.length === 0
      ? []
      : db
          .select()
          .from(transactionsTable)
          .where(
            and(
              inArray(transactionsTable.id, ids.transactions),
              inArray(transactionsTable.profileId, profileIds),
            ),
          ),
  ]);

  return { profiles, accounts, categories, transactions };
}

/** The palette refreshed after a push, including colors minted by an import. */
export async function readColors(db: Executor): Promise<Color[]> {
  return db.select().from(colorsTable).orderBy(asc(colorsTable.id));
}
