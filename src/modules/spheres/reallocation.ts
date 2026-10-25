import { assertCompleteOperations } from "~/modules/sync/outbox-acceptance";
import { isMoneyInput, sumMoney } from "~/utils/money";
import type { MutationFor, SyncedAllocation, SyncedSphere } from "~/modules/sync/sync-types";

export function findReallocation(
  allocations: readonly SyncedAllocation[],
  id: string,
): [SyncedAllocation, SyncedAllocation] | undefined {
  const rows = allocations.filter((row) => row.reallocationId === id);
  const from = rows.find((row) => Number(row.amount) < 0);
  const to = rows.find((row) => Number(row.amount) > 0);
  return rows.length === 2 && from && to ? [from, to] : undefined;
}

/** The same whole-operation rules apply before local persistence and server acceptance. */
export function validateReallocationMutations(
  mutations: MutationFor<"allocations">[],
  existing: readonly SyncedAllocation[],
  spheres: readonly SyncedSphere[],
): Set<string> {
  assertCompleteOperations(mutations);
  const blocked = new Set<string>();
  const groups = new Map<string, MutationFor<"allocations">[]>();
  for (const mutation of mutations) {
    const current = existing.find((row) => row.id === mutation.rowId);
    const id =
      mutation.op === "upsert"
        ? mutation.payload.reallocationId
        : (current?.reallocationId ?? (!current ? mutation.operation?.id : undefined));
    if (
      !id ||
      (current &&
        (current.reallocationId !== id ||
          current.transactionId != null ||
          current.openingAccountId != null))
    )
      throw new Error("Transaction and opening allocations cannot be edited independently.");
    if (current && mutation.op === "upsert" && current.profileId !== mutation.payload.profileId)
      throw new Error("A reallocation cannot move between profiles.");
    const group = groups.get(id) ?? [];
    group.push(mutation);
    groups.set(id, group);
  }
  for (const [id, group] of groups) {
    const [first, second] = group;
    const current = existing.filter((row) => row.reallocationId === id);
    if (
      group.length !== 2 ||
      !first ||
      !second ||
      first.rowId === second.rowId ||
      first.op !== second.op ||
      !first.operation ||
      first.operation.id !== second.operation?.id ||
      first.operation.mutationIds.length !== 2 ||
      !first.operation.mutationIds.includes(first.mutationId) ||
      !first.operation.mutationIds.includes(second.mutationId) ||
      (current.length > 0 &&
        (current.length !== 2 ||
          current.some((row) => !group.some((mutation) => mutation.rowId === row.id))))
    )
      throw new Error("Both reallocation sides must change in one complete operation.");
    // A stale edit must never resurrect either side after deletion or a profile cascade.
    if (first.op === "upsert" && current.some((row) => row.deletedAt != null)) {
      group.forEach((mutation) => blocked.add(mutation.mutationId));
      continue;
    }
    const payloads = group.flatMap((mutation) =>
      mutation.op === "upsert" ? [mutation.payload] : [],
    );
    if (first.op === "upsert") {
      const [a, b] = payloads;
      if (
        !a ||
        !b ||
        a.profileId !== b.profileId ||
        a.sphereId === b.sphereId ||
        a.currencyCode !== b.currencyCode ||
        a.createdAt.getTime() !== b.createdAt.getTime() ||
        payloads.some(
          (row) =>
            row.transactionId != null ||
            row.openingAccountId != null ||
            !isMoneyInput(row.amount, { allowNegative: true }) ||
            Number(row.amount) === 0,
        ) ||
        sumMoney([a.amount, b.amount]) !== "0.00"
      )
        throw new Error(
          "Choose different spheres in one profile and equal opposite amounts in one currency.",
        );
    }
    for (const row of [...current.filter((row) => row.deletedAt == null), ...payloads]) {
      const sphere = spheres.find((sphere) => sphere.id === row.sphereId);
      if (!sphere || sphere.profileId !== row.profileId)
        throw new Error("Reallocations require spheres in the same profile.");
      if (sphere.deletedAt != null || sphere.archived)
        group.forEach((mutation) => blocked.add(mutation.mutationId));
    }
  }
  return blocked;
}
