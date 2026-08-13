import { uuidV7 } from "~/utils/uuid-v7";
import { writeLocalMutations } from "./idb";
import { announceLocalWrite, schedulePush } from "./sync-engine";
import { SYNCED_TABLES } from "./sync-types";
import { applyLocalRows, refreshOutboxState, useSyncStore } from "./useSyncStore";
import type { Mutation, MutationPayloads, SyncedRows, SyncedTable } from "./sync-types";

/**
 * The write path: a change is applied to the store, persisted with its outbox entry, and pushed
 * afterwards — in that order, so the UI never waits on the network and a write survives the app
 * being closed before it goes out.
 *
 * Domain code does not build `Mutation`s directly; it describes changes in terms of rows (see
 * `account-mutations.ts` and friends) and hands them to `commit`, which is the only place that
 * knows how a local write reaches all three of memory, IndexedDB and the queue at once.
 */

type RowFor<Table extends SyncedTable> = SyncedRows[Table][number];

/** A row created or edited here, along with the columns the server is being asked to store. */
type UpsertChange = {
  [Table in SyncedTable]: {
    op: "upsert";
    table: Table;
    row: RowFor<Table>;
    payload: MutationPayloads[Table];
  };
}[SyncedTable];

/** A row deleted here. The local copy goes; the server gets a tombstone. */
type DeleteChange = {
  [Table in SyncedTable]: { op: "delete"; table: Table; row: RowFor<Table> };
}[SyncedTable];

/**
 * Rows the server will tombstone as a consequence of another entry in the same commit — an account's
 * transactions, say. Dropped locally so the two ends agree immediately, but not queued: the server
 * cascades them itself, and queueing thousands of entries to say what one already says would make
 * deleting a well-used account a minutes-long push.
 */
type CascadeChange = {
  [Table in SyncedTable]: { op: "cascade"; table: Table; rows: RowFor<Table>[] };
}[SyncedTable];

export type LocalChange = UpsertChange | DeleteChange | CascadeChange;

type RowsByTable = { [Table in SyncedTable]: RowFor<Table>[] };

function emptyRows(): RowsByTable {
  return { profiles: [], accounts: [], categories: [], transactions: [] };
}

/**
 * What the server last said this row's `updatedAt` was, per table, for the ids a commit touches.
 *
 * Read from the store, which is exactly "what this client last saw" — and stays so, because an
 * optimistic write below deliberately keeps the row's existing `updatedAt` rather than stamping a
 * client clock over it. Editing the same row twice before a push therefore still reports the
 * server's value as the base, instead of a timestamp the server has never heard of.
 */
function readBaseUpdatedAt(changes: LocalChange[]): Map<string, number> {
  const wanted = emptyRows();
  for (const change of changes) {
    if (change.op === "cascade") continue;
    // Safe by construction: `table` and `row` come from the same member of the union above.
    (wanted[change.table] as RowFor<SyncedTable>[]).push(change.row);
  }

  const state = useSyncStore.getState();
  const bases = new Map<string, number>();

  for (const table of SYNCED_TABLES) {
    if (wanted[table].length === 0) continue;

    const ids = new Set(wanted[table].map((row) => row.id));
    // One pass per table rather than a lookup per row: a CSV import commits thousands at a time.
    for (const row of state[table]) {
      if (ids.has(row.id)) bases.set(`${table}:${row.id}`, row.updatedAt.getTime());
    }
  }

  return bases;
}

/**
 * Applies changes to the store, persists them with their outbox entries, and schedules the push.
 *
 * The IndexedDB write is a single transaction covering both the rows and the queue, so a change can
 * never end up saved-but-unsent or sent-but-unsaved. The push is scheduled rather than awaited:
 * every caller of this is a form that should close now, not once the network agrees.
 */
export async function commit(changes: LocalChange[]): Promise<void> {
  if (changes.length === 0) return;

  const bases = readBaseUpdatedAt(changes);
  const rows = emptyRows();
  const mutations: Mutation[] = [];
  const deletedAt = new Date();

  for (const change of changes) {
    // Every branch below writes a row of `change.table` into that table's bucket; only inference
    // cannot follow the union through the index.
    const bucket = rows[change.table] as RowFor<SyncedTable>[];

    if (change.op === "cascade") {
      bucket.push(...change.rows.map((row) => ({ ...row, deletedAt, updatedAt: deletedAt })));
      continue;
    }

    const baseUpdatedAt = bases.get(`${change.table}:${change.row.id}`) ?? null;
    const shared = {
      mutationId: uuidV7(),
      table: change.table,
      rowId: change.row.id,
      baseUpdatedAt,
    };

    if (change.op === "delete") {
      bucket.push({ ...change.row, deletedAt, updatedAt: deletedAt });
      mutations.push({ ...shared, op: "delete" });
      continue;
    }

    // `updatedAt` is left where the server put it. It is the client's record of what it last saw,
    // and the next push compares against it; the canonical row that comes back is what moves it on.
    bucket.push({ ...change.row, updatedAt: change.row.updatedAt });
    mutations.push({ ...shared, op: "upsert", payload: change.payload } as Mutation);
  }

  // Persisted before it is applied, the same way a pulled page is: a store that is ahead of
  // IndexedDB would show a change that quietly disappears on the next reload.
  await writeLocalMutations(rows, mutations);
  await refreshOutboxState();
  applyLocalRows(rows);
  // On disk is on disk: any other tab on this browser is looking at the same database and should
  // show the change now, not once the push that carries it away has been round-tripped.
  announceLocalWrite();
  schedulePush();
}

/**
 * A row as it starts life here: a minted id, no tombstone, and an `updatedAt` the server will redo.
 *
 * Takes the row's own columns rather than the mutation payload, because the two are not always the
 * same shape — a profile row carries a `userId` the client does not get to set, and a category
 * payload can carry a `colorHex` that is not a column at all.
 */
export function newRow<Columns extends object>(
  columns: Columns,
): Columns & { id: string; updatedAt: Date; deletedAt: null } {
  return { id: uuidV7(), updatedAt: new Date(), deletedAt: null, ...columns };
}
