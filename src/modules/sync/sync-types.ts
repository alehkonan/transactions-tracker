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

/**
 * One table's fingerprint, as either end can compute it without sending a single row.
 *
 * `count` alone would miss an edit; the checksum alone would miss a duplicated row. Together they
 * are enough to answer "does this device still hold what the server holds", which is the only
 * question an integrity check is asking.
 *
 * The checksum is a decimal string rather than a number: it is a signed 64-bit value, which is
 * exactly what neither JSON nor a JS `number` can carry intact.
 */
export type TableIntegrity = {
  count: number;
  checksum: string;
};

export type IntegrityResult = Record<SyncedTable, TableIntegrity>;

/**
 * When a local copy is too far behind to trust, and has to be thrown away and pulled afresh.
 *
 * Deletions are only visible to a delta pull for as long as their tombstone exists, and the sweep
 * (`netlify/functions/tombstone-gc.ts`) keeps one for 90 days. This is deliberately well inside
 * that, because the two are not measured by the same clock: the cursor is rewound by the pull's
 * overlap window, the sweep runs on its own schedule, and a client that cut it fine would silently
 * keep rows the server has deleted, forever. A month of slack costs a full re-pull that a device
 * dormant for two months was going to pay for anyway.
 */
export const STALE_CURSOR_AFTER_DAYS = 60;

/**
 * The write path.
 *
 * A mutation is a whole row, not a diff: the client already holds the row it is changing, and
 * sending all of it makes applying one idempotent — the same entry replayed after a failed push
 * lands on exactly the same state. That, plus `accounts.balance` being recomputed rather than
 * incremented, is why the outbox needs no dedup table.
 */

/**
 * The columns a client owns. `id` travels beside the payload as `rowId`, and `updatedAt`/`deletedAt`
 * are the server's to stamp — a client clock is not something the sync order may depend on.
 */
type ClientColumns<T> = Omit<T, "id" | "updatedAt" | "deletedAt">;

/** `userId` is absent: the server stamps the owner from the session, never from the payload. */
export type ProfilePayload = Omit<ClientColumns<SyncedProfile>, "userId">;

/**
 * `profileId` is narrowed to non-null throughout the write path. The column is nullable only to
 * carry rows that predate profiles having owners; nothing a client creates today may be orphaned,
 * and it is the claim every ownership check is made against.
 */
type Owned<T> = Omit<T, "profileId"> & { profileId: string };

export type AccountPayload = Owned<ClientColumns<SyncedAccount>>;

export type CategoryPayload = Owned<ClientColumns<SyncedCategory>> & {
  /**
   * A color the palette does not have yet, minted client-side by the CSV import for the categories
   * it creates. `colors` is keyed by a serial the client cannot mint, so the hex is what crosses the
   * wire and the server resolves it to a row (the column is unique, so that is idempotent too);
   * the id comes back with the canonical row and in the response's refreshed palette.
   */
  colorHex?: string;
};

export type TransactionPayload = ClientColumns<SyncedTransaction>;

export type MutationPayloads = {
  profiles: ProfilePayload;
  accounts: AccountPayload;
  categories: CategoryPayload;
  transactions: TransactionPayload;
};

type MutationBase = {
  /** Identifies the entry across a retry, and correlates it with its slot in the response. */
  mutationId: string;
  rowId: string;
  /**
   * The row's `updatedAt` as the client last saw it — epoch milliseconds — or `null` when it
   * believes it is creating.
   *
   * Milliseconds rather than the cursor's exact timestamp literal, because the client only ever
   * holds the driver-parsed `Date`, and comparing that against a postgres value kept to the
   * microsecond would report a conflict on every single edit. Truncating both sides to what the
   * client can actually represent is what makes the comparison mean something.
   *
   * Purely for detection: the server applies the write either way and reports the clobber, since
   * resolution is last-write-wins on the server clock (see `docs/offline-first-sync.md`).
   */
  baseUpdatedAt: number | null;
};

type UpsertMutation = {
  [Table in SyncedTable]: MutationBase & {
    table: Table;
    op: "upsert";
    payload: MutationPayloads[Table];
  };
}[SyncedTable];

// Spelled out per table, like the upserts above, so `Extract<Mutation, { table: "accounts" }>`
// narrows to both of that table's operations rather than losing the deletes.
type DeleteMutation = {
  [Table in SyncedTable]: MutationBase & { table: Table; op: "delete" };
}[SyncedTable];

export type Mutation = UpsertMutation | DeleteMutation;

/**
 * How many mutations one push may carry.
 *
 * The same constraint as a pull page: the deployed functions are capped at 10s, and a CSV import
 * arrives as one entry per transaction. The client drains its outbox in batches of this size until
 * it is empty; the server rejects anything larger.
 */
export const PUSH_BATCH_LIMIT = 500;

/** Every mutation addressing one table, both operations. */
export type MutationFor<Table extends SyncedTable> = Extract<Mutation, { table: Table }>;

/** A write that landed on top of a row the client had not seen the latest version of. */
export type PushConflict = {
  mutationId: string;
  table: SyncedTable;
  rowId: string;
  /** What the row's `updatedAt` was before this push overwrote it, in epoch milliseconds. */
  serverUpdatedAt: number;
};

export type PushChangesResult = {
  /** The `mutationId`s that were applied — what the client drops from its outbox. */
  applied: string[];
  /** The affected rows as the server now holds them, server-stamped `updatedAt` included. */
  canonicalRows: SyncedRows;
  conflicts: PushConflict[];
  /** The palette, refreshed: a push may have minted colors for categories that carried a hex. */
  colors: Color[];
};
