import { commit, newRow } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import type { LocalChange } from "~/modules/sync/mutations";
import type { ReplicaContext } from "~/modules/sync/replica-identity";
import type { SyncedTransaction, TransactionPayload } from "~/modules/sync/sync-types";

/** Creating, editing and deleting transactions, locally. See `account-mutations.ts`. */

/** What a form supplies; the profile and the timestamp are filled in around it. */
export type TransactionInput = Omit<TransactionPayload, "profileId" | "createdAt"> & {
  createdAt?: Date;
};

function toPayload(profileId: string, input: TransactionInput): TransactionPayload {
  return { ...input, createdAt: input.createdAt ?? new Date(), profileId };
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
  return commit(
    inputs.map((input): LocalChange => {
      const payload = toPayload(profileId, input);
      return { op: "upsert", table: "transactions", row: newRow(payload), payload };
    }),
    replicaContext,
  );
}

export function updateTransaction(
  transaction: SyncedTransaction,
  input: TransactionInput,
  replicaContext?: ReplicaContext,
): Promise<void> {
  const payload = toPayload(transaction.profileId, {
    ...input,
    createdAt: input.createdAt ?? transaction.createdAt,
  });

  return commit(
    [{ op: "upsert", table: "transactions", row: { ...transaction, ...payload }, payload }],
    replicaContext,
  );
}

/** Deletes by id, since that is all the table's selection gives — the rows come from the store. */
export function deleteTransactions(ids: string[], replicaContext?: ReplicaContext): Promise<void> {
  const wanted = new Set(ids);
  const rows = useSyncStore.getState().transactions.filter((row) => wanted.has(row.id));

  return commit(
    rows.map((row): LocalChange => ({ op: "delete", table: "transactions", row })),
    replicaContext,
  );
}
