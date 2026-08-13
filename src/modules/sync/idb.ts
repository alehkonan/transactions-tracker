import { SYNCED_TABLES } from "./sync-types";
import type { Color, Mutation, SyncCursors, SyncedRow, SyncedRows } from "./sync-types";

/**
 * IndexedDB persistence for the replicated working set, and for the writes that have not reached the
 * server yet.
 *
 * Persistence only, not a query layer: the whole dataset is read into memory at boot and every
 * read, filter and statistic runs against that (see `useSyncStore`). So there are no secondary
 * indexes here — just one object store per synced table keyed by uuid, a `meta` store for the
 * cursors and the reference data that rides along with a pull, and the append-only `outbox`.
 *
 * Client-only. Nothing here runs at module scope, so importing it during SSR is inert.
 */

const DATABASE_NAME = "transactions-tracker";

/**
 * Bumping this wipes every store and forces a full re-pull, which is the intended migration
 * strategy: the local copy is a cache of the server's rows, so throwing it away is always safe and
 * always cheaper than writing an upgrade path for it.
 *
 * The outbox is the one exception to "always safe", since unpushed writes exist nowhere else. It
 * arrived with version 2 and was empty by definition until then; from here on, a bump has to drain
 * the outbox before it wipes.
 */
const DATABASE_VERSION = 2;

const META_STORE = "meta";

/** The queue of local writes waiting to be pushed, in the order they were made. */
export const OUTBOX_STORE = "outbox";

/** Everything the store needs to come up without the network. */
export type LocalSnapshot = {
  rows: SyncedRows;
  cursors: SyncCursors | undefined;
  colors: Color[];
  usdRates: Record<string, number>;
};

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

let databasePromise: Promise<IDBDatabase> | undefined;

export function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      // Recreated from scratch on every version bump, hence "bump ⇒ wipe + re-pull". Snapshotted
      // first: `objectStoreNames` is live, and deleting while walking it would skip entries.
      for (const name of Array.from(database.objectStoreNames)) database.deleteObjectStore(name);
      for (const table of SYNCED_TABLES) database.createObjectStore(table, { keyPath: "id" });
      database.createObjectStore(META_STORE);
      // Keyed by an auto-incrementing sequence, which is the whole point of the store: the order
      // writes were made in is what makes "create the account, then its transactions" pushable.
      database.createObjectStore(OUTBOX_STORE, { keyPath: "seq", autoIncrement: true });
    });

    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error));
    // Another tab is holding the old version open; it will get its own upgrade when it reloads.
    request.addEventListener("blocked", () =>
      reject(new Error("The local database is blocked by another tab.")),
    );
  });

  return databasePromise;
}

/** Reads the whole local copy in one transaction, so the store never hydrates from a torn read. */
export async function readLocalSnapshot(): Promise<LocalSnapshot> {
  const database = await openDatabase();
  const transaction = database.transaction([...SYNCED_TABLES, META_STORE], "readonly");

  const [profiles, accounts, categories, transactions, cursors, colors, usdRates] =
    await Promise.all([
      promisify(transaction.objectStore("profiles").getAll()),
      promisify(transaction.objectStore("accounts").getAll()),
      promisify(transaction.objectStore("categories").getAll()),
      promisify(transaction.objectStore("transactions").getAll()),
      promisify(transaction.objectStore(META_STORE).get("cursors")),
      promisify(transaction.objectStore(META_STORE).get("colors")),
      promisify(transaction.objectStore(META_STORE).get("usdRates")),
    ]);

  return {
    rows: { profiles, accounts, categories, transactions },
    cursors: cursors as SyncCursors | undefined,
    colors: (colors as Color[] | undefined) ?? [],
    usdRates: (usdRates as Record<string, number> | undefined) ?? {},
  };
}

/**
 * The pull position, on its own.
 *
 * Read from disk rather than from the store because this database is shared with every other tab on
 * the same browser: one of them may have pulled while this tab sat idle, and starting a pull from
 * the store's older copy would re-download everything the other one already has.
 */
export async function readLocalCursors(): Promise<SyncCursors | undefined> {
  const database = await openDatabase();
  const store = database.transaction(META_STORE, "readonly").objectStore(META_STORE);

  return (await promisify(store.get("cursors"))) as SyncCursors | undefined;
}

/**
 * Writes rows into their stores: an ordinary row is upserted by id, and a tombstone deletes its row
 * outright, since the cursor — not the tombstone — is what remembers that the deletion was seen.
 */
function putRows(transaction: IDBTransaction, rows: Partial<SyncedRows>): void {
  for (const table of SYNCED_TABLES) {
    const incoming = rows[table] as SyncedRow[] | undefined;
    if (!incoming?.length) continue;

    const store = transaction.objectStore(table);
    for (const row of incoming) {
      if (row.deletedAt) store.delete(row.id);
      else store.put(row);
    }
  }
}

type PulledPage = {
  rows: SyncedRows;
  cursors: SyncCursors;
  colors: Color[];
  usdRates: Record<string, number> | null;
};

/**
 * Applies one pulled page, atomically.
 *
 * The cursors land in the same transaction as the rows they describe, so a pull interrupted halfway
 * can never leave a cursor claiming rows the client does not actually hold.
 */
export async function writeLocalPage(page: PulledPage): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...SYNCED_TABLES, META_STORE], "readwrite");

  putRows(transaction, page.rows);

  const meta = transaction.objectStore(META_STORE);
  meta.put(page.cursors, "cursors");
  meta.put(page.colors, "colors");
  if (page.usdRates) meta.put(page.usdRates, "usdRates");

  await whenComplete(transaction);
}

/**
 * Persists a local write and its outbox entries together.
 *
 * One transaction for both halves is the point: a row saved without its entry is a change that
 * silently never reaches the server, and an entry without its row is a change the device making it
 * cannot see. Either alone is worse than neither.
 */
export async function writeLocalMutations(
  rows: Partial<SyncedRows>,
  mutations: Mutation[],
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...SYNCED_TABLES, OUTBOX_STORE], "readwrite");

  putRows(transaction, rows);

  const outbox = transaction.objectStore(OUTBOX_STORE);
  // `seq` is the store's key path and auto-increments, so it is deliberately not set here.
  for (const mutation of mutations) outbox.add(mutation);

  await whenComplete(transaction);
}

/** Applies rows the server handed back, with the palette they may have added to. */
export async function writeLocalRows(
  rows: Partial<SyncedRows>,
  colors: Color[] | undefined,
): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...SYNCED_TABLES, META_STORE], "readwrite");

  putRows(transaction, rows);
  if (colors) transaction.objectStore(META_STORE).put(colors, "colors");

  await whenComplete(transaction);
}

/**
 * Deletes the local copy outright — used when the browser changes hands (an explicit sign-out, or a
 * different account signing in), where financial data lingering in IndexedDB would be a leak.
 */
export async function deleteLocalDatabase(): Promise<void> {
  const database = await openDatabase().catch(() => undefined);
  database?.close();
  databasePromise = undefined;

  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.addEventListener("success", () => resolve());
    request.addEventListener("error", () => reject(request.error));
    // Only reachable if another tab still holds a connection; the wipe lands when it closes.
    request.addEventListener("blocked", () => resolve());
  });
}
