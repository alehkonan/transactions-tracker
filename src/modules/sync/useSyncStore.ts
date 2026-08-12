import { create } from "zustand";
import { pullChanges } from "~/api/sync.functions";
import { deleteLocalDatabase, readLocalSnapshot, writeLocalPage } from "./idb";
import type {
  Color,
  PullChangesResult,
  SyncedTable,
  SyncCursors,
  SyncedAccount,
  SyncedCategory,
  SyncedProfile,
  SyncedRow,
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
 * Nothing in here is authoritative. Rows arrive from `pullChanges`, which re-proves the caller and
 * scopes every row to them; the client only decides what to *show*.
 */

type SyncStatus =
  /** Nothing in flight. */
  | "idle"
  /** A pull is running. On a first run this is the only thing on screen. */
  | "syncing"
  /** The last pull failed — usually just offline, so whatever is already held stays usable. */
  | "error"
  /** The server rejected the call: the session is gone and the app has to go back to `/login`. */
  | "unauthorized";

/**
 * The tables the app cannot render anything meaningful without: which accounts and categories exist,
 * and which profiles they belong to. All three are small enough to arrive in one page.
 *
 * `transactions` is deliberately not one of them. It is the only table big enough to need paging, so
 * waiting for the last page before showing anything means staring at a spinner for the sake of rows
 * that are already on their way — the app opens on the reference data and the transactions fill in.
 */
const REFERENCE_TABLES = ["profiles", "accounts", "categories"] as const;

type SyncState = {
  /**
   * Whether there is enough to render the app: the reference tables are complete, from IndexedDB or
   * from a pull. Transactions may still be arriving — see `pending`.
   */
  isHydrated: boolean;
  status: SyncStatus;
  error: string | null;
  /**
   * Tables with a backlog still coming, as the last pull page reported it. While this holds
   * `transactions`, anything derived from them — balances, totals, statistics — is a partial figure
   * that will keep moving, which is why the UI says so (see `SyncProgress`).
   */
  pending: SyncedTable[];
  /**
   * Progress of the run in flight: transaction rows applied so far, out of how many the server said
   * the run would deliver. Counted per run rather than from `transactions.length`, which already
   * holds everything replicated earlier and would put a delta sync at "11,584 of 400".
   */
  syncedRows: number;
  syncTotalRows: number | null;
  cursors: SyncCursors | undefined;

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
    pending: [],
    syncedRows: 0,
    syncTotalRows: null,
    cursors: undefined,
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
 * Applies a pulled page to an in-memory table: rows are upserted by id, and a tombstone removes its
 * row rather than being kept — mirroring `writeLocalPage`, so memory and IndexedDB never disagree.
 */
function mergeRows<T extends SyncedRow>(current: T[], incoming: T[]): T[] {
  if (incoming.length === 0) return current;

  const byId = new Map(current.map((row) => [row.id, row]));
  for (const row of incoming) {
    if (row.deletedAt) byId.delete(row.id);
    else byId.set(row.id, row);
  }
  return [...byId.values()];
}

/**
 * A rejected call comes back as a resolved `Response` rather than a thrown error: TanStack Start
 * hands the raw response over when middleware throws one, which is how `authMiddleware` answers an
 * unauthenticated caller. Left unchecked it reaches the merge step as a payload with no rows.
 */
function isPullResult(value: unknown): value is PullChangesResult {
  return typeof value === "object" && value != null && !(value instanceof Response);
}

/** A 401 is a dead session, which needs a redirect — not a retry like every other pull failure. */
function isUnauthorized(error: unknown): boolean {
  if (error instanceof Response) return error.status === 401;
  return error instanceof Error && error.message.includes("Unauthorized");
}

function toMessage(error: unknown): string {
  if (error instanceof Response) return `The server rejected the request (${error.status}).`;
  if (error instanceof Error) return error.message;
  return "Could not reach the server.";
}

/**
 * A run of pages is bounded so a cursor that somehow stops advancing shows up as an error instead
 * of an endless loop against the database.
 */
const MAX_PAGES_PER_PULL = 200;

async function pullUntilCaughtUp(): Promise<void> {
  useSyncStore.setState({ status: "syncing", error: null, syncedRows: 0, syncTotalRows: null });

  try {
    let cursors = useSyncStore.getState().cursors;

    for (let page = 0; ; page++) {
      if (page >= MAX_PAGES_PER_PULL) throw new Error("Sync did not converge — too many pages.");

      // The backlog size is only worth a `count(*)` once — it describes the whole run.
      const result = await pullChanges({ data: { cursors, withCounts: page === 0 } });
      if (!isPullResult(result)) throw result;

      cursors = result.nextCursors;

      // Persisted before it is applied: a store that is ahead of IndexedDB would silently lose the
      // difference on the next reload.
      await writeLocalPage({
        rows: result.rows,
        cursors: result.nextCursors,
        colors: result.colors,
        usdRates: result.usdRates,
      });

      const { rows } = result;
      useSyncStore.setState((state) => ({
        cursors: result.nextCursors,
        pending: result.pending,
        syncedRows: state.syncedRows + rows.transactions.length,
        syncTotalRows: result.transactionBacklog ?? state.syncTotalRows,
        profiles: mergeRows(state.profiles, rows.profiles),
        accounts: mergeRows(state.accounts, rows.accounts),
        categories: mergeRows(state.categories, rows.categories),
        transactions: mergeRows(state.transactions, rows.transactions),
        colors: result.colors,
        usdRates: result.usdRates ?? state.usdRates,
        // Opened as soon as the reference tables are complete, so a first run spends one page behind
        // the loading screen instead of the whole backlog.
        isHydrated:
          state.isHydrated || REFERENCE_TABLES.every((table) => !result.pending.includes(table)),
      }));

      if (result.pending.length === 0) break;
    }

    useSyncStore.setState({ status: "idle", isHydrated: true, pending: [], syncTotalRows: null });
  } catch (error) {
    useSyncStore.setState({
      status: isUnauthorized(error) ? "unauthorized" : "error",
      error: toMessage(error),
    });
  }
}

/**
 * Serializes pulls: each call queues one behind whatever is already running, so a mutation that
 * asks to sync always gets a pull that started *after* its own write landed.
 *
 * Phase 4 replaces this with a proper engine holding a Web Lock, which is what it takes to keep
 * several tabs sharing one database in step.
 */
let queue: Promise<unknown> = Promise.resolve();

export function syncNow(): Promise<void> {
  const next = queue.then(pullUntilCaughtUp, pullUntilCaughtUp);
  queue = next.catch(() => undefined);
  return next;
}

let bootPromise: Promise<void> | undefined;

/**
 * Brings the store up, in the order that gets to interactive soonest:
 *
 * 1. read IndexedDB — a populated one hydrates the whole app in ~50ms, with no network at all;
 * 2. sync in the background from there. A first run has nothing to show, so it stays behind the
 *    loading screen until the pull finishes (see `SyncGate`).
 */
export function bootSync(): Promise<void> {
  bootPromise ??= (async () => {
    try {
      const snapshot = await readLocalSnapshot();
      useSyncStore.setState({
        ...snapshot.rows,
        cursors: snapshot.cursors,
        colors: snapshot.colors,
        usdRates: snapshot.usdRates,
        // A cursor is what says the local copy is a complete picture rather than a partial one.
        isHydrated: snapshot.cursors != null,
      });
    } catch (error) {
      // Private-mode Safari and friends: no local copy, so every boot is a first run.
      console.warn("Could not read the local database:", error);
    }

    await syncNow();
  })();

  return bootPromise;
}

/**
 * Forgets everything local — the rows, the cursors and the in-memory copy — so the next boot starts
 * from scratch. Used when the browser changes hands, which is the one case where keeping a cache of
 * somebody's finances around is not a convenience.
 */
export async function resetLocalData(): Promise<void> {
  bootPromise = undefined;
  useSyncStore.setState(initialState(), true);
  await deleteLocalDatabase();
}
