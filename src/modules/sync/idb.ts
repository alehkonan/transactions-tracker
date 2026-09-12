import { uuidV7 } from "~/utils/uuid-v7";
import { INDEXED_DB_NAME, INDEXED_DB_VERSION } from "./indexed-db-contract";
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

export type OutboxSnapshot = {
  count: number;
  rowKeys: Set<string>;
  entries: SequencedMutation[];
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

export class ReplicaContextChangedError extends Error {
  constructor() {
    super("The local replica changed while the operation was in progress.");
    this.name = "ReplicaContextChangedError";
  }
}

export class ReplicaRecoveryRequiredError extends Error {
  constructor() {
    super("The legacy local replica requires recovery before it can be bound or synchronized.");
    this.name = "ReplicaRecoveryRequiredError";
  }
}

export class ReplicaIdentityRequiredError extends Error {
  constructor() {
    super("The local replica must be bound to a server-confirmed identity before synchronization.");
    this.name = "ReplicaIdentityRequiredError";
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
      resolve(database);
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
  mutate: (transaction: IDBTransaction, descriptor: ReplicaDescriptor) => void,
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
      transaction
        .objectStore(META_STORE)
        .put(
          { ...descriptor, lifecycle: "transitioning", transition } satisfies ReplicaDescriptor,
          DESCRIPTOR_KEY,
        );
    },
    { allowRecovery: true },
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
    meta.put({ ...rest, lifecycle: "active" } satisfies ReplicaDescriptor, DESCRIPTOR_KEY);
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
    rows: { profiles, accounts, categories, transactions } as SyncedRows,
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
        (row) => !protectedRowKeys.has(`${table}:${row.id}`),
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
): void {
  const request = transaction.objectStore(OUTBOX_STORE).getAll();
  request.addEventListener("success", () => {
    const protectedRowKeys = new Set(
      (request.result as SequencedMutation[])
        .filter((entry) => !settledSeqs.has(entry.seq))
        .map((entry) => `${entry.table}:${entry.rowId}`),
    );
    putRows(transaction, rows, protectedRowKeys);
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

export function writeLocalPage(expected: ReplicaContext, page: PulledPage): Promise<void> {
  return guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, (transaction) => {
    putServerRows(transaction, page.rows);
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
  return guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, (transaction) => {
    putRows(transaction, rows);
    const outbox = transaction.objectStore(OUTBOX_STORE);
    for (const mutation of mutations) outbox.add(mutation);

    const meta = transaction.objectStore(META_STORE);
    const revisionRequest = meta.get(LOCAL_REVISION_KEY);
    revisionRequest.addEventListener("success", () => {
      meta.put(((revisionRequest.result as number | undefined) ?? 0) + 1, LOCAL_REVISION_KEY);
    });
    revisionRequest.addEventListener("error", () => transaction.abort());
  });
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
export function settleAcceptedPush(
  expected: ReplicaContext,
  seqs: readonly number[],
  acceptedMutationIds: readonly string[],
  rows: Partial<SyncedRows>,
  colors: Color[],
): Promise<void> {
  return guardedTransaction([...SYNCED_TABLES, OUTBOX_STORE], expected, (transaction) => {
    const accepted = new Set(acceptedMutationIds);
    const outbox = transaction.objectStore(OUTBOX_STORE);
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

export function clearLocalRows(expected: ReplicaContext): Promise<void> {
  return guardedTransaction(SYNCED_TABLES, expected, (transaction) => {
    for (const table of SYNCED_TABLES) transaction.objectStore(table).clear();
    const meta = transaction.objectStore(META_STORE);
    meta.delete(CURSORS_KEY);
    meta.delete(SELECTED_PROFILE_KEY);
    meta.put([], COMPLETE_TABLES_KEY);
    meta.delete(LAST_SYNCED_AT_KEY);
  });
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

export function bindReplicaIdentity(
  expected: ReplicaContext,
  identity: Omit<ReplicaIdentity, "replicaId">,
): Promise<void> {
  return guardedTransaction([], expected, (transaction, descriptor) => {
    if (descriptor.legacyOwnership.kind === "recovery-required") {
      throw new ReplicaRecoveryRequiredError();
    }
    if (
      (descriptor.identity != null && descriptor.identity.ownerUserId !== identity.ownerUserId) ||
      (descriptor.legacyOwnership.kind === "candidate" &&
        descriptor.legacyOwnership.ownerUserId !== identity.ownerUserId)
    ) {
      throw new ReplicaContextChangedError();
    }
    transaction.objectStore(META_STORE).put(
      {
        ...descriptor,
        identity: { ...identity, replicaId: descriptor.replicaId },
        legacyOwnership: { kind: "migrated" },
      } satisfies ReplicaDescriptor,
      DESCRIPTOR_KEY,
    );
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

/** Legacy deletion helper; blocked deletion is an error and rejected opens are retryable. */
export async function deleteLocalDatabase(): Promise<void> {
  const database = await openDatabase().catch(() => undefined);
  database?.close();
  databasePromise = undefined;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(INDEXED_DB_NAME);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
    request.addEventListener("blocked", () =>
      reject(new Error("Deleting the local database is blocked by another tab.")),
    );
  });
}
