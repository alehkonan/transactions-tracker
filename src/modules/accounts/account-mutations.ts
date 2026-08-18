import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { LocalChange } from "~/modules/sync/mutations";
import type { AccountPayload, SyncedAccount } from "~/modules/sync/sync-types";

/**
 * Creating, editing and deleting accounts, locally.
 *
 * Each of these returns as soon as the change is in the store and on disk; reaching the server is
 * the sync engine's problem, a second or so later (see `mutations.ts`).
 */

/** Everything but the profile, which the caller's selection decides rather than the form. */
export type AccountInput = Omit<AccountPayload, "profileId">;

export function createAccount(profileId: string, input: AccountInput): Promise<void> {
  const payload: AccountPayload = { ...input, profileId };

  return commit([{ op: "upsert", table: "accounts", row: newRow(payload), payload }]);
}

export function updateAccount(account: SyncedAccount, input: AccountInput): Promise<void> {
  if (account.profileId == null) return Promise.resolve();

  const payload: AccountPayload = { ...input, profileId: account.profileId };
  // Rebuilt from the payload rather than spread over the account: callers hold the *derived*
  // account, and its `balance` is not a column any client stores.
  const row: SyncedAccount = {
    id: account.id,
    updatedAt: account.updatedAt,
    deletedAt: account.deletedAt,
    ...payload,
  };

  return commit([{ op: "upsert", table: "accounts", row, payload }]);
}

/**
 * Deletes an account and, with it, its transactions.
 *
 * The transactions go as a cascade rather than as entries of their own: the server tombstones them
 * along with the account (their `onDelete: "cascade"` only fires for a real delete), so all this
 * has to do is drop the same rows locally, which is instant however many there are.
 */
export function deleteAccount(account: SyncedAccount): Promise<void> {
  const transactions = useSyncStore
    .getState()
    .transactions.filter((transaction) => transaction.accountId === account.id);

  const changes: LocalChange[] = [{ op: "delete", table: "accounts", row: account }];
  if (transactions.length > 0) {
    changes.push({ op: "cascade", table: "transactions", rows: transactions });
  }

  return commit(changes);
}
