import { asc, inArray } from "drizzle-orm";
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
export async function readCanonicalRows(db: Executor, touched: TouchedIds): Promise<SyncedRows> {
  const ids = {
    profiles: [...touched.profiles],
    accounts: [...touched.accounts],
    categories: [...touched.categories],
    transactions: [...touched.transactions],
  };

  const [profiles, accounts, categories, transactions] = await Promise.all([
    ids.profiles.length === 0
      ? []
      : db.select().from(profilesTable).where(inArray(profilesTable.id, ids.profiles)),
    ids.accounts.length === 0
      ? []
      : db
          .select(accountSyncColumns)
          .from(accountsTable)
          .where(inArray(accountsTable.id, ids.accounts)),
    ids.categories.length === 0
      ? []
      : db.select().from(categoriesTable).where(inArray(categoriesTable.id, ids.categories)),
    ids.transactions.length === 0
      ? []
      : db.select().from(transactionsTable).where(inArray(transactionsTable.id, ids.transactions)),
  ]);

  return { profiles, accounts, categories, transactions };
}

/** The palette refreshed after a push, including colors minted by an import. */
export async function readColors(db: Executor): Promise<Color[]> {
  return db.select().from(colorsTable).orderBy(asc(colorsTable.id));
}
