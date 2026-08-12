import { SYNCED_TABLES } from "./sync-types";
import type { Color, SyncCursors, SyncedRow, SyncedRows } from "./sync-types";

/**
 * IndexedDB persistence for the replicated working set.
 *
 * Persistence only, not a query layer: the whole dataset is read into memory at boot and every
 * read, filter and statistic runs against that (see `useSyncStore`). So there are no secondary
 * indexes here — just one object store per synced table keyed by uuid, plus a `meta` store for the
 * cursors and the reference data that rides along with a pull.
 *
 * Client-only. Nothing here runs at module scope, so importing it during SSR is inert.
 */

const DATABASE_NAME = "transactions-tracker";

/**
 * Bumping this wipes every store and forces a full re-pull, which is the intended migration
 * strategy: the local copy is a cache of the server's rows, so throwing it away is always safe and
 * always cheaper than writing an upgrade path for it.
 */
const DATABASE_VERSION = 1;

const META_STORE = "meta";

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

function openDatabase(): Promise<IDBDatabase> {
  databasePromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.addEventListener("upgradeneeded", () => {
      const database = request.result;
      // Recreated from scratch on every version bump, hence "bump ⇒ wipe + re-pull". Snapshotted
      // first: `objectStoreNames` is live, and deleting while walking it would skip entries.
      for (const name of Array.from(database.objectStoreNames)) database.deleteObjectStore(name);
      for (const table of SYNCED_TABLES) database.createObjectStore(table, { keyPath: "id" });
      database.createObjectStore(META_STORE);
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

type PulledPage = {
  rows: SyncedRows;
  cursors: SyncCursors;
  colors: Color[];
  usdRates: Record<string, number> | null;
};

/**
 * Applies one pulled page, atomically: rows are upserted by id and tombstones delete their row
 * outright, since the cursor — not the tombstone — is what remembers that the deletion was seen.
 *
 * The cursors land in the same transaction as the rows they describe, so a pull interrupted
 * halfway can never leave a cursor claiming rows the client does not actually hold.
 */
export async function writeLocalPage(page: PulledPage): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction([...SYNCED_TABLES, META_STORE], "readwrite");

  for (const table of SYNCED_TABLES) {
    const store = transaction.objectStore(table);
    for (const row of page.rows[table] as SyncedRow[]) {
      if (row.deletedAt) store.delete(row.id);
      else store.put(row);
    }
  }

  const meta = transaction.objectStore(META_STORE);
  meta.put(page.cursors, "cursors");
  meta.put(page.colors, "colors");
  if (page.usdRates) meta.put(page.usdRates, "usdRates");

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
