import { sumMoney } from "~/utils/money";
import type {
  Mutation,
  SyncedAllocation,
  SyncedRows,
  SyncedSphere,
} from "~/modules/sync/sync-types";

export function sphereBalances(
  profileId: string,
  sphereId: string,
  allocations: SyncedAllocation[],
) {
  const amounts = new Map<string, string[]>();
  for (const row of allocations) {
    if (row.profileId !== profileId || row.sphereId !== sphereId || row.deletedAt != null) continue;
    const values = amounts.get(row.currencyCode) ?? [];
    values.push(row.amount);
    amounts.set(row.currencyCode, values);
  }
  return [...amounts]
    .toSorted(([a], [b]) => a.localeCompare(b))
    .map(([currencyCode, values]) => ({
      currencyCode,
      balance: sumMoney(values),
    }));
}

export function sphereHasHistory(sphere: SyncedSphere, allocations: SyncedAllocation[]): boolean {
  return (
    sphere.hasHistory ||
    allocations.some((row) => row.sphereId === sphere.id && row.deletedAt == null)
  );
}

/** Shared by the optimistic write and the serialized IndexedDB transaction. */
export function validateSphereMutations(
  mutations: Mutation[],
  rows: Pick<SyncedRows, "profiles" | "spheres" | "allocations">,
  ownerUserId: number | null,
  complete: boolean,
): void {
  const spheres = new Map(rows.spheres.map((row) => [row.id, row]));
  for (const mutation of mutations) {
    if (mutation.table !== "spheres") continue;
    const current = spheres.get(mutation.rowId);
    const profileId = mutation.op === "upsert" ? mutation.payload.profileId : current?.profileId;
    const profile = rows.profiles.find((row) => row.id === profileId && row.deletedAt == null);
    if (
      !profile ||
      ownerUserId == null ||
      (profile.userId != null && profile.userId !== ownerUserId)
    )
      throw new Error("The sphere profile does not belong to this local replica.");
    if (mutation.rowId === profileId || current?.type === "OPERATING")
      throw new Error("Operating is a permanent system sphere.");
    if (current?.deletedAt != null) throw new Error("This sphere has been deleted.");
    if (mutation.op === "delete") {
      if (!current) throw new Error("This sphere no longer exists.");
      if (!complete) throw new Error("Finish loading sphere history before deleting a sphere.");
      if (sphereHasHistory(current, rows.allocations))
        throw new Error("A sphere with history cannot be deleted. Archive it at zero balance.");
      spheres.set(current.id, { ...current, deletedAt: new Date() });
      continue;
    }
    const payload = mutation.payload;
    if (!payload.name.trim()) throw new Error("Sphere name is required.");
    if (payload.type !== "FUNDS" && payload.type !== "CAPITAL")
      throw new Error("Choose Funds or Capital.");
    if (current && (current.type !== payload.type || current.profileId !== payload.profileId))
      throw new Error("A sphere's type and profile cannot change.");
    if (payload.archived && !current?.archived) {
      if (!complete) throw new Error("Finish loading sphere balances before archiving a sphere.");
      if (
        sphereBalances(profileId!, mutation.rowId, rows.allocations).some(
          (row) => row.balance !== "0.00",
        )
      )
        throw new Error("Every currency balance must be zero before archiving a sphere.");
    }
    spheres.set(mutation.rowId, {
      id: mutation.rowId,
      ...payload,
      hasHistory: current?.hasHistory ?? false,
      updatedAt: current?.updatedAt ?? new Date(),
      deletedAt: null,
    });
  }
}
