import { isMoneyInput, sumMoney } from "~/utils/money";
import type {
  MutationFor,
  SyncedAccount,
  SyncedTransaction,
  TransactionPayload,
} from "~/modules/sync/sync-types";

type TransferLeg = TransactionPayload & { id?: string };
export type TransferAccount = Pick<
  SyncedAccount,
  "id" | "profileId" | "currencyCode" | "deletedAt"
>;

/** Shared by local writes, CSV planning, and server acceptance. */
export function assertTransferPair(
  legs: TransferLeg[],
  accounts: readonly TransferAccount[],
): void {
  const [first, second] = legs;
  if (
    legs.length !== 2 ||
    !first ||
    !second ||
    !first.transferId ||
    first.transferId !== second.transferId ||
    first.type !== "TRANSFER" ||
    second.type !== "TRANSFER" ||
    first.profileId !== second.profileId ||
    !first.accountId ||
    !second.accountId ||
    first.accountId === second.accountId ||
    !isMoneyInput(first.amount, { allowNegative: true }) ||
    !isMoneyInput(second.amount, { allowNegative: true }) ||
    Number(first.amount) * Number(second.amount) >= 0
  ) {
    throw new Error(
      "A transfer needs one outgoing and one incoming amount in two different accounts of the same profile.",
    );
  }
  const source = accounts.find(
    (account) => account.id === first.accountId && account.deletedAt == null,
  );
  const destination = accounts.find(
    (account) => account.id === second.accountId && account.deletedAt == null,
  );
  if (
    !source ||
    !destination ||
    source.profileId !== first.profileId ||
    destination.profileId !== first.profileId
  ) {
    throw new Error("Both transfer accounts must belong to the same financial profile.");
  }
  if (
    source.currencyCode === destination.currencyCode &&
    sumMoney([first.amount, second.amount]) !== "0.00"
  ) {
    throw new Error(
      "Same-currency transfer amounts must match. Record fees as separate Expense transactions.",
    );
  }
}

export function expandTransferSelection(
  rows: readonly SyncedTransaction[],
  ids: ReadonlySet<string>,
): SyncedTransaction[] {
  const transfers = new Set(
    rows.filter((row) => ids.has(row.id) && row.transferId).map((row) => row.transferId),
  );
  const groups = new Map<string, SyncedTransaction[]>();
  for (const row of rows) {
    if (!ids.has(row.id) && !(row.transferId != null && transfers.has(row.transferId))) continue;
    const key = row.transferId ? `transfer:${row.transferId}` : `row:${row.id}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].flat();
}

export function findLinkedTransfer(
  rows: readonly SyncedTransaction[],
  transferId: string | null | undefined,
): [SyncedTransaction, SyncedTransaction] | undefined {
  if (!transferId) return undefined;
  const legs = rows.filter((row) => row.transferId === transferId);
  const outgoing = legs.find((row) => Number(row.amount) < 0);
  const incoming = legs.find((row) => Number(row.amount) > 0);
  return legs.length === 2 && outgoing && incoming ? [outgoing, incoming] : undefined;
}

/** Linking classifies saved events; it must not rewrite their financial or descriptive details. */
function assertUnchangedTransfer(current: SyncedTransaction, payload: TransactionPayload): void {
  if (
    current.deletedAt != null ||
    current.type !== "TRANSFER" ||
    payload.type !== current.type ||
    payload.profileId !== current.profileId ||
    payload.accountId !== current.accountId ||
    sumMoney([payload.amount]) !== sumMoney([current.amount]) ||
    payload.createdAt.getTime() !== current.createdAt.getTime() ||
    payload.categoryId !== current.categoryId ||
    payload.necessityLevel !== current.necessityLevel ||
    payload.comment !== current.comment ||
    payload.sphereId !== undefined
  ) {
    throw new Error(
      "Link the saved Transfer records without changing their details or spheres. Save edits separately first.",
    );
  }
}

/** Checks complete replacements against locked server rows or the current local working set. */
export function validateTransferMutations(
  mutations: MutationFor<"transactions">[],
  existing: readonly SyncedTransaction[],
  accounts: readonly TransferAccount[],
): Set<string> {
  const currentById = new Map(existing.map((row) => [row.id, row]));
  const groups = new Map<string, MutationFor<"transactions">[]>();
  for (const mutation of mutations) {
    const current = currentById.get(mutation.rowId);
    const transferId = mutation.op === "upsert" ? mutation.payload.transferId : current?.transferId;
    if (current?.transferId && current.transferId !== transferId) {
      throw new Error("This transaction is already linked. Choose an unpaired Transfer record.");
    }
    if (
      current?.transferId &&
      mutation.op === "upsert" &&
      current.profileId !== mutation.payload.profileId
    ) {
      throw new Error("An existing transfer cannot move between financial profiles.");
    }
    if (!transferId) continue;
    const group = groups.get(transferId) ?? [];
    group.push(mutation);
    groups.set(transferId, group);
  }
  const blocked = new Set<string>();
  for (const [transferId, group] of groups) {
    const [first, second] = group;
    const current = existing.filter((row) => row.transferId === transferId);
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
    ) {
      throw new Error("Both linked transfer legs must be changed in one complete operation.");
    }
    if (first.op === "upsert" && second.op === "upsert") {
      const linking = group.some((mutation) => {
        const row = currentById.get(mutation.rowId);
        return row && !row.transferId;
      });
      if (linking) {
        for (const mutation of group) {
          const row = currentById.get(mutation.rowId);
          if (!row || row.transferId || mutation.op !== "upsert")
            throw new Error("Select two existing, unpaired Transfer records to link.");
          assertUnchangedTransfer(row, mutation.payload);
        }
      }
      if (
        group.some((mutation) => mutation.baseUpdatedAt != null && !currentById.has(mutation.rowId))
      ) {
        throw new Error(
          "A saved Transfer record no longer exists. Reload history before linking or editing.",
        );
      }
      if (current.some((row) => row.deletedAt != null)) {
        group.forEach((mutation) => blocked.add(mutation.mutationId));
      } else {
        assertTransferPair([first.payload, second.payload], accounts);
      }
    }
  }
  return blocked;
}
