import { create } from "zustand";
import { pullChanges, pushChanges } from "~/api/sync.functions";
import { deleteLocalDatabase, readLocalSnapshot, writeLocalPage, writeLocalRows } from "./idb";
import { dropOutboxEntries, readOutboxBatch, readOutboxState, rowKey } from "./outbox";
import { PUSH_BATCH_LIMIT } from "./sync-types";
import type {
  Color,
  PullChangesResult,
  PushChangesResult,
  PushConflict,
  SyncedTable,
  SyncCursors,
  SyncedAccount,
  SyncedCategory,
  SyncedProfile,
  SyncedRow,
  SyncedRows,
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
 * scopes every row to them, and go back through `pushChanges`, which does the same again; the
 * client only decides what to *show*, and what to ask for.
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

  /** How many local writes are still waiting to reach the server. Zero means everything landed. */
  outboxCount: number;
  /** Whether the outbox is draining, and whether the last attempt to drain it failed. */
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
    pending: [],
    syncedRows: 0,
    syncTotalRows: null,
    cursors: undefined,
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

/** Re-reads how much is queued, and which rows a pull therefore has to leave alone. */
export async function refreshOutboxState(): Promise<void> {
  const { count, rowKeys } = await readOutboxState();
  pendingRowKeys = rowKeys;
  useSyncStore.setState({ outboxCount: count });
}

/**
 * A rejected call comes back as a resolved `Response` rather than a thrown error: TanStack Start
 * hands the raw response over when middleware throws one, which is how `authMiddleware` answers an
 * unauthenticated caller. Left unchecked it reaches the merge step as a payload with no rows.
 */
function isSyncResult<T>(value: T | Response): value is T {
  return typeof value === "object" && value != null && !(value instanceof Response);
}

/** A 401 is a dead session, which needs a redirect — not a retry like every other sync failure. */
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
      const result: PullChangesResult | Response = await pullChanges({
        data: { cursors, withCounts: page === 0 },
      });
      if (!isSyncResult(result)) throw result;

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
      applyRows(rows, true, result.colors);
      useSyncStore.setState((state) => ({
        cursors: result.nextCursors,
        pending: result.pending,
        syncedRows: state.syncedRows + rows.transactions.length,
        syncTotalRows: result.transactionBacklog ?? state.syncTotalRows,
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
 * Empties the outbox, oldest first.
 *
 * Batched because the deployed functions are capped at 10s and a CSV import is one entry per row;
 * each batch is atomic server-side, so a failure part-way through leaves the entries it did not
 * reach exactly where they were and the next attempt picks up from there. Entries are dropped only
 * after the server confirms them, which is what makes retrying safe rather than merely likely to
 * work — every mutation carries a whole row, so applying one twice lands on the same state.
 */
async function drainOutbox(): Promise<void> {
  for (;;) {
    const batch = await readOutboxBatch(PUSH_BATCH_LIMIT);
    if (batch.length === 0) return;

    const result: PushChangesResult | Response = await pushChanges({
      data: { mutations: batch.map(({ seq: _seq, ...mutation }) => mutation) },
    });
    if (!isSyncResult(result)) throw result;

    const applied = new Set(result.applied);
    const confirmed = batch.filter((entry) => applied.has(entry.mutationId));
    // The server resolves every mutation it is handed, so this only fires if the two ends have
    // drifted — and if they have, retrying the same batch forever against the database is worse
    // than saying so.
    if (confirmed.length === 0) throw new Error("The server confirmed none of the pushed changes.");

    await dropOutboxEntries(confirmed.map((entry) => entry.seq));
    await refreshOutboxState();

    // Only now that the entries are gone do the server's copies outrank the local ones.
    await writeLocalRows(result.canonicalRows, result.colors);
    applyRows(result.canonicalRows, true, result.colors);

    if (result.conflicts.length > 0) {
      useSyncStore.setState((state) => ({ conflicts: [...state.conflicts, ...result.conflicts] }));
    }

    // A short batch means the queue is empty; anything appended since gets its own debounced push.
    if (batch.length < PUSH_BATCH_LIMIT) return;
  }
}

/**
 * Serializes sync work: each call queues behind whatever is already running, so a push and a pull
 * never interleave and a pull always reflects the writes that were queued before it.
 *
 * Phase 4 replaces this with a proper engine holding a Web Lock, which is what it takes to keep
 * several tabs sharing one database in step.
 */
let queue: Promise<unknown> = Promise.resolve();

function enqueue(work: () => Promise<void>): Promise<void> {
  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

export function syncNow(): Promise<void> {
  return enqueue(pullUntilCaughtUp);
}

/** How long a write waits for its neighbours before it goes out. */
const PUSH_DEBOUNCE_MS = 1000;
const MAX_PUSH_BACKOFF_MS = 30_000;

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let failedPushes = 0;

/**
 * Flushes the outbox, then pulls.
 *
 * The pull is not redundant: the push hands back canonical rows for what it wrote, but nothing moves
 * the pull cursor past them, so without it the next boot re-downloads everything this device just
 * created. Doing it here puts that behind `SyncProgress` instead of on the loading path.
 */
export function pushNow(): Promise<void> {
  clearTimeout(pushTimer);
  pushTimer = undefined;

  return enqueue(async () => {
    useSyncStore.setState({ isPushing: true });
    try {
      await drainOutbox();
      failedPushes = 0;
      useSyncStore.setState({ isPushing: false });
    } catch (error) {
      failedPushes++;
      useSyncStore.setState({
        isPushing: false,
        status: isUnauthorized(error) ? "unauthorized" : useSyncStore.getState().status,
        error: toMessage(error),
      });
      // Usually just offline. The entries are on disk, so the retry costs nothing but patience.
      if (!isUnauthorized(error)) {
        schedulePush(Math.min(MAX_PUSH_BACKOFF_MS, PUSH_DEBOUNCE_MS * 2 ** failedPushes));
      }
      return;
    }

    await pullUntilCaughtUp();
  });
}

/**
 * Queues a push a moment from now, so a burst of edits leaves as one batch.
 *
 * Deliberately short: on Safari, IndexedDB for a site that has not been installed is evicted after
 * seven days of no visits, and an entry that never got pushed is the one thing here that exists
 * nowhere else.
 */
export function schedulePush(delayMs: number = PUSH_DEBOUNCE_MS): void {
  if (pushTimer != null) return;
  pushTimer = setTimeout(() => void pushNow(), delayMs);
}

/** Marks a batch of conflicts as reported, so it is not shown again. */
export function clearConflicts(reported: PushConflict[]): void {
  const seen = new Set(reported.map((conflict) => conflict.mutationId));
  useSyncStore.setState((state) => ({
    conflicts: state.conflicts.filter((conflict) => !seen.has(conflict.mutationId)),
  }));
}

let bootPromise: Promise<void> | undefined;

/**
 * Brings the store up, in the order that gets to interactive soonest:
 *
 * 1. read IndexedDB — a populated one hydrates the whole app in ~50ms, with no network at all;
 * 2. push whatever the last session left unsent, then pull. A first run has nothing to show, so it
 *    stays behind the loading screen until the pull finishes (see `SyncGate`).
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
      // Writes can outlive the session that made them — the browser was closed, or offline, before
      // the debounce fired. They have to be known about before the first pull, or it would apply
      // the server's older copy over them.
      await refreshOutboxState();
    } catch (error) {
      // Private-mode Safari and friends: no local copy, so every boot is a first run.
      console.warn("Could not read the local database:", error);
    }

    await (useSyncStore.getState().outboxCount > 0 ? pushNow() : syncNow());
  })();

  return bootPromise;
}

/**
 * Forgets everything local — the rows, the cursors, the queued writes and the in-memory copy — so
 * the next boot starts from scratch. Used when the browser changes hands, which is the one case
 * where keeping a cache of somebody's finances around is not a convenience.
 */
export async function resetLocalData(): Promise<void> {
  bootPromise = undefined;
  clearTimeout(pushTimer);
  pushTimer = undefined;
  pendingRowKeys = new Set();
  useSyncStore.setState(initialState(), true);
  await deleteLocalDatabase();
}
