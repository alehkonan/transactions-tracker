import { checkIntegrity, pullChanges, pushChanges } from "~/api/sync.functions";
import { uuidV7 } from "~/utils/uuid-v7";
import { runWithBrowserOperationLock } from "./browser-operation-lock";
import {
  assertCurrentReplicaContext,
  captureReplicaContext,
  captureSyncContext,
  beginReplicaTransition,
  clearLocalRows,
  readLocalCursors,
  readLocalSnapshot,
  recoverInterruptedReplicaTransition,
  replaceLocalReplica,
  subscribeToReplicaInvalidation,
  writeLocalPage,
} from "./idb";
import { compareIntegrity, localIntegrity } from "./integrity";
import { createOutboxStorage, readOutboxState } from "./outbox";
import {
  drainOutbox,
  type OutboxDeliveryResult,
  type OutboxDrainOutcome,
} from "./outbox-acceptance";
import {
  replicaContextFromDescriptor,
  type BoundReplicaContext,
  type ReplicaContext,
} from "./replica-identity";
import { isTerminalSyncError, readSyncResponseError } from "./sync-errors";
import {
  runSync,
  type PullDeliveryResult,
  type SyncRunOutcome,
  type SyncRunPage,
} from "./sync-run";
import { PUSH_BATCH_LIMIT, SYNC_PROTOCOL_VERSION } from "./sync-types";
import {
  applyServerRows,
  clearWorkingSet,
  refreshOutboxState,
  replaceOutboxState,
  replaceRows,
  resetSyncState,
  useSyncStore,
} from "./useSyncStore";
import type { IntegrityDivergence } from "./integrity";
import type {
  IntegrityResult,
  Mutation,
  PullChangesResult,
  PushChangesResult,
  SyncCursors,
} from "./sync-types";

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

/** Cross-tab invalidation channel. Mutual exclusion is shared with auth in browser-operation-lock. */
const SYNC_CHANNEL = "transactions-tracker:sync";

/** How old the working set may get before an idle, visible tab refreshes it. */
const STALE_AFTER_MS = 5 * 60_000;
/** How often staleness is checked. Cheap, and browsers throttle a hidden tab's timers anyway. */
const STALENESS_CHECK_MS = 60_000;

/** How long a write waits for its neighbours before it goes out. */
const PUSH_DEBOUNCE_MS = 1000;
const MAX_PUSH_BACKOFF_MS = 30_000;

/* -------------------------------------------------------------------------- */
/* The mutex                                                                   */
/* -------------------------------------------------------------------------- */

/** Runs sync work under the same browser-wide lock as cookie-changing auth finalization. */
function runExclusive<T>(work: () => Promise<T>): Promise<T> {
  return runWithBrowserOperationLock(work);
}

/* -------------------------------------------------------------------------- */
/* Cross-tab messages                                                          */
/* -------------------------------------------------------------------------- */

type SyncMessage =
  /** IndexedDB has moved on: rows, cursors or the outbox. Peers re-read only this replica. */
  | { type: "changed"; replicaId: string }
  /** A dangerous lifecycle transition started; peers must stop showing the old workspace. */
  | { type: "transition"; replicaId: string }
  /** The old replica was explicitly discarded after successful sign-out. */
  | { type: "replaced"; previousReplicaId: string; replicaId: string };

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
export function announceLocalWrite(replicaContext: ReplicaContext): void {
  announce({ type: "changed", replicaId: replicaContext.replicaId });
}

export function announceReplicaTransition(replicaContext: ReplicaContext): void {
  announce({ type: "transition", replicaId: replicaContext.replicaId });
}

/** Publishes a completed same-user transition and resumes sync through the ordinary scheduler. */
export function resumeSyncAfterSignIn(replicaContext: ReplicaContext): void {
  useSyncStore.setState({ replicaContext, status: "idle", error: null });
  announce({ type: "changed", replicaId: replicaContext.replicaId });
  schedulePush(0);
}

/** Clears callbacks and memory only after durable replacement has committed. */
export async function finishReplicaReplacement(
  previous: ReplicaContext,
  replacement: ReplicaContext,
): Promise<void> {
  bootPromise = undefined;
  clearTimeout(pushTimer);
  pushTimer = undefined;
  failedPushes = 0;
  resetSyncState();
  const { actions } = await import("~/modules/transactions-import/useTransactionsImport");
  actions.reset();
  announce({
    type: "replaced",
    previousReplicaId: previous.replicaId,
    replicaId: replacement.replicaId,
  });
}

/**
 * Re-reads the whole local copy into the store.
 *
 * Whole rather than incremental because IndexedDB is the shared truth between tabs and a write is
 * always on disk before it is in memory, so a straight replace can only ever move this tab forward.
 * At this size the read is a few tens of milliseconds.
 */
async function hydrateFromLocal(): Promise<boolean> {
  const snapshot = await readLocalSnapshot();
  const replicaContext = replicaContextFromDescriptor(snapshot.descriptor);
  await assertCurrentReplicaContext(replicaContext);

  const visibleReplicaId = useSyncStore.getState().replicaContext?.replicaId;
  if (visibleReplicaId != null && visibleReplicaId !== replicaContext.replicaId) {
    resetSyncState();
    window.location.reload();
    return false;
  }

  replaceRows(replicaContext, snapshot.rows, snapshot.colors, snapshot.usdRates);
  replaceOutboxState(snapshot.outbox);
  useSyncStore.setState((state) => ({
    // A cursor is what says the local copy is a complete picture rather than a partial one.
    isHydrated: state.isHydrated || snapshot.cursors != null,
    lastSyncedAt: snapshot.lastSyncedAt,
  }));
  return true;
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

async function classifyRejectedSyncResponse(
  response: Response,
): Promise<
  | { kind: "unauthorized"; error: unknown }
  | { kind: "terminal"; error: unknown }
  | { kind: "retryable"; error: unknown }
> {
  const error = await readSyncResponseError(response);
  if (error.code === "UNAUTHORIZED") return { kind: "unauthorized", error };
  if (isTerminalSyncError(error)) return { kind: "terminal", error };
  return { kind: "retryable", error };
}

function toMessage(error: unknown): string {
  if (error instanceof Response) return `The server rejected the request (${error.status}).`;
  if (error instanceof Error) return error.message;
  return "Could not reach the server.";
}

/**
 * Throws the local copy away, rows and cursors, leaving the queue of unpushed writes intact.
 *
 * Both halves have to go together: IndexedDB is what the next boot reads, and the store is what the
 * next merge writes back to it, so dropping one and keeping the other would restore exactly the
 * divergence being repaired.
 */
async function dropLocalCopy(replicaContext: ReplicaContext): Promise<void> {
  await clearLocalRows(replicaContext);
  clearWorkingSet();
}

async function pullPage(
  replicaContext: BoundReplicaContext,
  cursors: SyncCursors | undefined,
  withCounts: boolean,
): Promise<PullDeliveryResult> {
  try {
    const result: PullChangesResult | Response = await pullChanges({
      data: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        expectedOwnerUserId: replicaContext.ownerUserId,
        cursors,
        withCounts,
      },
    });
    if (!(result instanceof Response)) {
      if (
        result.protocolVersion !== SYNC_PROTOCOL_VERSION ||
        result.ownerUserId !== replicaContext.ownerUserId
      ) {
        return { kind: "terminal", error: new Error("The sync response owner did not match.") };
      }
      return { kind: "accepted", result };
    }
    return classifyRejectedSyncResponse(result);
  } catch (error) {
    if (error instanceof Response) return classifyRejectedSyncResponse(error);
    return { kind: "retryable", error };
  }
}

async function commitPulledPage(
  replicaContext: ReplicaContext,
  result: PullChangesResult,
): Promise<void> {
  await writeLocalPage(replicaContext, {
    rows: result.rows,
    cursors: result.nextCursors,
    pending: result.pending,
    colors: result.colors,
    usdRates: result.usdRates,
  });
}

async function applyPulledPage(replicaContext: ReplicaContext, page: SyncRunPage): Promise<void> {
  await assertCurrentReplicaContext(replicaContext);
  const { result } = page;
  applyServerRows(result.rows, result.colors);
  useSyncStore.setState((state) => ({
    pending: result.pending,
    syncedRows: state.syncedRows + result.rows.transactions.length,
    syncTotalRows: result.transactionBacklog ?? state.syncTotalRows,
    usdRates: result.usdRates ?? state.usdRates,
    // Opened as soon as the reference tables are complete, so a first run spends one page behind
    // the loading screen instead of the whole backlog.
    isHydrated: state.isHydrated || page.referenceTablesReady,
  }));
}

async function runPageSync(mode: "normal" | "resync"): Promise<SyncRunOutcome> {
  let replicaContext: BoundReplicaContext;
  try {
    replicaContext = await captureSyncContext();
  } catch (error) {
    useSyncStore.setState({ status: "error", error: toMessage(error) });
    return { kind: "retryable", phase: "pull", pushed: 0, error };
  }

  useSyncStore.setState({ status: "syncing", error: null, syncedRows: 0, syncTotalRows: null });
  const outcome = await runSync(mode, {
    remote: { pull: (cursors, withCounts) => pullPage(replicaContext, cursors, withCounts) },
    replica: {
      readCursors: () => readLocalCursors(replicaContext),
      hasQueuedWrites: async () => (await readOutboxState(replicaContext)).count > 0,
      clearCachedRows: () => dropLocalCopy(replicaContext),
      commitPulledPage: (result) => commitPulledPage(replicaContext, result),
    },
    push: { drain: () => drainPageOutbox(replicaContext) },
    onPage: (page) => applyPulledPage(replicaContext, page),
  });

  try {
    await assertCurrentReplicaContext(replicaContext);
  } catch {
    return outcome;
  }

  if (outcome.kind === "completed") {
    if (outcome.pushed > 0) failedPushes = 0;
    useSyncStore.setState({
      status: "idle",
      isHydrated: true,
      pending: [],
      syncTotalRows: null,
      lastSyncedAt: Date.now(),
    });
    if (outcome.changedRows > 0) {
      announce({ type: "changed", replicaId: replicaContext.replicaId });
    }
    return outcome;
  }

  if (outcome.kind === "unauthorized") {
    useSyncStore.setState({ status: "unauthorized", error: toMessage(outcome.error) });
  } else if (outcome.kind === "terminal") {
    useSyncStore.setState({ status: "error", error: toMessage(outcome.error) });
  } else if (outcome.kind === "retryable") {
    useSyncStore.setState({ status: "error", error: toMessage(outcome.error) });
    if (outcome.phase === "push") {
      failedPushes++;
      schedulePush(Math.min(MAX_PUSH_BACKOFF_MS, PUSH_DEBOUNCE_MS * 2 ** failedPushes));
    }
  } else if (outcome.kind === "didNotConverge") {
    useSyncStore.setState({
      status: "error",
      error: `Sync did not converge after ${outcome.pages} pages.`,
    });
  } else {
    useSyncStore.setState({ status: "idle", error: null });
  }

  return outcome;
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
async function sendPagePush(
  replicaContext: BoundReplicaContext,
  mutations: readonly Mutation[],
): Promise<OutboxDeliveryResult<PushChangesResult>> {
  try {
    const result: PushChangesResult | Response = await pushChanges({
      data: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        expectedOwnerUserId: replicaContext.ownerUserId,
        mutations: [...mutations],
      },
    });
    if (!(result instanceof Response)) {
      if (
        result.protocolVersion !== SYNC_PROTOCOL_VERSION ||
        result.ownerUserId !== replicaContext.ownerUserId
      ) {
        return { kind: "terminal", error: new Error("The sync response owner did not match.") };
      }
      return { kind: "accepted", result };
    }
    return classifyRejectedSyncResponse(result);
  } catch (error) {
    if (error instanceof Response) return classifyRejectedSyncResponse(error);
    return { kind: "retryable", error };
  }
}

async function applyAcceptedPageBatch(
  replicaContext: ReplicaContext,
  result: PushChangesResult,
): Promise<void> {
  await refreshOutboxState(replicaContext);
  applyServerRows(result.canonicalRows, result.colors);
  announce({ type: "changed", replicaId: replicaContext.replicaId });

  if (result.conflicts.length > 0) {
    useSyncStore.setState((state) => ({ conflicts: [...state.conflicts, ...result.conflicts] }));
  }
}

async function drainPageOutbox(replicaContext: BoundReplicaContext): Promise<OutboxDrainOutcome> {
  useSyncStore.setState({ isPushing: true });
  try {
    return await drainOutbox({
      storage: createOutboxStorage(replicaContext),
      batchLimit: PUSH_BATCH_LIMIT,
      toPayload: ({ seq: _seq, ...mutation }) => mutation,
      send: (mutations) => sendPagePush(replicaContext, mutations),
      onAccepted: (result) => applyAcceptedPageBatch(replicaContext, result),
    });
  } finally {
    useSyncStore.setState({ isPushing: false });
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
export function pushNow(): Promise<SyncRunOutcome> {
  clearTimeout(pushTimer);
  pushTimer = undefined;
  return runExclusive(() => runPageSync("normal"));
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
  pushTimer = setTimeout(() => {
    void pushNow().catch((error) => {
      useSyncStore.setState({ status: "error", error: toMessage(error) });
    });
  }, delayMs);
}

/* -------------------------------------------------------------------------- */
/* Integrity                                                                   */
/* -------------------------------------------------------------------------- */

export type IntegrityReport =
  /** Every table's fingerprint agrees with the server's. */
  | { outcome: "matched" }
  | { outcome: "diverged"; divergences: IntegrityDivergence[] }
  /**
   * The two ends are not comparable right now — writes are still queued, or a pull is still
   * streaming — so they are *expected* to differ and comparing them would only cry wolf.
   */
  | { outcome: "unsettled" };

/**
 * Asks the server what this user's data should look like, and compares it against what is on this
 * device — counts and checksums only, so the answer costs four aggregates and no rows.
 *
 * Held under the sync mutex so nothing is moving underneath the comparison, and reported rather
 * than acted on: the repair is `resyncFromScratch`, and throwing away a local copy is not something
 * to do behind the user's back on the strength of one mismatched number.
 */
export function verifyIntegrity(): Promise<IntegrityReport> {
  return runExclusive(async () => {
    const replicaContext = await captureSyncContext();
    const before = useSyncStore.getState();
    if (!before.isHydrated || before.outboxCount > 0 || before.pending.length > 0) {
      return { outcome: "unsettled" };
    }

    const server: IntegrityResult | Response = await checkIntegrity({
      data: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        expectedOwnerUserId: replicaContext.ownerUserId,
      },
    });
    if (!isSyncResult(server)) throw await readSyncResponseError(server);
    if (
      server.protocolVersion !== SYNC_PROTOCOL_VERSION ||
      server.ownerUserId !== replicaContext.ownerUserId
    ) {
      throw new Error("The integrity response owner did not match.");
    }
    await assertCurrentReplicaContext(replicaContext);

    // Folded after the answer arrives rather than before it, so the local side of the comparison is
    // the more recent of the two — a peer tab's write landing mid-call reads as data the server has
    // not been asked about yet, which the next check settles.
    const state = useSyncStore.getState();
    const divergences = compareIntegrity(
      localIntegrity({
        profiles: state.profiles,
        accounts: state.accounts,
        categories: state.categories,
        transactions: state.transactions,
      }),
      server,
    );

    return divergences.length === 0 ? { outcome: "matched" } : { outcome: "diverged", divergences };
  });
}

/**
 * Drops the local copy and pulls the whole working set again.
 *
 * The only repair there is, and deliberately the blunt one: the sync path cannot tell *which* of its
 * assumptions failed, so it does not try to patch the difference. Refuses while writes are queued —
 * they are the one thing here that a re-pull could not bring back.
 */
export function resyncFromScratch(): Promise<SyncRunOutcome> {
  return runExclusive(() => runPageSync("resync"));
}

/* -------------------------------------------------------------------------- */
/* Triggers                                                                    */
/* -------------------------------------------------------------------------- */

/** Brings this browser up to date: sends what is queued if anything is, otherwise just pulls. */
export function syncNow(): Promise<SyncRunOutcome> {
  return runExclusive(() => runPageSync("normal"));
}

/**
 * Syncs only if the working set has had time to go stale.
 *
 * The check is against `lastSyncedAt`, which every tab updates from its own pulls, so a tab coming
 * back to the foreground next to one that has been syncing all along does nothing.
 */
async function syncIfStale(): Promise<void> {
  const { status, isOnline, lastSyncedAt, outboxCount } = useSyncStore.getState();

  // A dead session is not something a timer can fix; the gate is already sending the user to login.
  if (status === "unauthorized" || !isOnline) return;
  if (outboxCount === 0 && lastSyncedAt != null && Date.now() - lastSyncedAt < STALE_AFTER_MS)
    return;

  await syncNow();
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
    if (document.visibilityState !== "visible") return;
    void hydrateFromLocal()
      .then((current) => (current ? syncIfStale() : undefined))
      .catch(() => undefined);
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

  const stopWatchingReplica = subscribeToReplicaInvalidation(() => {
    bootPromise = undefined;
    clearTimeout(pushTimer);
    pushTimer = undefined;
    resetSyncState();
    useSyncStore.setState({
      status: "error",
      error: "Local storage changed in another tab. Reload to continue safely.",
    });
  });

  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  const onPeerMessage = (event: MessageEvent<SyncMessage>) => {
    const message = event.data;
    const currentReplicaId = useSyncStore.getState().replicaContext?.replicaId;
    if (!message || currentReplicaId == null) return;

    if (message.type === "transition") {
      if (message.replicaId !== currentReplicaId) return;
      clearTimeout(pushTimer);
      pushTimer = undefined;
      clearWorkingSet();
      useSyncStore.setState({
        status: "error",
        error: "This local workspace is changing in another tab. Reopen it to continue safely.",
      });
      return;
    }

    if (message.type === "replaced") {
      if (message.previousReplicaId !== currentReplicaId) return;
      resetSyncState();
      window.location.reload();
      return;
    }

    if (message.replicaId !== currentReplicaId) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      void hydrateFromLocal().catch(() => undefined);
    }, PEER_RELOAD_DEBOUNCE_MS);
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", onOffline);
  window.addEventListener("beforeunload", onBeforeUnload);
  getChannel()?.addEventListener("message", onPeerMessage);

  return () => {
    clearInterval(staleness);
    clearTimeout(reloadTimer);
    stopWatchingReplica();
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

let bootPromise: Promise<SyncRunOutcome> | undefined;

/**
 * Brings the store up, in the order that gets to interactive soonest:
 *
 * 1. read IndexedDB — a populated one hydrates the whole app in ~50ms, with no network at all;
 * 2. push whatever the last session left unsent, then pull. A first run has nothing to show, so it
 *    stays behind the loading screen until the pull finishes (see `SyncGate`).
 */
export function bootSync(): Promise<SyncRunOutcome> {
  bootPromise ??= (async (): Promise<SyncRunOutcome> => {
    let recoveredTransition: ReplicaContext | null;
    try {
      recoveredTransition = await runExclusive(recoverInterruptedReplicaTransition);
    } catch (error) {
      useSyncStore.setState({ status: "error", error: toMessage(error) });
      return { kind: "retryable", phase: "pull", pushed: 0, error };
    }

    try {
      // Writes can outlive the session that made them — the browser was closed, or offline, before
      // the debounce fired. `hydrateFromLocal` reads the outbox with the rows, so the first pull
      // knows which rows it must not apply the server's older copy over.
      await hydrateFromLocal();
    } catch (error) {
      // Private-mode Safari and friends: no local copy, so every boot is a first run.
      console.warn("Could not read the local database:", error);
    }

    if (recoveredTransition) {
      const error = new Error("Sign in again before synchronization resumes.");
      useSyncStore.setState({ status: "unauthorized", error: error.message });
      return { kind: "unauthorized", phase: "pull", pushed: 0, error };
    }

    const outcome = await syncNow();
    // Best-effort eviction protection. The browser decides whether to grant this idempotent request;
    // when granted, it covers both IndexedDB and the service worker's Cache Storage.
    void navigator.storage?.persist?.().catch(() => {});
    return outcome;
  })();

  return bootPromise;
}

/**
 * Forgets everything local — the rows, the cursors, the queued writes and the in-memory copy — so
 * the next boot starts from scratch. Used when the browser changes hands, which is the one case
 * where keeping a cache of somebody's finances around is not a convenience. A session that merely
 * expires keeps its copy, so coming back is still instant.
 */
export function resetLocalData(): Promise<void> {
  return runExclusive(async () => {
    const replicaContext = await captureReplicaContext({ allowRecovery: true });
    const transitionId = uuidV7();
    await beginReplicaTransition(replicaContext, {
      transitionId,
      kind: "replace",
      startedAt: Date.now(),
    });
    announceReplicaTransition(replicaContext);
    const replacement = await replaceLocalReplica(replicaContext, transitionId);
    await finishReplicaReplacement(replicaContext, replacement);
  });
}
