import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { uuidV7 } from "~/utils/uuid-v7";
import { expandTransferSelection, findLinkedTransfer } from "./linked-transfer";
import type { LocalChange } from "~/modules/sync/mutations";
import type { ReplicaContext } from "~/modules/sync/replica-identity";
import type { SyncedTransaction, TransactionPayload } from "~/modules/sync/sync-types";

/** Creating, editing and deleting transactions, locally. See `account-mutations.ts`. */

/** What a form supplies; the profile and the timestamp are filled in around it. */
export type TransactionInput = Omit<
  TransactionPayload,
  "profileId" | "createdAt" | "transferId"
> & {
  createdAt?: Date;
};

function toPayload(profileId: string, input: TransactionInput): TransactionPayload {
  return { ...input, createdAt: input.createdAt ?? new Date(), profileId };
}

function sourceColumns({ sphereId: _sphereId, ...source }: TransactionPayload) {
  return source;
}

/**
 * Creates transactions — plural, because a transfer between two of the user's own accounts is two
 * rows, one per account, and the CSV import arrives thousands at a time.
 */
export function createTransactions(
  profileId: string,
  inputs: TransactionInput[],
  replicaContext?: ReplicaContext,
): Promise<void> {
  const transferId = inputs.some((input) => input.type === "TRANSFER") ? uuidV7() : null;
  if (transferId && (inputs.length !== 2 || inputs.some((input) => input.type !== "TRANSFER"))) {
    return Promise.reject(new Error("A new transfer requires both outgoing and incoming legs."));
  }
  return commit(
    inputs.map((input): LocalChange => {
      const payload = { ...toPayload(profileId, input), transferId };
      return { op: "upsert", table: "transactions", row: newRow(sourceColumns(payload)), payload };
    }),
    replicaContext,
  );
}

export function updateTransaction(
  transaction: SyncedTransaction,
  input: TransactionInput,
  replicaContext?: ReplicaContext,
): Promise<void> {
  if (transaction.transferId) {
    return Promise.reject(new Error("Edit both sides of the linked transfer together."));
  }
  if (transaction.type !== "TRANSFER" && input.type === "TRANSFER") {
    return Promise.reject(new Error("Create a new transfer with both accounts instead."));
  }
  const payload = toPayload(transaction.profileId, {
    ...input,
    createdAt: input.createdAt ?? transaction.createdAt,
  });

  return commit(
    [
      {
        op: "upsert",
        table: "transactions",
        row: { ...transaction, ...sourceColumns(payload) },
        payload,
      },
    ],
    replicaContext,
  );
}

/** Replaces the complete pair, always ordered outgoing then incoming, whichever leg was opened. */
export function updateTransfer(
  transaction: SyncedTransaction,
  inputs: [TransactionInput, TransactionInput],
  replicaContext?: ReplicaContext,
): Promise<void> {
  const legs = findLinkedTransfer(useSyncStore.getState().transactions, transaction.transferId);
  if (!legs)
    return Promise.reject(new Error("The linked transfer is incomplete. Sync and try again."));
  return commit(
    legs.map((row, index): LocalChange => {
      const payload = { ...toPayload(row.profileId, inputs[index]), transferId: row.transferId };
      return {
        op: "upsert",
        table: "transactions",
        row: { ...row, ...sourceColumns(payload) },
        payload,
      };
    }),
    replicaContext,
  );
}

/** Deletes by id, since that is all the table's selection gives — the rows come from the store. */
export function deleteTransactions(ids: string[], replicaContext?: ReplicaContext): Promise<void> {
  const wanted = new Set(ids);
  const rows = expandTransferSelection(useSyncStore.getState().transactions, wanted);

  return commit(
    rows.map((row): LocalChange => ({ op: "delete", table: "transactions", row })),
    replicaContext,
  );
}
