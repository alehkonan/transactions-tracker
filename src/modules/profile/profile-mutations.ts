import { commit, newRow } from "~/modules/sync/mutations";
import { pushNow } from "~/modules/sync/sync-engine";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { LocalChange } from "~/modules/sync/mutations";
import type { ProfilePayload, SyncedProfile } from "~/modules/sync/sync-types";

/**
 * Creates a profile and waits for it to reach the server.
 *
 * The one mutation in the app that cannot be fire-and-forget: selecting a profile mints a signed
 * cookie, and the server will only sign one for a profile it can see (see `selectProfile`). So the
 * push is awaited here rather than left to the debounce — the alternative is a profile the user
 * has just made and cannot open for another second.
 */
export async function createProfile(name: string): Promise<string> {
  const payload: ProfilePayload = { name };
  // `userId` is the server's to stamp from the session; locally the row simply has no owner yet.
  const row = newRow({ ...payload, userId: null });

  await commit([{ op: "upsert", table: "profiles", row, payload }]);
  await pushNow();

  return row.id;
}

function findProfile(id: string): SyncedProfile | undefined {
  return useSyncStore.getState().profiles.find((profile) => profile.id === id);
}

export function updateProfile(id: string, name: string): Promise<void> {
  const profile = findProfile(id);
  if (!profile) return Promise.resolve();

  const payload: ProfilePayload = { name };
  return commit([{ op: "upsert", table: "profiles", row: { ...profile, ...payload }, payload }]);
}

/**
 * Removes a profile and drops its children locally in one IndexedDB transaction. The server mirrors
 * the cascade with tombstones so other devices learn about every deleted child through their pulls.
 */
export function deleteProfile(id: string): Promise<void> {
  const state = useSyncStore.getState();
  const profile = state.profiles.find((candidate) => candidate.id === id);
  if (!profile) return Promise.resolve();

  const changes: LocalChange[] = [{ op: "delete", table: "profiles", row: profile }];
  const accounts = state.accounts.filter((account) => account.profileId === id);
  const categories = state.categories.filter((category) => category.profileId === id);
  const transactions = state.transactions.filter((transaction) => transaction.profileId === id);

  if (accounts.length > 0) changes.push({ op: "cascade", table: "accounts", rows: accounts });
  if (categories.length > 0) changes.push({ op: "cascade", table: "categories", rows: categories });
  if (transactions.length > 0) {
    changes.push({ op: "cascade", table: "transactions", rows: transactions });
  }

  return commit(changes);
}
