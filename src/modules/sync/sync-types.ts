import type {
  accountsTable,
  categoriesTable,
  colorsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";

/**
 * The shape of the replicated data, shared by the server function that sends it, the IndexedDB
 * stores that persist it and the Zustand store that serves every read from memory.
 *
 * Derived from the Drizzle tables so a schema change shows up here as a type error rather than as a
 * column the client silently stops carrying. Type-only, so importing `~/database/tables` from here
 * costs the client bundle nothing.
 */

export type SyncedProfile = typeof profilesTable.$inferSelect;

/**
 * `balance` is deliberately absent: it is a denormalized cache two offline devices would fight
 * over, so it never rides along in a pull. Clients derive it from `initialBalance` plus the
 * transactions they already hold (see `compute-balances.ts`).
 */
export type SyncedAccount = Omit<typeof accountsTable.$inferSelect, "balance">;

export type SyncedCategory = typeof categoriesTable.$inferSelect;

export type SyncedTransaction = typeof transactionsTable.$inferSelect;

/** The fixed palette a category can be tinted with — global, tiny, and pulled in full. */
export type Color = typeof colorsTable.$inferSelect;

export const SYNCED_TABLES = ["profiles", "accounts", "categories", "transactions"] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

export type SyncedRows = {
  profiles: SyncedProfile[];
  accounts: SyncedAccount[];
  categories: SyncedCategory[];
  transactions: SyncedTransaction[];
};

/**
 * Where a table's replication got to, as a keyset position rather than a plain timestamp: the
 * Phase 1 migration gave every pre-existing row an identical `updated_at`, so a scalar cursor would
 * either loop on that block forever or skip past it.
 *
 * A `null` id means "everything from this instant onwards, inclusive" — what the server hands back
 * once a table is fully caught up, rewound by the overlap window so a row that commits out of
 * timestamp order is still picked up. A string id is the strict "after this exact row" position
 * used while paging through a backlog, where re-reading would stall the loop.
 *
 * `updatedAt` is an opaque timestamp literal, deliberately not a `Date`: postgres keeps microseconds
 * and a `Date` only milliseconds, and a strict cursor rounded down never gets past the rows it
 * already sent. Only `pullChanges` should read it — everything else just carries it back.
 */
export type SyncCursor = {
  updatedAt: string;
  id: string | null;
};

export type SyncCursors = Partial<Record<SyncedTable, SyncCursor>>;

export type PullChangesResult = {
  rows: SyncedRows;
  nextCursors: SyncCursors;
  /**
   * The tables that filled their page and still have a backlog behind them. Empty means caught up.
   *
   * Per table rather than one flag because the client renders as soon as the *reference* tables are
   * complete and lets transactions keep arriving (see `REFERENCE_TABLES`) — it has to know which of
   * them is the one still streaming.
   */
  pending: SyncedTable[];
  /**
   * How many transaction rows this run has left to deliver in total, counted when the run starts —
   * the denominator behind the "syncing 35%" indicator. Only sent when asked for (`withCounts`), so
   * the extra `count(*)` is paid once per run rather than once per page.
   *
   * Transactions only: it is the one table big enough to page, and it dwarfs the other three, so it
   * is what "how much is synced" means in practice.
   */
  transactionBacklog?: number;
  /** Units of each currency per 1 USD, or `null` when the upstream rate service is unreachable. */
  usdRates: Record<string, number> | null;
  colors: Color[];
};

/** Anything replicated: keyed by uuid, ordered by `updatedAt`, deletable by tombstone. */
export type SyncedRow = {
  id: string;
  updatedAt: Date;
  deletedAt: Date | null;
};
