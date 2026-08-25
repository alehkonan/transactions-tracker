import { createServerFn } from "@tanstack/react-start";
import { and, asc, count, eq, getTableColumns, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "~/database/get-db.server";
import {
  accountsTable,
  categoriesTable,
  colorsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";
import { applyMutations } from "./apply-mutations.server";
import { authMiddleware } from "./auth.middleware";
import { getUsdRates } from "./currency-rates.server";
import { loggerMiddleware } from "./logger.middleware";
import { readCanonicalRows, readColors } from "./push.server";
import { pushChangesSchema } from "./sync-schemas";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type {
  IntegrityResult,
  PullChangesResult,
  PushChangesResult,
  SyncCursor,
  SyncCursors,
  SyncedTable,
  TableIntegrity,
} from "~/modules/sync/sync-types";

/**
 * Rows per table per page. Pagination is not an optimization here: the deployed functions are
 * capped at 10s and the database is the slow part, so a first pull of a few thousand transactions
 * has to arrive across several calls. In practice only `transactions` ever fills a page.
 */
const PULL_PAGE_SIZE = 2000;

/**
 * How far a caught-up cursor is rewound before it is handed back.
 *
 * `now()` is evaluated when a statement runs, not when its transaction commits, so a row can be
 * stamped earlier than one that became visible before it and would otherwise fall behind the cursor
 * forever. Re-reading the last few seconds costs a handful of rows the client already has, and
 * applying a row twice is a no-op.
 */
const CURSOR_OVERLAP_MS = 10_000;

/** Loose shape check only — the value is a bind parameter, never interpolated into the statement. */
const timestampSchema = z
  .string()
  .max(64)
  .regex(/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:?\d{2})?)?$/);

const cursorSchema = z.object({
  updatedAt: timestampSchema,
  id: z.uuid().nullable(),
});

const pullChangesSchema = z
  .object({
    cursors: z
      .object({
        profiles: cursorSchema.optional(),
        accounts: cursorSchema.optional(),
        categories: cursorSchema.optional(),
        transactions: cursorSchema.optional(),
      })
      .optional(),
    /**
     * Ask for the transaction backlog size alongside the page. The client sets it on the first page
     * of a run only: it is what a progress percentage needs, and an extra `count(*)` per page would
     * be a real cost against a slow database for a number that does not change during the run.
     */
    withCounts: z.boolean().optional(),
  })
  .optional();

/**
 * Every account column a client is allowed to hold — that is, all of them but `balance`, which is a
 * denormalized cache two offline devices would fight over. Clients derive it from `initialBalance`
 * plus the transactions they already hold (see `compute-balances.ts`), so it cannot disagree with
 * them. Spelled out rather than `getTableColumns` minus one, so adding a column is a decision.
 */
const accountSyncColumns = {
  id: accountsTable.id,
  name: accountsTable.name,
  initialBalance: accountsTable.initialBalance,
  currencyCode: accountsTable.currencyCode,
  status: accountsTable.status,
  type: accountsTable.type,
  profileId: accountsTable.profileId,
  updatedAt: accountsTable.updatedAt,
  deletedAt: accountsTable.deletedAt,
};

/** The two columns every keyset cursor is expressed in. */
type KeysetColumns = { updatedAt: PgColumn; id: PgColumn };

/**
 * The row's `updated_at` as postgres wrote it, to the microsecond.
 *
 * A cursor cannot be built from the parsed `Date` the driver hands back: that is milliseconds, and a
 * timestamp truncated even slightly *downwards* keeps matching the rows it was supposed to advance
 * past — the page repeats forever. The text form round-trips exactly, which is also why the cursor's
 * `updatedAt` is an opaque literal to everything upstream rather than a date.
 */
const exactUpdatedAt = (column: PgColumn) => sql<string>`${column}::text`;

/**
 * "Everything after where we got to", in the two flavours a cursor comes in: strictly after one
 * exact row while paging through a backlog, and inclusive from an instant once the table is caught
 * up (`id` is `null`).
 *
 * The strict form is a row-value comparison, which postgres turns into a single range scan over the
 * `(profile_id, updated_at, id)` index rather than a filter over everything.
 */
function afterCursor(columns: KeysetColumns, cursor: SyncCursor | undefined): SQL | undefined {
  if (!cursor) return undefined;

  const at = sql`${cursor.updatedAt}::timestamptz`;
  if (cursor.id == null) return sql`${columns.updatedAt} >= ${at}`;

  return sql`(${columns.updatedAt}, ${columns.id}) > (${at}, ${cursor.id}::uuid)`;
}

type PagedRow = { id: string; updatedAt: Date; cursorAt: string };

/**
 * Where to resume this table next time.
 *
 * A full page means there is more of the backlog behind it, so the cursor is that exact last row —
 * anything looser would re-read the page it just sent and never advance, since a whole page can
 * share one `updatedAt` (the Phase 1 migration stamped every pre-existing row identically). A short
 * page means the table is caught up, so the cursor becomes an instant rewound by the overlap window,
 * where millisecond precision is harmless because the comparison is inclusive anyway.
 */
function nextCursor(rows: PagedRow[], cursor: SyncCursor | undefined): SyncCursor | undefined {
  const last = rows.at(-1);
  if (!last) return cursor;

  if (rows.length === PULL_PAGE_SIZE) return { updatedAt: last.cursorAt, id: last.id };

  return {
    updatedAt: new Date(last.updatedAt.getTime() - CURSOR_OVERLAP_MS).toISOString(),
    id: null,
  };
}

/** Drops the cursor column, which is a paging detail rather than part of the row. */
function withoutCursorColumn<T extends { cursorAt: string }>(rows: T[]): Omit<T, "cursorAt">[] {
  return rows.map(({ cursorAt: _cursorAt, ...row }) => row);
}

/**
 * The client's whole working set, delivered as a stream of pages.
 *
 * Rows are sent exactly as stored, tombstones included: a deletion is a row with `deletedAt` set,
 * and dropping it is the client's job — filtering them out here would leave deleted rows on every
 * device forever.
 *
 * Scoped by user rather than by selected profile. The profile picker needs per-profile totals for
 * all of them, and the whole dataset is small enough (10k transactions is roughly 2MB) that holding
 * it costs less than teaching the sync engine to switch working sets.
 */
export const pullChanges = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .validator(pullChangesSchema)
  // Annotated rather than inferred: the payload shape is a contract with the IndexedDB stores and
  // the Zustand store, so a column dropped from a select should fail here, not at the far end.
  .handler(async ({ data, context }): Promise<PullChangesResult> => {
    const db = getDb();
    const cursors: SyncCursors = data?.cursors ?? {};

    const ownProfiles = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(eq(profilesTable.userId, context.user.id));
    const profileIds = ownProfiles.map((profile) => profile.id);

    // Every synced row outside `profiles` carries its own `profile_id`, so ownership is one indexed
    // predicate rather than a join back through `accounts`.
    const inOwnProfiles = (column: PgColumn) => inArray(column, profileIds);

    const [profiles, accounts, categories, transactions, colors, backlog, usdRates] =
      await Promise.all([
        db
          .select({
            ...getTableColumns(profilesTable),
            cursorAt: exactUpdatedAt(profilesTable.updatedAt),
          })
          .from(profilesTable)
          .where(
            and(
              eq(profilesTable.userId, context.user.id),
              afterCursor(profilesTable, cursors.profiles),
            ),
          )
          .orderBy(asc(profilesTable.updatedAt), asc(profilesTable.id))
          .limit(PULL_PAGE_SIZE),
        db
          .select({ ...accountSyncColumns, cursorAt: exactUpdatedAt(accountsTable.updatedAt) })
          .from(accountsTable)
          .where(
            and(
              inOwnProfiles(accountsTable.profileId),
              afterCursor(accountsTable, cursors.accounts),
            ),
          )
          .orderBy(asc(accountsTable.updatedAt), asc(accountsTable.id))
          .limit(PULL_PAGE_SIZE),
        db
          .select({
            ...getTableColumns(categoriesTable),
            cursorAt: exactUpdatedAt(categoriesTable.updatedAt),
          })
          .from(categoriesTable)
          .where(
            and(
              inOwnProfiles(categoriesTable.profileId),
              afterCursor(categoriesTable, cursors.categories),
            ),
          )
          .orderBy(asc(categoriesTable.updatedAt), asc(categoriesTable.id))
          .limit(PULL_PAGE_SIZE),
        db
          .select({
            ...getTableColumns(transactionsTable),
            cursorAt: exactUpdatedAt(transactionsTable.updatedAt),
          })
          .from(transactionsTable)
          .where(
            and(
              inOwnProfiles(transactionsTable.profileId),
              afterCursor(transactionsTable, cursors.transactions),
            ),
          )
          .orderBy(asc(transactionsTable.updatedAt), asc(transactionsTable.id))
          .limit(PULL_PAGE_SIZE),
        // Global, and re-read on every pull rather than once: the CSV import mints new colors for the
        // categories it creates, so a client holding a stale palette would draw them untinted.
        db.select().from(colorsTable).orderBy(asc(colorsTable.id)),
        // Counted through the same predicate as the page above, so it measures exactly the run the
        // client is about to make: an index-only scan over `(profile_id, updated_at, id)`.
        data?.withCounts
          ? db
              .select({ count: count() })
              .from(transactionsTable)
              .where(
                and(
                  inOwnProfiles(transactionsTable.profileId),
                  afterCursor(transactionsTable, cursors.transactions),
                ),
              )
          : undefined,
        // The external fetch has to stay server-side; it rides along so statistics keep working
        // offline. A rate-service outage must not fail the whole pull — the client keeps its cache.
        getUsdRates().catch(() => null),
      ]);

    const pages = { profiles, accounts, categories, transactions };
    const nextCursors: SyncCursors = {};
    for (const table of Object.keys(pages) as SyncedTable[]) {
      const cursor = nextCursor(pages[table], cursors[table]);
      if (cursor) nextCursors[table] = cursor;
    }

    return {
      rows: {
        profiles: withoutCursorColumn(profiles),
        accounts: withoutCursorColumn(accounts),
        categories: withoutCursorColumn(categories),
        transactions: withoutCursorColumn(transactions),
      },
      nextCursors,
      // A table that filled its page has more behind it. Reported per table so the client can start
      // rendering off the small reference tables while transactions are still arriving.
      pending: (Object.keys(pages) as SyncedTable[]).filter(
        (table) => pages[table].length === PULL_PAGE_SIZE,
      ),
      transactionBacklog: backlog?.[0]?.count,
      usdRates,
      colors,
    };
  });

/**
 * A row's contribution to its table's checksum: both halves of its uuid, xor'd together and with
 * its `updated_at` in epoch milliseconds.
 *
 * Milliseconds for the same reason `baseUpdatedAt` is (see `Mutation`) — postgres keeps
 * microseconds and the client only ever holds a `Date`, so anything finer would make every single
 * row disagree. The uuid is what makes the digest more than a timestamp: the Phase 1 migration
 * stamped every pre-existing row with an identical `updated_at`, so a client that had swapped one
 * of those rows for another would otherwise pass a timestamp-only checksum. Both halves of it,
 * because a v7 uuid's leading 64 bits are 48 bits of millisecond and only 12 of randomness.
 *
 * Combined with `bit_xor` rather than a running hash because a checksum has to be order-independent
 * — the client folds the rows in whatever order its arrays happen to hold them. Kept to arithmetic
 * postgres and JavaScript can both do exactly; a server-side hash function would have no
 * counterpart in `integrity.ts`.
 */
const rowDigest = (columns: KeysetColumns) => {
  const hex = sql`translate(${columns.id}::text, '-', '')`;

  return sql`
    ('x' || substr(${hex}, 1, 16))::bit(64)::bigint
    # ('x' || substr(${hex}, 17, 16))::bit(64)::bigint
    # floor(extract(epoch from ${columns.updatedAt}) * 1000)::bigint
  `;
};

/**
 * What this user's copy of one table should look like, in two numbers.
 *
 * Tombstones are excluded: a client deletes the row rather than keeping the tombstone (see
 * `putRows`), so counting them here would report a divergence on every recent deletion.
 */
function integrityOf(columns: KeysetColumns) {
  return {
    count: count(),
    checksum: sql<string>`coalesce(bit_xor(${rowDigest(columns)}), 0)::text`,
  };
}

/**
 * A fingerprint of the caller's data, per table, for a client to compare its own copy against.
 *
 * The third data endpoint, and the only one that moves no rows in either direction: replication is
 * a long chain of assumptions — a cursor that advanced correctly, a page that was written before it
 * was applied, a pull that left a queued row alone — and this is the cheap way to find out that one
 * of them did not hold, without transferring the dataset to check.
 *
 * Answers for the whole user rather than the selected profile, because that is the scope a pull
 * replicates in.
 */
export const checkIntegrity = createServerFn()
  .middleware([loggerMiddleware, authMiddleware])
  .handler(async ({ context }): Promise<IntegrityResult> => {
    const db = getDb();

    const ownProfiles = await db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(eq(profilesTable.userId, context.user.id));
    const profileIds = ownProfiles.map((profile) => profile.id);

    const [profiles, accounts, categories, transactions] = await Promise.all([
      db
        .select(integrityOf(profilesTable))
        .from(profilesTable)
        .where(and(eq(profilesTable.userId, context.user.id), isNull(profilesTable.deletedAt))),
      db
        .select(integrityOf(accountsTable))
        .from(accountsTable)
        .where(and(inArray(accountsTable.profileId, profileIds), isNull(accountsTable.deletedAt))),
      db
        .select(integrityOf(categoriesTable))
        .from(categoriesTable)
        .where(
          and(inArray(categoriesTable.profileId, profileIds), isNull(categoriesTable.deletedAt)),
        ),
      db
        .select(integrityOf(transactionsTable))
        .from(transactionsTable)
        .where(
          and(
            inArray(transactionsTable.profileId, profileIds),
            isNull(transactionsTable.deletedAt),
          ),
        ),
    ]);

    // An aggregate always returns its one row; the fallback is here so the shape is a `TableIntegrity`
    // by construction rather than by argument.
    const empty: TableIntegrity = { count: 0, checksum: "0" };

    return {
      profiles: profiles[0] ?? empty,
      accounts: accounts[0] ?? empty,
      categories: categories[0] ?? empty,
      transactions: transactions[0] ?? empty,
    };
  });

/**
 * The client's outbox, applied.
 *
 * Atomic per batch and applied in outbox order, so a batch that creates an account and then files a
 * transaction against it works, and a row the caller turns out not to own rolls the whole batch
 * back rather than leaving half of it standing. See `apply-mutations.server.ts` for the rules each
 * row is put through — none of them are relaxed by the write having been made offline.
 *
 * Rows come back as the server stored them, so the client can replace its optimistic copies with the
 * server-stamped `updatedAt` its cursor will later be compared against. Cascaded rows are not among
 * them: a deleted account's transactions were tombstoned locally at the same time and arrive in full
 * on the next pull, which is cheaper than sending thousands of rows back through the response.
 */
export const pushChanges = createServerFn({ method: "POST" })
  .middleware([loggerMiddleware, authMiddleware])
  .validator(pushChangesSchema)
  .handler(async ({ data, context }): Promise<PushChangesResult> => {
    const db = getDb();

    const { conflicts, touched } =
      data.mutations.length === 0
        ? { conflicts: [], touched: null }
        : await db.transaction((tx) => applyMutations(tx, context.user.id, data.mutations));

    const [canonicalRows, colors] = await Promise.all([
      touched == null
        ? { profiles: [], accounts: [], categories: [], transactions: [] }
        : readCanonicalRows(db, touched),
      // A push can mint palette entries (see `resolveColorIds`), and the categories that reference
      // them are in this very response — so the palette rides along rather than waiting for a pull.
      readColors(db),
    ]);

    return {
      // Every mutation the server resolved, which is the whole batch: it is one transaction, so
      // either all of them landed or the call threw. A mutation whose guard matched nothing — an
      // edit to a row deleted elsewhere — counts as resolved too, since retrying it never would.
      applied: data.mutations.map((mutation) => mutation.mutationId),
      canonicalRows,
      conflicts,
      colors,
    };
  });
