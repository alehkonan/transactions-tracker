import { OUTBOX_STORE, openDatabase } from "./idb";
import type { OutboxStorage } from "./outbox-acceptance";
import type { Mutation, SyncedTable } from "./sync-types";

/**
 * The queue of writes that have been made locally but not yet accepted by the server.
 *
 * Append-only and strictly ordered: `seq` auto-increments, and a batch is pushed in that order so a
 * record created before the rows referencing it is created before them on the server too. Entries
 * are dropped only once a push has confirmed them, which is what makes the app safe to close, go
 * offline, or crash mid-write — the change is on disk before the network is ever involved.
 *
 * Client-only, like the rest of `idb.ts`.
 */

/** An outbox row: the mutation as it will be pushed, plus the key that orders it. */
export type OutboxEntry = Mutation & { seq: number };

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

/** The oldest `limit` entries — one push's worth, in the order they were made. */
export async function readOutboxBatch(limit: number): Promise<OutboxEntry[]> {
  const database = await openDatabase();
  const store = database.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE);

  return (await promisify(store.getAll(null, limit))) as OutboxEntry[];
}

/** Forgets entries the server has confirmed. */
export async function dropOutboxEntries(seqs: readonly number[]): Promise<void> {
  if (seqs.length === 0) return;

  const database = await openDatabase();
  const transaction = database.transaction(OUTBOX_STORE, "readwrite");
  const store = transaction.objectStore(OUTBOX_STORE);
  for (const seq of seqs) store.delete(seq);

  // Awaited, so a failure to forget an entry surfaces as a failed push rather than as the entry
  // being pushed again on the next drain.
  await new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

/** Identifies a row across tables, since ids are only unique within one. */
export function rowKey(table: SyncedTable, rowId: string): string {
  return `${table}:${rowId}`;
}

export type OutboxState = {
  count: number;
  /**
   * The rows with a write still in the queue.
   *
   * A pull must not apply the server's copy of one of these: it is the version from *before* the
   * local write, so applying it would revert what the user just did, until the push landed and put
   * it back. The local copy wins until its own write is confirmed.
   */
  rowKeys: Set<string>;
};

export const outboxStorage: OutboxStorage<OutboxEntry> = {
  readBatch: readOutboxBatch,
  dropEntries: dropOutboxEntries,
};

export async function readOutboxState(): Promise<OutboxState> {
  const database = await openDatabase();
  const store = database.transaction(OUTBOX_STORE, "readonly").objectStore(OUTBOX_STORE);
  const entries = (await promisify(store.getAll())) as OutboxEntry[];

  return {
    count: entries.length,
    rowKeys: new Set(entries.map((entry) => rowKey(entry.table, entry.rowId))),
  };
}
