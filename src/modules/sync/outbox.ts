import { dropOutboxEntries, OUTBOX_STORE, openDatabase, settleAcceptedPush } from "./idb";
import {
  replicaContextFromDescriptor,
  type ReplicaContext,
  type ReplicaDescriptor,
} from "./replica-identity";
import type { OutboxStorage } from "./outbox-acceptance";
import type { Mutation, PushChangesResult, SyncedTable } from "./sync-types";

/** An outbox row: the mutation as it will be pushed, plus the key that orders it. */
export type OutboxEntry = Mutation & { seq: number };

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function assertContext(descriptor: ReplicaDescriptor, expected: ReplicaContext): void {
  const actual = replicaContextFromDescriptor(descriptor);
  if (
    descriptor.lifecycle !== "active" ||
    actual.replicaId !== expected.replicaId ||
    actual.ownerUserId !== expected.ownerUserId
  ) {
    throw new Error("The local replica changed while the outbox operation was in progress.");
  }
}

/** The oldest entries under the context captured before the sync operation began. */
async function readOutboxBatch(expected: ReplicaContext, limit: number): Promise<OutboxEntry[]> {
  const database = await openDatabase();
  const transaction = database.transaction([OUTBOX_STORE, "meta"], "readonly");
  const [entries, descriptor] = await Promise.all([
    promisify(transaction.objectStore(OUTBOX_STORE).getAll(null, limit)),
    promisify(transaction.objectStore("meta").get("replicaDescriptor")),
  ]);
  assertContext(descriptor as ReplicaDescriptor, expected);
  return entries as OutboxEntry[];
}

/** Identifies a row across tables, since ids are only unique within one. */
export function rowKey(table: SyncedTable, rowId: string): string {
  return `${table}:${rowId}`;
}

export type OutboxState = {
  count: number;
  rowKeys: Set<string>;
};

/** One drain keeps the same captured replica context through read, network wait, and settlement. */
export function createOutboxStorage(
  expected: ReplicaContext,
): OutboxStorage<OutboxEntry, PushChangesResult> {
  return {
    readBatch: (limit) => readOutboxBatch(expected, limit),
    dropEntries: (seqs) => dropOutboxEntries(expected, seqs),
    settleEntries: (seqs, result) =>
      settleAcceptedPush(expected, seqs, result.applied, result.canonicalRows, result.colors),
  };
}

export async function readOutboxState(expected?: ReplicaContext): Promise<OutboxState> {
  const database = await openDatabase();
  const transaction = database.transaction([OUTBOX_STORE, "meta"], "readonly");
  const [entries, descriptor] = await Promise.all([
    promisify(transaction.objectStore(OUTBOX_STORE).getAll()),
    promisify(transaction.objectStore("meta").get("replicaDescriptor")),
  ]);
  if (expected) assertContext(descriptor as ReplicaDescriptor, expected);
  const outbox = entries as OutboxEntry[];

  return {
    count: outbox.length,
    rowKeys: new Set(outbox.map((entry) => rowKey(entry.table, entry.rowId))),
  };
}
