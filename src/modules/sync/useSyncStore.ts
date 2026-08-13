import { create } from "zustand";
import { readOutboxState, rowKey } from "./outbox";
import type {
  Color,
  PushConflict,
  SyncedAccount,
  SyncedCategory,
  SyncedProfile,
  SyncedRow,
  SyncedRows,
  SyncedTable,
  SyncedTransaction,
} from "./sync-types";

/**
 * The in-memory working set every read in the app is served from, plus the state of the sync
 * itself.
 *
 * The whole dataset lives here, held as plain arrays: at this size (10k transactions is roughly
 * 2MB) filtering and aggregating in memory is faster than any round trip, works offline, and turns
 * what used to be SQL into the pure `compute-…` and `to-…` functions in each domain module.
 *
 * State only — what *moves* rows in and out is `sync-engine.ts`, which owns the network, the
 * ordering and the triggers. Nothing in here is authoritative either: rows arrive from
 * `pullChanges`, which re-proves the caller and scopes every row to them, and go back through
 * `pushChanges`, which does the same again; the client only decides what to *show*, and what to ask
 * for.
 */

export type SyncStatus =
  /** Nothing in flight. */
  | "idle"
  /** A pull is running. On a first run this is the only thing on screen. */
  | "syncing"
  /** The last pull failed — usually just offline, so whatever is already held stays usable. */
  | "error"
  /** The server rejected the call: the session is gone and the app has to go back to `/login`. */
  | "unauthorized";

type SyncState = {
  /**
   * Whether there is enough to render the app: the reference tables are complete, from IndexedDB or
   * from a pull. Transactions may still be arriving — see `pending`.
   */
  isHydrated: boolean;
  status: SyncStatus;
  error: string | null;
  /**
   * Whether the browser believes it has a connection. Assumed true until the client says otherwise,
   * because `navigator.onLine` does not exist during SSR and nothing renders before hydration
   * anyway (see `startSyncTriggers`).
   */
  isOnline: boolean;
  /** When the last pull caught up, in epoch milliseconds — what "5 minutes stale" is measured from. */
  lastSyncedAt: number | null;
  /**
   * Tables with a backlog still coming, as the last pull page reported it. While this holds
   * `transactions`, anything derived from them — balances, totals, statistics — is a partial figure
   * that will keep moving, which is why the UI says so (see `SyncStatus`).
   */
  pending: SyncedTable[];
  /**
   * Progress of the run in flight: transaction rows applied so far, out of how many the server said
   * the run would deliver. Counted per run rather than from `transactions.length`, which already
   * holds everything replicated earlier and would put a delta sync at "11,584 of 400".
   */
  syncedRows: number;
  syncTotalRows: number | null;

  /** How many local writes are still waiting to reach the server. Zero means everything landed. */
  outboxCount: number;
  /** Whether the outbox is draining. */
  isPushing: boolean;
  /**
   * Writes that landed on top of a row somebody else had changed since. Reported, never resolved —
   * last-write-wins on the server clock is the whole conflict policy (see `SyncConflictToasts`).
   */
  conflicts: PushConflict[];

  profiles: SyncedProfile[];
  accounts: SyncedAccount[];
  categories: SyncedCategory[];
  transactions: SyncedTransaction[];
  colors: Color[];
  /** Units of each currency per 1 USD, cached from the last pull so statistics work offline. */
  usdRates: Record<string, number>;
};

function initialState(): SyncState {
  return {
    isHydrated: false,
    status: "idle",
    error: null,
    isOnline: true,
    lastSyncedAt: null,
    pending: [],
    syncedRows: 0,
    syncTotalRows: null,
    outboxCount: 0,
    isPushing: false,
    conflicts: [],
    profiles: [],
    accounts: [],
    categories: [],
    transactions: [],
    colors: [],
    usdRates: {},
  };
}

export const useSyncStore = create<SyncState>(initialState);

/**
 * The rows with a local write still queued.
 *
 * Kept outside the store because nothing renders from it: it exists so that a pull, or the canonical
 * rows coming back from somebody else's push, cannot revert an edit the user has made but the server
 * has not accepted yet. The local copy wins until its own entry is confirmed and dropped.
 */
let pendingRowKeys = new Set<string>();

/**
 * Applies a set of rows to an in-memory table: rows are upserted by id, and a tombstone removes its
 * row rather than being kept — mirroring `putRows`, so memory and IndexedDB never disagree.
 *
 * `fromServer` rows yield to anything still in the outbox; local writes are the outbox, so they do
 * not.
 */
function mergeRows<T extends SyncedRow>(
  current: T[],
  incoming: T[] | undefined,
  table: SyncedTable,
  fromServer: boolean,
): T[] {
  if (!incoming?.length) return current;

  const byId = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) {
    if (fromServer && pendingRowKeys.has(rowKey(table, row.id))) continue;
    if (row.deletedAt) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return [...byId.values()];
}

/** Folds a set of rows into the store, from either direction. */
function applyRows(rows: Partial<SyncedRows>, fromServer: boolean, colors?: Color[]): void {
  useSyncStore.setState((state) => ({
    profiles: mergeRows(state.profiles, rows.profiles, "profiles", fromServer),
    accounts: mergeRows(state.accounts, rows.accounts, "accounts", fromServer),
    categories: mergeRows(state.categories, rows.categories, "categories", fromServer),
    transactions: mergeRows(state.transactions, rows.transactions, "transactions", fromServer),
    colors: colors ?? state.colors,
  }));
}

/** Applies rows written on this device, which by definition outrank anything the server holds. */
export function applyLocalRows(rows: Partial<SyncedRows>): void {
  applyRows(rows, false);
}

/** Applies rows the server sent, leaving alone any row with a local write still queued. */
export function applyServerRows(rows: Partial<SyncedRows>, colors?: Color[]): void {
  applyRows(rows, true, colors);
}

/** Replaces the whole working set with what IndexedDB holds — a boot, or a peer tab's write. */
export function replaceRows(rows: SyncedRows, colors: Color[], usdRates: Record<string, number>) {
  useSyncStore.setState({ ...rows, colors, usdRates });
}

/** Re-reads how much is queued, and which rows a pull therefore has to leave alone. */
export async function refreshOutboxState(): Promise<void> {
  const { count, rowKeys } = await readOutboxState();
  pendingRowKeys = rowKeys;
  useSyncStore.setState({ outboxCount: count });
}

/** Marks a batch of conflicts as reported, so it is not shown again. */
export function clearConflicts(reported: PushConflict[]): void {
  const seen = new Set(reported.map((conflict) => conflict.mutationId));
  useSyncStore.setState((state) => ({
    conflicts: state.conflicts.filter((conflict) => !seen.has(conflict.mutationId)),
  }));
}

/** Forgets the in-memory copy and everything known about the sync. */
export function resetSyncState(): void {
  pendingRowKeys = new Set();
  useSyncStore.setState(initialState(), true);
}
