import {
  allocationId,
  filterPendingCascades,
  hasPendingSource,
  operatingRows,
  pendingParentDeletes,
} from "~/modules/spheres/operating";
import { validateReallocationMutations } from "~/modules/spheres/reallocation";
import { validateSphereMutations } from "~/modules/spheres/sphere-lifecycle";
import { uuidV7 } from "~/utils/uuid-v7";
import { INDEXED_DB_NAME, INDEXED_DB_VERSION } from "./indexed-db-contract";
import { assertCompleteAcceptance, assertCompleteOperations } from "./outbox-acceptance";
import {
  classifyLegacyOwnership,
  replicaContextFromDescriptor,
  type BoundReplicaContext,
  type ReplicaContext,
  type ReplicaDescriptor,
  type ReplicaIdentity,
  type ReplicaTransition,
} from "./replica-identity";
import { SYNCED_TABLES } from "./sync-types";
import type {
  Color,
  Mutation,
  SyncCursors,
  SyncedRow,
  SyncedRows,
  SyncedTable,
} from "./sync-types";

const META_STORE = "meta";
const DESCRIPTOR_KEY = "replicaDescriptor";
const CURSORS_KEY = "cursors";
const COLORS_KEY = "colors";
const USD_RATES_KEY = "usdRates";
const SELECTED_PROFILE_KEY = "selectedProfileId";
const LOCAL_REVISION_KEY = "localRevision";
const COMPLETE_TABLES_KEY = "completeTables";
const LAST_SYNCED_AT_KEY = "lastSyncedAt";

/** The queue of local writes waiting to be pushed, in the order they were made. */
export const OUTBOX_STORE = "outbox";

type OutboxSnapshot = {
  count: number;
  rowKeys: Set<string>;
  entries: SequencedMutation[];
  deletedParentKeys: Set<string>;
};

/** Everything needed to open one internally consistent local workspace. */
export type LocalSnapshot = {
  descriptor: ReplicaDescriptor;
  rows: SyncedRows;
  cursors: SyncCursors | undefined;
  colors: Color[];
  usdRates: Record<string, number>;
  selectedProfileId: string | null;
  localRevision: number;
  completeTables: SyncedTable[];
  lastSyncedAt: number | null;
  outbox: OutboxSnapshot;
};

class ReplicaContextChangedError extends Error {
  constructor() {
    super("The local replica changed while the operation was in progress.");
    this.name = "ReplicaContextChangedError";
  }
}

class ReplicaRecoveryRequiredError extends Error {
  constructor() {
    super("The legacy local replica requires recovery before it can be bound or synchronized.");
    this.name = "ReplicaRecoveryRequiredError";
  }
}

class ReplicaIdentityRequiredError extends Error {
  constructor() {
    super("The local replica must be bound to a server-confirmed identity before synchronization.");
    this.name = "ReplicaIdentityRequiredError";
  }
}

class ReplicaSyncAuthRequiredError extends Error {
  constructor() {
    super("Sign in again before synchronization resumes.");
    this.name = "ReplicaSyncAuthRequiredError";
  }
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
  });
}

function whenComplete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve());
    transaction.addEventListener("error", () => reject(transaction.error));
    transaction.addEventListener("abort", () => reject(transaction.error));
  });
}

function createDescriptor(
  legacyOwnership: ReplicaDescriptor["legacyOwnership"],
): ReplicaDescriptor {
  return {
    replicaId: uuidV7(),
    identity: null,
    lifecycle: "active",
    syncAuth: "unknown",
    legacyOwnership,
  };
}

function createMissingStores(database: IDBDatabase): void {
  for (const table of SYNCED_TABLES) {
    if (!database.objectStoreNames.contains(table)) {
      database.createObjectStore(table, { keyPath: "id" });
    }
  }
  if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE);
  if (!database.objectStoreNames.contains(OUTBOX_STORE)) {
    database.createObjectStore(OUTBOX_STORE, { keyPath: "seq", autoIncrement: true });
  }
}

/** Initializes v3 metadata from v2 rows without modifying any existing row or queue entry. */
function initializeV3Metadata(transaction: IDBTransaction): void {
  const meta = transaction.objectStore(META_STORE);
  const descriptorRequest = meta.get(DESCRIPTOR_KEY);
  descriptorRequest.addEventListener("success", () => {
    if (descriptorRequest.result != null) return;

    const requests = {
      profiles: transaction.objectStore("profiles").getAll(),
      accounts: transaction.objectStore("accounts").getAll(),
      categories: transaction.objectStore("categories").getAll(),
      transactions: transaction.objectStore("transactions").getAll(),
      outbox: transaction.objectStore(OUTBOX_STORE).getAll(),
      cursors: meta.get(CURSORS_KEY),
    };
    let remaining = Object.keys(requests).length;
    const finish = () => {
      remaining--;
      if (remaining > 0) return;

      const legacyOwnership = classifyLegacyOwnership({
        profiles: requests.profiles.result,
        accounts: requests.accounts.result,
        categories: requests.categories.result,
        transactions: requests.transactions.result,
        outbox: requests.outbox.result,
      });
      const cursors = requests.cursors.result as SyncCursors | undefined;
      meta.put(createDescriptor(legacyOwnership), DESCRIPTOR_KEY);
      meta.put(0, LOCAL_REVISION_KEY);
      meta.put(cursors == null ? [] : Object.keys(cursors), COMPLETE_TABLES_KEY);
    };

    for (const request of Object.values(requests)) {
      request.addEventListener("success", finish);
      request.addEventListener("error", () => transaction.abort());
    }
  });
  descriptorRequest.addEventListener("error", () => transaction.abort());
}

/** Upgrade materialized records without changing a single queued intent or receipt fingerprint.
 * Hashing runs outside IDB transactions. A revision fence retries if another tab writes meanwhile.
 */
/* oxlint-disable no-await-in-loop -- each retry must re-read after the previous revision fence. */
async function initializeOperating(database: IDBDatabase): Promise<void> {
  const initialized = await promisify(
    database
      .transaction(META_STORE, "readonly")
      .objectStore(META_STORE)
      .get("financialModelVersion"),
  );
  if (initialized === 1) return;
  for (;;) {
    const read = database.transaction([...SYNCED_TABLES, META_STORE], "readonly");
    const meta = read.objectStore(META_STORE);
    const [version, revision, profiles, accounts, transactions, descriptor] = await Promise.all([
      promisify(meta.get("financialModelVersion")),
      promisify(meta.get(LOCAL_REVISION_KEY)),
      promisify(read.objectStore("profiles").getAll()),
      promisify(read.objectStore("accounts").getAll()),
      promisify(read.objectStore("transactions").getAll()),
      promisify(meta.get(DESCRIPTOR_KEY)),
    ]);
    if (version === 1) return;
    const accountsById = new Map((accounts as SyncedRows["accounts"]).map((row) => [row.id, row]));
    const attributable = (transactions as SyncedRows["transactions"]).filter(
      (row) =>
        row.accountId != null && accountsById.get(row.accountId)?.profileId === row.profileId,
    );
    const inconsistent = attributable.length !== transactions.length;
    const rows = await operatingRows({ profiles, accounts, transactions: attributable }, accounts);
    const write = database.transaction([...SYNCED_TABLES, META_STORE], "readwrite");
    const writeMeta = write.objectStore(META_STORE);
    let retry = false;
    const currentRevision = writeMeta.get(LOCAL_REVISION_KEY);
    const currentVersion = writeMeta.get("financialModelVersion");
    let ready = 0;
    const finish = () => {
      if (++ready !== 2 || currentVersion.result === 1) return;
      if (currentRevision.result !== revision) {
        retry = true;
        return;
      }
      for (const sphere of rows.spheres) write.objectStore("spheres").put(sphere);
      for (const allocation of rows.allocations) write.objectStore("allocations").put(allocation);
      writeMeta.put(1, "financialModelVersion");
      if (inconsistent)
        writeMeta.put(
          {
            ...descriptor,
            legacyOwnership: { kind: "recovery-required", reasons: ["inconsistent-references"] },
          } satisfies ReplicaDescriptor,
          DESCRIPTOR_KEY,
        );
    };
    currentRevision.addEventListener("success", finish);
    currentVersion.addEventListener("success", finish);
    currentRevision.addEventListener("error", () => write.abort());
    currentVersion.addEventListener("error", () => write.abort());
    await whenComplete(write);
    if (!retry) return;
  }
}
/* oxlint-enable no-await-in-loop */

let databasePromise: Promise<IDBDatabase> | undefined;
const invalidationListeners = new Set<() => void>();

function invalidateDatabase(database: IDBDatabase): void {
  database.close();
  databasePromise = undefined;
  for (const listener of invalidationListeners) listener();
}

/** Called when another context upgrades or replaces the database behind this page. */
export function subscribeToReplicaInvalidation(listener: () => void): () => void {
  invalidationListeners.add(listener);
  return () => invalidationListeners.delete(listener);
}

export function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  let opening: Promise<IDBDatabase>;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(INDEXED_DB_NAME, INDEXED_DB_VERSION);
    let blocked = false;

    request.addEventListener("upgradeneeded", (event) => {
      createMissingStores(request.result);
      if (event.oldVersion < 3) initializeV3Metadata(request.transaction!);
    });
    request.addEventListener("success", () => {
      if (blocked) {
        request.result.close();
        return;
      }
      const database = request.result;
      database.addEventListener("versionchange", () => invalidateDatabase(database));
      void initializeOperating(database).then(
        () => resolve(database),
        (error) => {
          database.close();
          reject(error);
        },
      );
    });
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () => {
      blocked = true;
      reject(new Error("The local database upgrade is blocked by another tab."));
    });
  });

  databasePromise = opening;
  void opening.catch(() => {
    if (databasePromise === opening) databasePromise = undefined;
  });
  return opening;
}

function effectiveContext(descriptor: ReplicaDescriptor): ReplicaContext {
  return replicaContextFromDescriptor(descriptor);
}

function assertExpectedContext(
  descriptor: ReplicaDescriptor | undefined,
  expected: ReplicaContext,
  allowRecovery = false,
): asserts descriptor is ReplicaDescriptor {
  if (descriptor == null || descriptor.lifecycle !== "active") {
    throw new ReplicaContextChangedError();
  }
  if (descriptor.legacyOwnership.kind === "recovery-required" && !allowRecovery) {
    throw new ReplicaRecoveryRequiredError();
  }
  const actual = effectiveContext(descriptor);
  if (actual.replicaId !== expected.replicaId || actual.ownerUserId !== expected.ownerUserId) {
    throw new ReplicaContextChangedError();
  }
}

function guardedTransaction(
  stores: readonly string[],
  expected: ReplicaContext,
  mutate: (
    transaction: IDBTransaction,
    descriptor: ReplicaDescriptor,
    fail: (error: unknown) => void,
  ) => void,
  options: { allowRecovery?: boolean } = {},
): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          Array.from(new Set([...stores, META_STORE])),
          "readwrite",
        );
        let failure: unknown;
        const descriptorRequest = transaction.objectStore(META_STORE).get(DESCRIPTOR_KEY);

        descriptorRequest.addEventListener("success", () => {
          try {
            const descriptor = descriptorRequest.result as ReplicaDescriptor | undefined;
            assertExpectedContext(descriptor, expected, options.allowRecovery);
            mutate(transaction, descriptor, (error) => {
              failure = error;
              transaction.abort();
            });
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        });
        descriptorRequest.addEventListener("error", () => {
          failure = descriptorRequest.error;
          transaction.abort();
        });
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(failure ?? transaction.error));
        transaction.addEventListener("abort", () => reject(failure ?? transaction.error));
      }),
  );
}

function assertExpectedTransition(
  descriptor: ReplicaDescriptor | undefined,
  expected: ReplicaContext,
  transitionId: string,
): asserts descriptor is ReplicaDescriptor {
  if (
    descriptor == null ||
    descriptor.lifecycle !== "transitioning" ||
    descriptor.transition?.transitionId !== transitionId
  ) {
    throw new ReplicaContextChangedError();
  }
  const actual = effectiveContext(descriptor);
  if (actual.replicaId !== expected.replicaId || actual.ownerUserId !== expected.ownerUserId) {
    throw new ReplicaContextChangedError();
  }
}

function transitionedTransaction(
  stores: readonly string[],
  expected: ReplicaContext,
  transitionId: string,
  mutate: (transaction: IDBTransaction, descriptor: ReplicaDescriptor) => void,
): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          Array.from(new Set([...stores, META_STORE])),
          "readwrite",
        );
        let failure: unknown;
        const descriptorRequest = transaction.objectStore(META_STORE).get(DESCRIPTOR_KEY);
        descriptorRequest.addEventListener("success", () => {
          try {
            const descriptor = descriptorRequest.result as ReplicaDescriptor | undefined;
            assertExpectedTransition(descriptor, expected, transitionId);
            mutate(transaction, descriptor);
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        });
        descriptorRequest.addEventListener("error", () => {
          failure = descriptorRequest.error;
          transaction.abort();
        });
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(failure ?? transaction.error));
        transaction.addEventListener("abort", () => reject(failure ?? transaction.error));
      }),
  );
}

export async function readReplicaDescriptor(): Promise<ReplicaDescriptor> {
  const database = await openDatabase();
  const descriptor = (await promisify(
    database.transaction(META_STORE, "readonly").objectStore(META_STORE).get(DESCRIPTOR_KEY),
  )) as ReplicaDescriptor | undefined;
  if (!descriptor) throw new Error("The local replica descriptor is missing.");
  return descriptor;
}

export async function captureReplicaContext(
  options: { allowRecovery?: boolean } = {},
): Promise<ReplicaContext> {
  const descriptor = await readReplicaDescriptor();
  if (descriptor.lifecycle !== "active") throw new ReplicaContextChangedError();
  if (descriptor.legacyOwnership.kind === "recovery-required" && !options.allowRecovery) {
    throw new ReplicaRecoveryRequiredError();
  }
  return effectiveContext(descriptor);
}

export function beginReplicaTransition(
  expected: ReplicaContext,
  transition: ReplicaTransition,
): Promise<void> {
  return guardedTransaction(
    [],
    expected,
    (transaction, descriptor) => {
      transaction.objectStore(META_STORE).put(
        {
          ...descriptor,
          lifecycle: "transitioning",
          transition,
          syncAuth: "login-required",
        } satisfies ReplicaDescriptor,
        DESCRIPTOR_KEY,
      );
    },
    { allowRecovery: true },
  );
}

/**
 * Atomically captures local-only obligations and starts sign-out. A separately read count could be
 * stale by the time the destructive transition begins because ordinary local commits do not take the
 * auth lock.
 */
export function beginReplicaSignOutTransition(
  expected: ReplicaContext,
  transition: ReplicaTransition,
): Promise<number> {
  return openDatabase().then(
    (database) =>
      new Promise<number>((resolve, reject) => {
        const transaction = database.transaction([META_STORE, OUTBOX_STORE], "readwrite");
        let outboxCount = 0;
        let failure: unknown;
        const descriptorRequest = transaction.objectStore(META_STORE).get(DESCRIPTOR_KEY);
        const outboxRequest = transaction.objectStore(OUTBOX_STORE).count();

        descriptorRequest.addEventListener("success", () => {
          try {
            const descriptor = descriptorRequest.result as ReplicaDescriptor | undefined;
            assertExpectedContext(descriptor, expected, true);
            transaction.objectStore(META_STORE).put(
              {
                ...descriptor,
                lifecycle: "transitioning",
                transition,
                syncAuth: "login-required",
              } satisfies ReplicaDescriptor,
              DESCRIPTOR_KEY,
            );
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        });
        descriptorRequest.addEventListener("error", () => {
          failure = descriptorRequest.error;
          transaction.abort();
        });
        outboxRequest.addEventListener("success", () => {
          outboxCount = outboxRequest.result;
        });
        outboxRequest.addEventListener("error", () => {
          failure = outboxRequest.error;
          transaction.abort();
        });
        transaction.addEventListener("complete", () => resolve(outboxCount));
        transaction.addEventListener("error", () => reject(failure ?? transaction.error));
        transaction.addEventListener("abort", () => reject(failure ?? transaction.error));
      }),
  );
}

export function cancelReplicaTransition(
  expected: ReplicaContext,
  transitionId: string,
): Promise<void> {
  return transitionedTransaction([], expected, transitionId, (transaction, descriptor) => {
    const { transition: _transition, ...rest } = descriptor;
    transaction
      .objectStore(META_STORE)
      .put({ ...rest, lifecycle: "active" } satisfies ReplicaDescriptor, DESCRIPTOR_KEY);
  });
}

export function completeReplicaSignIn(
  expected: ReplicaContext,
  transitionId: string,
  identity: Omit<ReplicaIdentity, "replicaId">,
): Promise<void> {
  return transitionedTransaction([], expected, transitionId, (transaction, descriptor) => {
    if (descriptor.legacyOwnership.kind === "recovery-required") {
      throw new ReplicaRecoveryRequiredError();
    }
    const existingOwner = effectiveContext(descriptor).ownerUserId;
    if (existingOwner != null && existingOwner !== identity.ownerUserId) {
      throw new ReplicaContextChangedError();
    }
    const { transition: _transition, ...rest } = descriptor;
    transaction.objectStore(META_STORE).put(
      {
        ...rest,
        lifecycle: "active",
        identity: { ...identity, replicaId: descriptor.replicaId },
        syncAuth: "authenticated",
        legacyOwnership: { kind: "migrated" },
      } satisfies ReplicaDescriptor,
      DESCRIPTOR_KEY,
    );
  });
}

/**
 * Repairs a marker left by a crashed tab. Call only while holding the browser operation lock; the
 * lock proves no live finalization still owns the transition.
 */
export async function recoverInterruptedReplicaTransition(): Promise<ReplicaContext | null> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readwrite");
  const meta = transaction.objectStore(META_STORE);
  const descriptorRequest = meta.get(DESCRIPTOR_KEY);
  let recovered: ReplicaContext | null = null;

  descriptorRequest.addEventListener("success", () => {
    const descriptor = descriptorRequest.result as ReplicaDescriptor | undefined;
    if (!descriptor || descriptor.lifecycle !== "transitioning") return;
    recovered = effectiveContext(descriptor);
    const { transition: _transition, ...rest } = descriptor;
    meta.put(
      { ...rest, lifecycle: "active", syncAuth: "login-required" } satisfies ReplicaDescriptor,
      DESCRIPTOR_KEY,
    );
  });
  await whenComplete(transaction);
  return recovered;
}

/** Sync requires durable server-confirmed ownership; a legacy candidate is not authorization. */
export async function captureSyncContext(): Promise<BoundReplicaContext> {
  const descriptor = await readReplicaDescriptor();
  if (descriptor.lifecycle !== "active") throw new ReplicaContextChangedError();
  if (descriptor.legacyOwnership.kind === "recovery-required") {
    throw new ReplicaRecoveryRequiredError();
  }
  if (descriptor.identity == null) throw new ReplicaIdentityRequiredError();
  if (descriptor.syncAuth === "login-required" || descriptor.syncAuth === "owner-mismatch") {
    throw new ReplicaSyncAuthRequiredError();
  }
  return {
    replicaId: descriptor.replicaId,
    ownerUserId: descriptor.identity.ownerUserId,
  };
}

/** Rechecks a captured context immediately before publishing non-durable state. */
export async function assertCurrentReplicaContext(expected: ReplicaContext): Promise<void> {
  assertExpectedContext(await readReplicaDescriptor(), expected);
}

/** Reads rows, durable metadata, selection, and queue state from one transaction. */
export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction(
    [...SYNCED_TABLES, META_STORE, OUTBOX_STORE],
    "readonly",
  );
  const meta = transaction.objectStore(META_STORE);
  const outboxRequest = transaction.objectStore(OUTBOX_STORE).getAll();
  const [
    profiles,
    accounts,
    categories,
    transactions,
    spheres,
    allocations,
    descriptor,
    cursors,
    colors,
    usdRates,
    selectedProfileId,
    localRevision,
    completeTables,
    lastSyncedAt,
    outbox,
  ] = await Promise.all([
    promisify(transaction.objectStore("profiles").getAll()),
    promisify(transaction.objectStore("accounts").getAll()),
    promisify(transaction.objectStore("categories").getAll()),
    promisify(transaction.objectStore("transactions").getAll()),
    promisify(transaction.objectStore("spheres").getAll()),
    promisify(transaction.objectStore("allocations").getAll()),
    promisify(meta.get(DESCRIPTOR_KEY)),
    promisify(meta.get(CURSORS_KEY)),
    promisify(meta.get(COLORS_KEY)),
    promisify(meta.get(USD_RATES_KEY)),
    promisify(meta.get(SELECTED_PROFILE_KEY)),
    promisify(meta.get(LOCAL_REVISION_KEY)),
    promisify(meta.get(COMPLETE_TABLES_KEY)),
    promisify(meta.get(LAST_SYNCED_AT_KEY)),
    promisify(outboxRequest),
  ]);
  await whenComplete(transaction);

  if (!descriptor) throw new Error("The local replica descriptor is missing.");
  const liveProfileIds = new Set(
    (profiles as SyncedRows["profiles"])
      .filter((profile) => profile.deletedAt == null)
      .map((profile) => profile.id),
  );
  const selected =
    typeof selectedProfileId === "string" && liveProfileIds.has(selectedProfileId)
      ? selectedProfileId
      : null;
  const entries = outbox as SequencedMutation[];

  return {
    descriptor: descriptor as ReplicaDescriptor,
    rows: { profiles, accounts, categories, transactions, spheres, allocations } as SyncedRows,
    cursors: cursors as SyncCursors | undefined,
    colors: (colors as Color[] | undefined) ?? [],
    usdRates: (usdRates as Record<string, number> | undefined) ?? {},
    selectedProfileId: selected,
    localRevision: (localRevision as number | undefined) ?? 0,
    completeTables: (completeTables as SyncedTable[] | undefined) ?? [],
    lastSyncedAt: (lastSyncedAt as number | undefined) ?? null,
    outbox: {
      count: entries.length,
      rowKeys: new Set(entries.map((entry) => `${entry.table}:${entry.rowId}`)),
      entries,
      deletedParentKeys: pendingParentDeletes(entries),
    },
  };
}

export async function readLocalCursors(
  expected?: ReplicaContext,
): Promise<SyncCursors | undefined> {
  const database = await openDatabase();
  const transaction = database.transaction(META_STORE, "readonly");
  const store = transaction.objectStore(META_STORE);
  const [descriptor, cursors] = await Promise.all([
    promisify(store.get(DESCRIPTOR_KEY)),
    promisify(store.get(CURSORS_KEY)),
  ]);
  if (expected) assertExpectedContext(descriptor as ReplicaDescriptor | undefined, expected);
  return cursors as SyncCursors | undefined;
}

type SequencedMutation = Mutation & { seq: number };

export function filterQueuedServerRows(
  rows: Partial<SyncedRows>,
  protectedRowKeys: ReadonlySet<string>,
): Partial<SyncedRows> {
  return Object.fromEntries(
    SYNCED_TABLES.map((table) => [
      table,
      ((rows[table] as SyncedRow[] | undefined) ?? []).filter(
        (row) => !hasPendingSource(table, row, protectedRowKeys),
      ),
    ]),
  ) as Partial<SyncedRows>;
}

function putRows(
  transaction: IDBTransaction,
  rows: Partial<SyncedRows>,
  protectedRowKeys = new Set<string>(),
): void {
  const unprotectedRows = filterQueuedServerRows(rows, protectedRowKeys);
  for (const table of SYNCED_TABLES) {
    const incoming = unprotectedRows[table] as SyncedRow[] | undefined;
    if (!incoming?.length) continue;
    const store = transaction.objectStore(table);
    for (const row of incoming) {
      if (row.deletedAt) store.delete(row.id);
      else store.put(row);
    }
  }
}

function putServerRows(
  transaction: IDBTransaction,
  rows: Partial<SyncedRows>,
  settledSeqs = new Set<number>(),
  pulling = false,
): void {
  const request = transaction.objectStore(OUTBOX_STORE).getAll();
  request.addEventListener("success", () => {
    const remaining = (request.result as SequencedMutation[]).filter(
      (entry) => !settledSeqs.has(entry.seq),
    );
    const deletedParents = pendingParentDeletes(remaining);
    // A local cascade may have removed children that this in-flight page still contains. Retry
    // after pushing the parent deletion; aborting also preserves every cursor in this page.
    if (pulling && deletedParents.size > 0) {
      transaction.abort();
      return;
    }
    const protectedRowKeys = new Set(remaining.map((entry) => `${entry.table}:${entry.rowId}`));
    putRows(transaction, filterPendingCascades(rows, deletedParents), protectedRowKeys);
  });
  request.addEventListener("error", () => transaction.abort());
}

type PulledPage = {
  rows: SyncedRows;
  cursors: SyncCursors;
  pending: SyncedTable[];
  colors: Color[];
  usdRates: Record<string, number> | null;
};

/** A complete remote working set staged in memory before replacing an existing replica. */
export type FullReplicaSnapshot = {
  rows: SyncedRows;
  cursors: SyncCursors;
  colors: Color[];
  usdRates: Record<string, number> | null;
  localRevision: number;
};

export function writeLocalPage(expected: ReplicaContext, page: PulledPage): Promise<void> {
  return guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, (transaction) => {
    putServerRows(transaction, page.rows, new Set(), true);
    const meta = transaction.objectStore(META_STORE);
    meta.put(page.cursors, CURSORS_KEY);
    meta.put(page.colors, COLORS_KEY);
    if (page.usdRates) meta.put(page.usdRates, USD_RATES_KEY);
    meta.put(
      SYNCED_TABLES.filter((table) => !page.pending.includes(table)),
      COMPLETE_TABLES_KEY,
    );
    if (page.pending.length === 0) meta.put(Date.now(), LAST_SYNCED_AT_KEY);
  });
}

/** Persists rows, queue entries, and the next local revision under one identity fence. */
export function writeLocalMutations(
  expected: ReplicaContext,
  rows: Partial<SyncedRows>,
  mutations: Mutation[],
): Promise<void> {
  return guardedTransaction(
    [...SYNCED_TABLES, OUTBOX_STORE],
    expected,
    (transaction, _descriptor, fail) => {
      // Read and validate inside the same read/write transaction so another tab cannot use or
      // archive a sphere between its lifecycle check and persistence.
      const profiles = transaction.objectStore("profiles").getAll();
      const spheres = transaction.objectStore("spheres").getAll();
      const allocations = transaction.objectStore("allocations").getAll();
      const meta = transaction.objectStore(META_STORE);
      const complete = meta.get(COMPLETE_TABLES_KEY);
      const revision = meta.get(LOCAL_REVISION_KEY);
      const requests = [profiles, spheres, allocations, complete, revision];
      let remaining = requests.length;
      for (const request of requests) {
        request.addEventListener("error", () => fail(request.error));
        request.addEventListener("success", () => {
          if (--remaining !== 0) return;
          try {
            validateSphereMutations(
              mutations,
              {
                profiles: [...(rows.profiles ?? []), ...profiles.result],
                spheres: spheres.result,
                allocations: allocations.result,
              },
              expected.ownerUserId,
              ["spheres", "allocations"].every((table) => complete.result?.includes(table)),
            );
            const reallocationMutations = mutations.filter(
              (mutation) => mutation.table === "allocations",
            );
            if (reallocationMutations.length > 0) {
              if (!["spheres", "allocations"].every((table) => complete.result?.includes(table)))
                throw new Error("Finish loading sphere balances before reallocating money.");
              for (const mutation of reallocationMutations) {
                const current = allocations.result.find(
                  (row: SyncedRows["allocations"][number]) => row.id === mutation.rowId,
                );
                const profileId =
                  mutation.op === "upsert" ? mutation.payload.profileId : current?.profileId;
                const profile = profiles.result.find(
                  (row: SyncedRows["profiles"][number]) =>
                    row.id === profileId && row.deletedAt == null,
                );
                if (!profile || (profile.userId != null && profile.userId !== expected.ownerUserId))
                  throw new Error(
                    "The reallocation profile does not belong to this local replica.",
                  );
              }
              if (
                validateReallocationMutations(
                  reallocationMutations,
                  allocations.result,
                  spheres.result,
                ).size > 0
              )
                throw new Error(
                  "This reallocation or one of its spheres is deleted or archived. Restore archived spheres before changing their history.",
                );
              for (const mutation of reallocationMutations) {
                const row = rows.allocations?.find((row) => row.id === mutation.rowId);
                if (
                  !row ||
                  (mutation.op === "delete"
                    ? row.deletedAt == null
                    : row.deletedAt != null ||
                      Object.entries(mutation.payload).some(([key, value]) => {
                        const actual = row[key as keyof typeof row];
                        return value instanceof Date
                          ? !(actual instanceof Date) || value.getTime() !== actual.getTime()
                          : actual !== value;
                      }))
                )
                  throw new Error("The local reallocation must match its queued intent.");
              }
            }
            const currentSpheres = new Map<string, SyncedRows["spheres"][number]>(
              spheres.result.map((row) => [row.id, row]),
            );
            const previousAllocations = new Map<string, SyncedRows["allocations"][number]>(
              allocations.result.map((row) => [row.id, row]),
            );
            const sourceRowKeys = new Set([
              ...(rows.accounts ?? []).map((row) => `accounts:${row.id}`),
              ...(rows.transactions ?? []).map((row) => `transactions:${row.id}`),
            ]);
            const changedSphereIds = new Set(rows.spheres?.map((row) => row.id));
            const sphereMutations = new Map(
              mutations
                .filter((mutation) => mutation.table === "spheres")
                .map((mutation) => [mutation.rowId, mutation]),
            );
            for (const row of rows.spheres ?? []) {
              const mutation = sphereMutations.get(row.id);
              if (mutation?.op === "upsert") {
                if (
                  row.name !== mutation.payload.name ||
                  row.type !== mutation.payload.type ||
                  row.profileId !== mutation.payload.profileId ||
                  row.archived !== mutation.payload.archived ||
                  row.deletedAt != null
                )
                  throw new Error("The local sphere must match its queued intent.");
              } else if (mutation?.op === "delete") {
                if (row.deletedAt == null) throw new Error("A deleted sphere must be tombstoned.");
              } else {
                const profile = rows.profiles?.find((profile) => profile.id === row.profileId);
                const current = currentSpheres.get(row.id);
                const isOperating =
                  row.id === row.profileId &&
                  row.type === "OPERATING" &&
                  row.name === "Operating" &&
                  !row.archived;
                const isCascade =
                  current &&
                  profile?.deletedAt != null &&
                  row.deletedAt != null &&
                  current.profileId === row.profileId &&
                  current.type === row.type &&
                  current.name === row.name &&
                  current.archived === row.archived;
                if (!profile || (!isOperating && !isCascade))
                  throw new Error(
                    "Sphere changes require a sphere mutation or their profile companion.",
                  );
              }
            }
            for (const row of rows.spheres ?? [])
              currentSpheres.set(row.id, {
                ...row,
                hasHistory: currentSpheres.get(row.id)?.hasHistory || row.hasHistory,
              });
            for (const row of rows.allocations ?? []) {
              const previous = previousAllocations.get(row.id);
              if (
                (row.reallocationId || previous?.reallocationId) &&
                !reallocationMutations.some((mutation) => mutation.rowId === row.id) &&
                !rows.profiles?.some(
                  (profile) =>
                    profile.id === row.profileId &&
                    profile.deletedAt != null &&
                    row.deletedAt != null,
                )
              )
                throw new Error("Reallocation changes require both queued sides.");
              // Editing a transaction/opening amount changes its companion's money, not its purpose.
              // A different tab may have newer attribution than this tab's in-memory source snapshot.
              if (
                previous &&
                sourceRowKeys.has(
                  row.transactionId != null
                    ? `transactions:${row.transactionId}`
                    : `accounts:${row.openingAccountId}`,
                )
              ) {
                row.sphereId = previous.sphereId;
              }
              const sphere = currentSpheres.get(row.sphereId);
              if (!sphere || sphere.profileId !== row.profileId)
                throw new Error("An allocation requires a sphere in its profile.");
              const parentDeleted = rows.profiles?.some(
                (profile) => profile.id === row.profileId && profile.deletedAt != null,
              );
              if (parentDeleted && row.deletedAt == null)
                throw new Error("A deleted profile cannot receive allocations.");
              const sourceSphere = previous ? currentSpheres.get(previous.sphereId) : undefined;
              if (
                !parentDeleted &&
                previous?.deletedAt == null &&
                previous?.sphereId !== row.sphereId &&
                sourceSphere?.archived
              )
                throw new Error("Archived sphere history cannot change.");
              if (
                !parentDeleted &&
                (sphere.deletedAt != null || sphere.archived) &&
                (!previous ||
                  previous.amount !== row.amount ||
                  previous.currencyCode !== row.currencyCode ||
                  previous.sphereId !== row.sphereId ||
                  previous.deletedAt?.getTime() !== row.deletedAt?.getTime())
              )
                throw new Error("An archived sphere cannot receive allocations.");
              // Operating's history is implicit in its permanent system identity.
              if (sphere.type !== "OPERATING" && !sphere.hasHistory) {
                sphere.hasHistory = true;
                currentSpheres.set(sphere.id, sphere);
                changedSphereIds.add(sphere.id);
              }
            }
            rows.spheres = [...currentSpheres.values()].filter((sphere) =>
              changedSphereIds.has(sphere.id),
            );
            putRows(transaction, rows);
            const outbox = transaction.objectStore(OUTBOX_STORE);
            for (const mutation of mutations) outbox.add(mutation);
            meta.put(((revision.result as number | undefined) ?? 0) + 1, LOCAL_REVISION_KEY);
          } catch (error) {
            fail(error);
          }
        });
      }
    },
  );
}

export function dropOutboxEntries(
  expected: ReplicaContext,
  seqs: readonly number[],
): Promise<void> {
  return guardedTransaction([OUTBOX_STORE], expected, (transaction) => {
    const outbox = transaction.objectStore(OUTBOX_STORE);
    for (const seq of seqs) outbox.delete(seq);
  });
}

/** Settles only the original seq/mutation-id pairs under the context that sent them. */
export async function settleAcceptedPush(
  expected: ReplicaContext,
  seqs: readonly number[],
  acceptedMutationIds: readonly string[],
  rows: Partial<SyncedRows>,
  colors: Color[],
): Promise<void> {
  // A source may only leave the queue with its materialized canonical allocation. This covers
  // legacy single-row intents as well as grouped transfers, including lost-response replays.
  const required = await Promise.all([
    ...(rows.transactions ?? []).map(async (row) => ({
      row,
      id: await allocationId("transaction", row.id),
    })),
    ...(rows.accounts ?? [])
      .filter((row) => row.profileId != null)
      .map(async (row) => ({ row, id: await allocationId("opening", row.id) })),
  ]);
  const canonicalAllocations = new Set(rows.allocations?.map((row) => row.id));
  if (required.some(({ id }) => !canonicalAllocations.has(id))) {
    throw new Error("The canonical allocation is missing. Pending work was retained.");
  }
  if ((rows.profiles ?? []).some((row) => !rows.spheres?.some((sphere) => sphere.id === row.id))) {
    throw new Error("The canonical Operating sphere is missing. Pending work was retained.");
  }
  return guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, (transaction) => {
    const accepted = new Set(acceptedMutationIds);
    const outbox = transaction.objectStore(OUTBOX_STORE);
    const membersRequest = outbox.getAll();
    membersRequest.addEventListener("success", () => {
      try {
        const selected = (membersRequest.result as SequencedMutation[]).filter((entry) =>
          seqs.includes(entry.seq),
        );
        if (selected.length !== seqs.length)
          throw new Error("The accepted outbox entries changed.");
        assertCompleteOperations(selected);
        assertCompleteAcceptance(selected, accepted);
        const canonicalKeys = new Set(
          Object.entries(rows).flatMap(([table, canonical]) =>
            canonical.map((row) => `${table}:${row.id}`),
          ),
        );
        const checked = new Set<string>();
        for (const entry of selected) {
          if (!entry.operation || checked.has(entry.operation.id)) continue;
          checked.add(entry.operation.id);
          const members = selected.filter((member) => member.operation?.id === entry.operation?.id);
          const canonicalCount = members.filter((member) =>
            canonicalKeys.has(`${member.table}:${member.rowId}`),
          ).length;
          // An aged-out delete may have no remaining tombstones. An upsert or a partial pair
          // must keep its complete pending intent until all canonical members can settle.
          if (
            canonicalCount !== members.length &&
            (canonicalCount > 0 || members.some((member) => member.op === "upsert"))
          )
            throw new Error("The canonical financial operation is incomplete.");
        }
      } catch {
        transaction.abort();
      }
    });
    membersRequest.addEventListener("error", () => transaction.abort());
    for (const seq of seqs) {
      const request = outbox.get(seq);
      request.addEventListener("success", () => {
        const entry = request.result as SequencedMutation | undefined;
        if (!entry || !accepted.has(entry.mutationId)) {
          transaction.abort();
          return;
        }
        outbox.delete(seq);
      });
      request.addEventListener("error", () => transaction.abort());
    }
    putServerRows(transaction, rows, new Set(seqs));
    transaction.objectStore(META_STORE).put(colors, COLORS_KEY);
  });
}

/**
 * Atomically replaces replicated data after a complete staged download. Local obligations and
 * identity metadata stay untouched; any local write that arrived during the download aborts the swap.
 */
export function replaceFullLocalSnapshot(
  expected: ReplicaContext,
  snapshot: FullReplicaSnapshot,
): Promise<void> {
  return openDatabase().then(
    (database) =>
      new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(
          [...SYNCED_TABLES, META_STORE, OUTBOX_STORE],
          "readwrite",
        );
        let failure: unknown;
        const meta = transaction.objectStore(META_STORE);
        const descriptorRequest = meta.get(DESCRIPTOR_KEY);
        const revisionRequest = meta.get(LOCAL_REVISION_KEY);
        const outboxRequest = transaction.objectStore(OUTBOX_STORE).count();
        let descriptor: ReplicaDescriptor | undefined;
        let revision = 0;
        let outboxCount = 0;
        let descriptorReady = false;
        let revisionReady = false;
        let outboxReady = false;
        let replaced = false;

        const replace = () => {
          if (!descriptorReady || !revisionReady || !outboxReady || replaced) return;
          replaced = true;
          try {
            assertExpectedContext(descriptor, expected);
            if (revision !== snapshot.localRevision || outboxCount !== 0) {
              throw new Error("Local changes arrived while the full refresh was downloading.");
            }
            for (const table of SYNCED_TABLES) {
              const store = transaction.objectStore(table);
              store.clear();
              for (const row of snapshot.rows[table]) store.put(row);
            }
            meta.put(snapshot.cursors, CURSORS_KEY);
            meta.put(snapshot.colors, COLORS_KEY);
            if (snapshot.usdRates) meta.put(snapshot.usdRates, USD_RATES_KEY);
            meta.put([...SYNCED_TABLES], COMPLETE_TABLES_KEY);
            meta.put(Date.now(), LAST_SYNCED_AT_KEY);
            const selectedProfileRequest = meta.get(SELECTED_PROFILE_KEY);
            selectedProfileRequest.addEventListener("success", () => {
              const selectedProfileId = selectedProfileRequest.result;
              const isLive = snapshot.rows.profiles.some(
                (profile) => profile.id === selectedProfileId && profile.deletedAt == null,
              );
              if (!isLive) meta.delete(SELECTED_PROFILE_KEY);
            });
            selectedProfileRequest.addEventListener("error", () => transaction.abort());
          } catch (error) {
            failure = error;
            transaction.abort();
          }
        };

        descriptorRequest.addEventListener("success", () => {
          descriptor = descriptorRequest.result as ReplicaDescriptor | undefined;
          descriptorReady = true;
          replace();
        });
        revisionRequest.addEventListener("success", () => {
          revision = (revisionRequest.result as number | undefined) ?? 0;
          revisionReady = true;
          replace();
        });
        outboxRequest.addEventListener("success", () => {
          outboxCount = outboxRequest.result;
          outboxReady = true;
          replace();
        });
        for (const request of [descriptorRequest, revisionRequest, outboxRequest]) {
          request.addEventListener("error", () => {
            failure = request.error;
            transaction.abort();
          });
        }
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(failure ?? transaction.error));
        transaction.addEventListener("abort", () => reject(failure ?? transaction.error));
      }),
  );
}

export function selectLocalProfile(
  expected: ReplicaContext,
  selectedProfileId: string | null,
): Promise<void> {
  return guardedTransaction(["profiles"], expected, (transaction) => {
    const meta = transaction.objectStore(META_STORE);
    if (selectedProfileId == null) {
      meta.delete(SELECTED_PROFILE_KEY);
      return;
    }
    const request = transaction.objectStore("profiles").get(selectedProfileId);
    request.addEventListener("success", () => {
      const profile = request.result as SyncedRows["profiles"][number] | undefined;
      if (!profile || profile.deletedAt != null) transaction.abort();
      else meta.put(selectedProfileId, SELECTED_PROFILE_KEY);
    });
    request.addEventListener("error", () => transaction.abort());
  });
}

/** Durably pauses automatic sync without affecting the locally readable replica. */
export function setReplicaSyncAuth(
  expected: ReplicaContext,
  syncAuth: "unknown" | "authenticated" | "login-required" | "owner-mismatch",
): Promise<void> {
  return guardedTransaction([], expected, (transaction, descriptor) => {
    transaction.objectStore(META_STORE).put({ ...descriptor, syncAuth }, DESCRIPTOR_KEY);
  });
}

/** Clears one replica and installs a fresh unbound incarnation in the same transaction. */
export function replaceLocalReplica(
  expected: ReplicaContext,
  transitionId?: string,
): Promise<ReplicaContext> {
  const descriptor = createDescriptor({ kind: "unbound" });
  const replace = (transaction: IDBTransaction) => {
    for (const table of SYNCED_TABLES) transaction.objectStore(table).clear();
    transaction.objectStore(OUTBOX_STORE).clear();
    const meta = transaction.objectStore(META_STORE);
    meta.clear();
    meta.put(descriptor, DESCRIPTOR_KEY);
    meta.put(0, LOCAL_REVISION_KEY);
    meta.put([], COMPLETE_TABLES_KEY);
  };

  const operation = transitionId
    ? transitionedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, transitionId, replace)
    : guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, replace, {
        allowRecovery: true,
      });
  return operation.then(() => effectiveContext(descriptor));
}

export type LocalRecoveryExport = {
  formatVersion: 1;
  database: { name: string; version: number };
  exportedAt: string;
  descriptor: ReplicaDescriptor;
  metadata: Omit<LocalSnapshot, "descriptor" | "rows" | "outbox">;
  rows: SyncedRows;
  outbox: SequencedMutation[];
};

/** Returns local financial data for an explicit device-only recovery download. */
export async function createLocalRecoveryExport(): Promise<LocalRecoveryExport> {
  const snapshot = await readLocalSnapshot();
  const { descriptor, rows, outbox: outboxState, ...metadata } = snapshot;
  return {
    formatVersion: 1,
    database: { name: INDEXED_DB_NAME, version: INDEXED_DB_VERSION },
    exportedAt: new Date().toISOString(),
    descriptor,
    metadata,
    rows,
    outbox: outboxState.entries,
  };
}
