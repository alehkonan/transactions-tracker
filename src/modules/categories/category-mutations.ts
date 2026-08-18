import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { CategoryPayload, SyncedCategory } from "~/modules/sync/sync-types";

/** Creating, editing and deleting categories, locally. See `account-mutations.ts`. */

/** The UI draws categories with their color resolved, so the stored row is looked up by id here. */
function findCategory(id: string): SyncedCategory | undefined {
  return useSyncStore.getState().categories.find((category) => category.id === id);
}

export function createCategory(profileId: string, name: string, colorId: number): Promise<void> {
  const payload: CategoryPayload = { name, colorId, profileId };

  return commit([{ op: "upsert", table: "categories", row: newRow(payload), payload }]);
}

export function updateCategory(id: string, name: string, colorId: number): Promise<void> {
  const category = findCategory(id);
  if (!category?.profileId) return Promise.resolve();

  const payload: CategoryPayload = { name, colorId, profileId: category.profileId };

  return commit([{ op: "upsert", table: "categories", row: { ...category, ...payload }, payload }]);
}

/**
 * The transactions filed under a deleted category keep pointing at it. Rewriting them all would bump
 * `updatedAt` on every one — a large push and a larger pull for no gain, since a client that no
 * longer holds the category renders those rows as having none, which is exactly what the old
 * `onDelete: "set null"` produced.
 */
export function deleteCategory(id: string): Promise<void> {
  const category = findCategory(id);
  if (!category) return Promise.resolve();

  return commit([{ op: "delete", table: "categories", row: category }]);
}
