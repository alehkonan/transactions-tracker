import { pullChanges, pushChanges } from "~/api/sync.functions";
import {
  deleteLocalDatabase,
  readLocalCursors,
  readLocalSnapshot,
  writeLocalPage,
  writeLocalRows,
} from "./idb";
import { dropOutboxEntries, readOutboxBatch } from "./outbox";
import { PUSH_BATCH_LIMIT } from "./sync-types";
import {
  applyServerRows,
  refreshOutboxState,
  replaceRows,
  resetSyncState,
  useSyncStore,
} from "./useSyncStore";
import type { PullChangesResult, PushChangesResult, SyncedTable } from "./sync-types";

/**
 * The one place that talks to the sync endpoints: when a pull or a push runs, in what order, and
 * what the rest of the browser is told about it afterwards.
 *
 * Phase 3 left this as a promise chain inside the store, which serializes the work of one tab and
 * knows nothing about any other. A second tab is not exotic here — it is what happens when someone
 * opens the app again instead of switching windows — and two tabs share one IndexedDB, so two
 * uncoordinated pulls write over each other's cursors and two uncoordinated drains push the same
 * outbox entries twice. So the mutex is a **Web Lock**, which is held across the whole browser
 * rather than the current document, and every tab is told what changed over a **BroadcastChannel**.
 *
 * Client-only: every entry point here is called from an effect or an event handler.
 */

/** Names the browser-wide mutex and the channel. Distinct concepts, but exactly one scope. */
const SYNC_LOCK = "transactions-tracker:sync";
const SYNC_CHANNEL = "transactions-tracker:sync";

/** How old the working set may get before an idle, visible tab refreshes it. */
const STALE_AFTER_MS = 5 * 60_000;
/** How often staleness is checked. Cheap, and browsers throttle a hidden tab's timers anyway. */
const STALENESS_CHECK_MS = 60_000;

/** How long a write waits for its neighbours before it goes out. */
const PUSH_DEBOUNCE_MS = 1000;
const MAX_PUSH_BACKOFF_MS = 30_000;

/**
 * A run of pages is bounded so a cursor that somehow stops advancing shows up as an error instead
 * of an endless loop against the database.
 */
const MAX_PAGES_PER_PULL = 200;

/**
 * The tables the app cannot render anything meaningful without: which accounts and categories exist,
 * and which profiles they belong to. All three are small enough to arrive in one page.
 *
 * `transactions` is deliberately not one of them. It is the only table big enough to need paging, so
 * waiting for the last page before showing anything means staring at a spinner for the sake of rows
 * that are already on their way — the app opens on the reference data and the transactions fill in.
 */
const REFERENCE_TABLES: SyncedTable[] = ["profiles", "accounts", "categories"];

/* -------------------------------------------------------------------------- */
/* The mutex                                                                   */
/* -------------------------------------------------------------------------- */

/** The fallback mutex, for browsers with no Web Locks — one tab's work, serialized as before. */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Runs sync work with nothing else syncing anywhere in this browser.
 *
 * `navigator.locks` is typed as always present but genuinely is not outside a secure context, so
 * the check is a runtime one the types do not cover. Where it is missing the mutex degrades to the
 * single-tab promise chain: still correct for the common case, just not across tabs.
 */
function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" && "locks" in navigator ? navigator.locks : null;
  if (locks) return locks.request(SYNC_LOCK, work);

  const next = queue.then(work, work);
  queue = next.catch(() => undefined);
  return next;
}

/* -------------------------------------------------------------------------- */
/* Cross-tab messages                                                          */
/* -------------------------------------------------------------------------- */

type SyncMessage =
  /** IndexedDB has moved on: rows, cursors or the outbox. Peers re-read it. */
  | { type: "changed" }
  /** The local database is gone — somebody signed out, or a different account signed in. */
  | { type: "reset" };

let channel: BroadcastChannel | undefined;

function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel(SYNC_CHANNEL);
  return channel;
}

/** Tells the other tabs; the sending context never receives its own message. */
function announce(message: SyncMessage): void {
  getChannel()?.postMessage(message);
}

/**
 * Announces a write that has been queued locally, so the tab next to this one shows it too.
 *
 * Called by `commit` rather than folded into `schedulePush`, because the two say different things:
 * a queued write is visible to every tab the moment it is on disk, whether or not the push that
 * carries it away is due yet.
 */
export function announceLocalWrite(): void {
  announce({ type: "changed" });
}

/**
 * Re-reads the whole local copy into the store.
 *
 * Whole rather than incremental because IndexedDB is the shared truth between tabs and a write is
 * always on disk before it is in memory, so a straight replace can only ever move this tab forward.
 * At this size the read is a few tens of milliseconds.
 */
async function hydrateFromLocal(): Promise<void> {
  const snapshot = await readLocalSnapshot();

  replaceRows(snapshot.rows, snapshot.colors, snapshot.usdRates);
  useSyncStore.setState((state) => ({
    // A cursor is what says the local copy is a complete picture rather than a partial one.
    isHydrated: state.isHydrated || snapshot.cursors != null,
  }));
  await refreshOutboxState();
}

/* -------------------------------------------------------------------------- */
/* Pull                                                                        */
/* -------------------------------------------------------------------------- */

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

async function pullUntilCaughtUp(): Promise<void> {
  useSyncStore.setState({ status: "syncing", error: null, syncedRows: 0, syncTotalRows: null });

  try {
    // From disk, not from the store: another tab may have pulled while this one sat idle, and its
    // cursor is the one that says what this browser already holds.
    let cursors = await readLocalCursors();
    let changedRows = 0;

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
      changedRows += Object.values(rows).reduce((total, table) => total + table.length, 0);
      applyServerRows(rows, result.colors);
      useSyncStore.setState((state) => ({
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

    useSyncStore.setState({
      status: "idle",
      isHydrated: true,
      pending: [],
      syncTotalRows: null,
      lastSyncedAt: Date.now(),
    });
    // A delta pull that found nothing is the common case, and telling the other tabs to re-read a
    // database that has not moved would rebuild their working set every five minutes for nothing.
    if (changedRows > 0) announce({ type: "changed" });
  } catch (error) {
    useSyncStore.setState({
      status: isUnauthorized(error) ? "unauthorized" : "error",
      error: toMessage(error),
    });
  }
}

/* -------------------------------------------------------------------------- */
/* Push                                                                        */
/* -------------------------------------------------------------------------- */

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
    // Read inside the lock, so a batch another tab has already pushed is never pushed again.
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
    applyServerRows(result.canonicalRows, result.colors);
    announce({ type: "changed" });

    if (result.conflicts.length > 0) {
      useSyncStore.setState((state) => ({ conflicts: [...state.conflicts, ...result.conflicts] }));
    }

    // A short batch means the queue is empty; anything appended since gets its own debounced push.
    if (batch.length < PUSH_BATCH_LIMIT) return;
  }
}

let pushTimer: ReturnType<typeof setTimeout> | undefined;
let failedPushes = 0;

/**
 * Flushes the outbox, then pulls.
 *
 * The pull is not redundant: the push hands back canonical rows for what it wrote, but nothing moves
 * the pull cursor past them, so without it the next boot re-downloads everything this device just
 * created. Doing it here puts that behind the sync indicator instead of on the loading path.
 */
export function pushNow(): Promise<void> {
  clearTimeout(pushTimer);
  pushTimer = undefined;

  return runExclusive(async () => {
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
      // Usually just offline. The entries are on disk, so the retry costs nothing but patience —
      // and the `online` event below cuts the wait short the moment there is a connection again.
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

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/** Brings this browser up to date: sends what is queued if anything is, otherwise just pulls. */
export function syncNow(): Promise<void> {
  if (useSyncStore.getState().outboxCount > 0) return pushNow();
  return runExclusive(pullUntilCaughtUp);
}

/**
 * Syncs only if the working set has had time to go stale.
 *
 * The check is against `lastSyncedAt`, which every tab updates from its own pulls, so a tab coming
 * back to the foreground next to one that has been syncing all along does nothing.
 */
function syncIfStale(): Promise<void> {
  const { status, isOnline, lastSyncedAt, outboxCount } = useSyncStore.getState();

  // A dead session is not something a timer can fix; the gate is already sending the user to login.
  if (status === "unauthorized" || !isOnline) return Promise.resolve();
  if (outboxCount === 0 && lastSyncedAt != null && Date.now() - lastSyncedAt < STALE_AFTER_MS) {
    return Promise.resolve();
  }

  return syncNow();
}

/** Peer messages arrive per page of a pull; one re-read after the run is enough. */
const PEER_RELOAD_DEBOUNCE_MS = 300;

function onOffline(): void {
  useSyncStore.setState({ isOnline: false });
}

// Queued writes exist nowhere but this browser until a push lands, and closing the tab is the
// moment that stops being the engine's problem and becomes the user's.
function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (useSyncStore.getState().outboxCount > 0) event.preventDefault();
}

/**
 * Starts everything that makes the app sync on its own, and returns the teardown.
 *
 * Owned by the engine rather than by a component so the listeners follow the app rather than a
 * particular screen — `beforeunload` in particular has to hold while the user is on `/profile`,
 * where the sync indicator is not rendered at all.
 */
export function startSyncTriggers(): () => void {
  useSyncStore.setState({ isOnline: navigator.onLine });

  const staleness = setInterval(() => {
    if (document.visibilityState === "visible") void syncIfStale();
  }, STALENESS_CHECK_MS);

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") void syncIfStale();
  };

  const onOnline = () => {
    useSyncStore.setState({ isOnline: true });
    // The backoff was patience about a connection that is now back; waiting out the rest of it
    // would leave writes queued for another half minute for no reason.
    failedPushes = 0;
    clearTimeout(pushTimer);
    pushTimer = undefined;
    void syncNow();
  };

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const onPeerMessage = (event: MessageEvent<SyncMessage>) => {
    if (event.data?.type === "reset") {
      // Signing out in one tab has to empty this one too, and a reload is what lands on `/login`:
      // the root guard reads the session cookie that sign-out has just cleared.
      window.location.reload();
      return;
    }

    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => void hydrateFromLocal(), PEER_RELOAD_DEBOUNCE_MS);
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("beforeunload", onBeforeUnload);
  getChannel()?.addEventListener("message", onPeerMessage);

  return () => {
    clearInterval(staleness);
    clearTimeout(reloadTimer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", onOffline);
    window.removeEventListener("beforeunload", onBeforeUnload);
    getChannel()?.removeEventListener("message", onPeerMessage);
  };
}

/* -------------------------------------------------------------------------- */
/* Boot and teardown                                                           */
/* -------------------------------------------------------------------------- */

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
      // Writes can outlive the session that made them — the browser was closed, or offline, before
      // the debounce fired. `hydrateFromLocal` reads the outbox with the rows, so the first pull
      // knows which rows it must not apply the server's older copy over.
      await hydrateFromLocal();
    } catch (error) {
      // Private-mode Safari and friends: no local copy, so every boot is a first run.
      console.warn("Could not read the local database:", error);
    }

    await syncNow();
  })();

  return bootPromise;
}

/**
 * Forgets everything local — the rows, the cursors, the queued writes and the in-memory copy — so
 * the next boot starts from scratch. Used when the browser changes hands, which is the one case
 * where keeping a cache of somebody's finances around is not a convenience. A session that merely
 * expires keeps its copy, so coming back is still instant.
 */
export async function resetLocalData(): Promise<void> {
  bootPromise = undefined;
  clearTimeout(pushTimer);
  pushTimer = undefined;
  failedPushes = 0;
  resetSyncState();
  await deleteLocalDatabase();
  // Any other tab is now showing data that no longer exists on this device.
  announce({ type: "reset" });
}
