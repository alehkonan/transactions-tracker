import { selectProfileLocally } from "~/modules/profile/local-selection";
import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { LocalChange } from "~/modules/sync/mutations";
import type { ReplicaContext } from "~/modules/sync/replica-identity";
import type { ProfilePayload, SyncedProfile } from "~/modules/sync/sync-types";

/**
 * Creates a profile locally. The selection is local metadata too, so neither creation nor opening a
 * new profile waits for the network.
 */
export async function createProfile(
  name: string,
  replicaContext?: ReplicaContext,
): Promise<string> {
  const payload: ProfilePayload = { name };
  // `userId` is the server's to stamp from the session; locally the row simply has no owner yet.
  const row = newRow({ ...payload, userId: null });

  await commit([{ op: "upsert", table: "profiles", row, payload }], replicaContext);
  return row.id;
}

function findProfile(id: string): SyncedProfile | undefined {
  return useSyncStore.getState().profiles.find((profile) => profile.id === id);
}

export function updateProfile(
  id: string,
  name: string,
  replicaContext?: ReplicaContext,
): Promise<void> {
  const profile = findProfile(id);
  if (!profile) return Promise.resolve();

  const payload: ProfilePayload = { name };
  return commit(
    [{ op: "upsert", table: "profiles", row: { ...profile, ...payload }, payload }],
    replicaContext,
  );
}

/**
 * Removes a profile and drops its children locally in one IndexedDB transaction. The server mirrors
 * the cascade with tombstones so other devices learn about every deleted child through their pulls.
 */
export async function deleteProfile(id: string, replicaContext?: ReplicaContext): Promise<void> {
  const state = useSyncStore.getState();
  const profile = state.profiles.find((candidate) => candidate.id === id);
  if (!profile) return;

  const changes: LocalChange[] = [{ op: "delete", table: "profiles", row: profile }];
  const accounts = state.accounts.filter((account) => account.profileId === id);
  const categories = state.categories.filter((category) => category.profileId === id);
  const transactions = state.transactions.filter((transaction) => transaction.profileId === id);

  if (accounts.length > 0) changes.push({ op: "cascade", table: "accounts", rows: accounts });
  if (categories.length > 0) changes.push({ op: "cascade", table: "categories", rows: categories });
  if (transactions.length > 0) {
    changes.push({ op: "cascade", table: "transactions", rows: transactions });
  }

  await commit(changes, replicaContext);
  if (useSyncStore.getState().selectedProfileId === id) await selectProfileLocally(null);
}
