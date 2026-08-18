import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  accountsTable,
  categoriesTable,
  colorsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";
import {
  assertAccountsInProfile,
  assertCategoriesInProfile,
  assertProfilesOwnedBy,
} from "./ownership.server";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "~/database/get-db.server";
import type { Mutation, MutationFor, PushConflict, SyncedTable } from "~/modules/sync/sync-types";

/**
 * Applying a pushed batch of mutations, inside one database transaction.
 *
 * Three things hold this together:
 *
 * - **Order is preserved.** The batch is applied in outbox order, so "create the account, then the
 *   transaction filed against it" works and a rejected parent takes its dependents down with it —
 *   the whole call is one transaction, so a 403 anywhere rolls the lot back.
 * - **Every row is re-authorized.** Offline-first does not relax authorization: each row names the
 *   profile it belongs to and that profile is proven to be the caller's, inside the transaction so
 *   a profile the same batch just created counts. The `on conflict` clauses are guarded too, so a
 *   client that guesses an existing uuid cannot write over a row outside its own profile.
 * - **The server stamps `updated_at`.** A client clock never decides sync order. `now()` is the
 *   transaction's own timestamp, so every row a batch writes sorts together for the next pull.
 *
 * Only safe to call from inside a server function's `.handler(...)`.
 */

/** The value the `insert` proposed for this column, for use in its `on conflict` update. */
function excluded(column: PgColumn): SQL {
  return sql`excluded.${sql.identifier(column.name)}`;
}

/** The moment the whole batch happened, as far as every client's cursor is concerned. */
const now = (): SQL => sql`now()`;

/**
 * A run of consecutive mutations sharing a table and an operation — one statement's worth.
 *
 * Keyed by table so a check on `run.table` narrows `run.mutations` to that table's payload shape.
 */
type Run = {
  [Table in SyncedTable]:
    | { table: Table; op: "upsert"; mutations: Extract<MutationFor<Table>, { op: "upsert" }>[] }
    | { table: Table; op: "delete"; mutations: Extract<MutationFor<Table>, { op: "delete" }>[] };
}[SyncedTable];

/**
 * Groups the batch into runs without reordering it.
 *
 * Consecutive rows of the same kind become one multi-row statement — which is what makes a CSV
 * import of a few thousand transactions a handful of round trips — while a change of table or
 * operation closes the run, so the dependency order the client wrote them in survives.
 */
function toRuns(mutations: Mutation[]): Run[] {
  const runs: Run[] = [];

  for (const mutation of mutations) {
    const current = runs.at(-1);
    if (current && current.table === mutation.table && current.op === mutation.op) {
      // Safe by the check above: the run and the mutation agree on both discriminants, which is
      // exactly what the mapped type keys `mutations` on. Only inference cannot follow it.
      (current.mutations as Mutation[]).push(mutation);
    } else {
      runs.push({ table: mutation.table, op: mutation.op, mutations: [mutation] } as Run);
    }
  }

  return runs;
}

const syncedTables = {
  profiles: profilesTable,
  accounts: accountsTable,
  categories: categoriesTable,
  transactions: transactionsTable,
};

/** The ids this batch touched, per table — what the caller reads canonical rows back for. */
export type TouchedIds = Record<SyncedTable, Set<string>>;

/**
 * The caller's profiles, re-read per run rather than once.
 *
 * A batch can create a profile and then write into it, so "which profiles are mine" is a question
 * whose answer changes as the batch is applied. It is one indexed read of a table holding a handful
 * of rows.
 */
async function ownProfileIds(db: Executor, userId: number): Promise<string[]> {
  const rows = await db
    .select({ id: profilesTable.id })
    .from(profilesTable)
    .where(eq(profilesTable.userId, userId));

  return rows.map((row) => row.id);
}

/**
 * Reports rows this run is about to write over that have moved on since the client last saw them.
 *
 * Detection only — the write goes ahead regardless, because resolution is last-write-wins on the
 * server clock. Scoped to rows the caller can see, so a uuid guessed at random tells them nothing
 * about whether it exists.
 */
async function findConflicts(
  db: Executor,
  run: Run,
  scope: SQL | undefined,
): Promise<PushConflict[]> {
  const table = syncedTables[run.table];
  const ids = run.mutations.map((mutation) => mutation.rowId);

  const existing = await db
    .select({ id: table.id, updatedAt: table.updatedAt })
    .from(table)
    .where(and(inArray(table.id, ids), scope));

  // Milliseconds, matching what the client had to send: it holds the driver-parsed `Date`, so the
  // stored microseconds are precision neither side can compare on. See `Mutation.baseUpdatedAt`.
  const updatedAtById = new Map(existing.map((row) => [row.id, row.updatedAt.getTime()]));

  return run.mutations.flatMap((mutation) => {
    const serverUpdatedAt = updatedAtById.get(mutation.rowId);
    if (serverUpdatedAt == null || serverUpdatedAt === mutation.baseUpdatedAt) return [];

    return [
      { mutationId: mutation.mutationId, table: run.table, rowId: mutation.rowId, serverUpdatedAt },
    ];
  });
}

/**
 * Tombstones the rows the given scope selects.
 *
 * A tombstone rather than a `DELETE` because a delta pull can only see rows that still exist: a row
 * that vanishes outright stays on every client that already holds it, forever. `updatedAt` moves
 * with `deletedAt` so the deletion is what the next pull finds. Already-tombstoned rows are left
 * alone, so replaying a delete does not keep bumping a row every client has long since dropped.
 */
async function tombstone(
  db: Executor,
  table: (typeof syncedTables)[SyncedTable],
  where: SQL | undefined,
): Promise<void> {
  await db
    .update(table)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(where, isNull(table.deletedAt)));
}

/**
 * Resolves the hexes a batch's categories carried into `colors` rows, minting the ones the palette
 * does not have yet.
 *
 * The client cannot mint a color id — `colors` is keyed by a serial and shared by every user — so
 * the CSV import sends the hex it generated and this turns it into an id. `hex` is unique, which is
 * what makes it idempotent: two devices importing the same category converge on one palette entry.
 */
async function resolveColorIds(db: Executor, hexes: string[]): Promise<Map<string, number>> {
  if (hexes.length === 0) return new Map();

  await db
    .insert(colorsTable)
    .values(hexes.map((hex) => ({ hex })))
    .onConflictDoNothing();

  const rows = await db.select().from(colorsTable).where(inArray(colorsTable.hex, hexes));

  return new Map(rows.map((row) => [row.hex, row.id]));
}

/**
 * Sum of an account's live transactions, as a correlated subquery usable in an `accounts` update.
 * Tombstoned rows are excluded: a soft-deleted transaction has stopped affecting any balance.
 */
const transactionsSum = sql`coalesce((
  select sum(${transactionsTable.amount})
  from ${transactionsTable}
  where ${transactionsTable.accountId} = ${accountsTable.id}
    and ${transactionsTable.deletedAt} is null
), 0)`;

/**
 * Restates `accounts.balance` for every live account in the profiles a batch wrote into.
 *
 * The column is a server-side cache — it never rides along in a pull, and every balance on screen is
 * derived from the transactions the client holds (see `compute-balances.ts`). Recomputing it rather
 * than nudging it by a delta is what makes a pushed write idempotent: replaying the same outbox
 * entry after a failed push lands on the same number instead of double-counting. It is also why
 * there is no "reconcile balances" button any more — a push cannot leave the column drifted.
 *
 * Whole profiles rather than the accounts the batch named: a transaction that moved between
 * accounts, or one deleted along with its account, changes a balance whose account is not itself in
 * the batch. A profile holds a handful of accounts, so the wider statement costs nothing and cannot
 * miss one. `updatedAt` is left alone on purpose — a derived value changing is not a change any
 * client needs to hear about.
 */
async function recomputeBalances(db: Executor, profileIds: string[]): Promise<void> {
  if (profileIds.length === 0) return;

  await db
    .update(accountsTable)
    .set({ balance: sql`${accountsTable.initialBalance} + ${transactionsSum}` })
    .where(and(inArray(accountsTable.profileId, profileIds), isNull(accountsTable.deletedAt)));
}

export type AppliedBatch = {
  conflicts: PushConflict[];
  touched: TouchedIds;
  /** Every profile the batch wrote into — whose account balances have to be restated afterwards. */
  profileIds: Set<string>;
};

/**
 * Applies a whole batch, in order, and reports what it touched.
 *
 * Runs inside the caller's transaction: every read here — the ownership assertions especially — has
 * to see the rows earlier runs of the same batch inserted, which a separate connection could not.
 */
export async function applyMutations(
  db: Executor,
  userId: number,
  mutations: Mutation[],
): Promise<AppliedBatch> {
  const conflicts: PushConflict[] = [];
  const touched: TouchedIds = {
    profiles: new Set(),
    accounts: new Set(),
    categories: new Set(),
    transactions: new Set(),
  };
  const profileIds = new Set<string>();

  for (const run of toRuns(mutations)) {
    for (const mutation of run.mutations) touched[run.table].add(mutation.rowId);
    const ids = run.mutations.map((mutation) => mutation.rowId);

    if (run.table === "profiles") {
      // A profile's own scope is its owner. Nothing is asserted up front: an insert stamps `userId`
      // from the session, and the guard below means a conflict on somebody else's uuid updates
      // nothing rather than taking their row over.
      const scope = eq(profilesTable.userId, userId);
      conflicts.push(...(await findConflicts(db, run, scope)));

      if (run.op === "delete") {
        for (const id of ids) profileIds.add(id);
        await tombstone(db, profilesTable, and(inArray(profilesTable.id, ids), scope));
        continue;
      }

      await db
        .insert(profilesTable)
        .values(
          run.mutations.map((mutation) => ({
            id: mutation.rowId,
            ...mutation.payload,
            userId,
            updatedAt: now(),
          })),
        )
        .onConflictDoUpdate({
          target: profilesTable.id,
          set: { name: excluded(profilesTable.name), updatedAt: now() },
          setWhere: and(scope, isNull(profilesTable.deletedAt)),
        });

      for (const id of ids) profileIds.add(id);
      continue;
    }

    const owned = await ownProfileIds(db, userId);
    const table = syncedTables[run.table];
    // A row outside the caller's profiles is not theirs to see, let alone write.
    const scope = inArray(table.profileId, owned);

    conflicts.push(...(await findConflicts(db, run, scope)));

    if (run.op === "delete") {
      await tombstone(db, table, and(inArray(table.id, ids), scope));
      // Which profile the deleted rows were in is not worth a `returning` clause: a user has a
      // handful of profiles between them, and restating the balances of all of them is one indexed
      // statement that cannot miss the account a deleted transaction belonged to.
      for (const id of owned) profileIds.add(id);

      // Deleting an account takes its transactions with it. Their `onDelete: "cascade"` only fires
      // for a real delete, and without this the account would disappear from clients while the rows
      // filed against it stayed behind, counting towards balances belonging to nothing. The client
      // applies the same cascade to its own copy, which is what keeps the two ends agreeing.
      if (run.table === "accounts") {
        await tombstone(
          db,
          transactionsTable,
          and(
            inArray(transactionsTable.accountId, ids),
            inArray(transactionsTable.profileId, owned),
          ),
        );
      }

      continue;
    }

    // Everything below is an upsert, so every mutation carries a payload naming the profile it
    // belongs to — the one claim the whole write path rests on.
    const targetProfileIds = run.mutations.flatMap((mutation) =>
      mutation.payload.profileId == null ? [] : [mutation.payload.profileId],
    );
    await assertProfilesOwnedBy(userId, targetProfileIds, db);
    for (const id of targetProfileIds) profileIds.add(id);

    if (run.table === "accounts") {
      await db
        .insert(accountsTable)
        .values(
          run.mutations.map((mutation) => ({
            id: mutation.rowId,
            ...mutation.payload,
            updatedAt: now(),
          })),
        )
        .onConflictDoUpdate({
          target: accountsTable.id,
          set: {
            name: excluded(accountsTable.name),
            initialBalance: excluded(accountsTable.initialBalance),
            currencyCode: excluded(accountsTable.currencyCode),
            status: excluded(accountsTable.status),
            type: excluded(accountsTable.type),
            updatedAt: now(),
          },
          // The existing row has to already be in the profile the incoming one names, so an upsert
          // can never move a record between profiles or land on a stranger's. A tombstoned row is
          // gone as far as every client is concerned, so it is not editable either — the deletion
          // wins over a concurrent edit, and the client hears about it in `conflicts`.
          setWhere: and(
            sql`${accountsTable.profileId} = excluded.profile_id`,
            isNull(accountsTable.deletedAt),
          ),
        });

      continue;
    }

    if (run.table === "categories") {
      const colorIds = await resolveColorIds(db, [
        ...new Set(run.mutations.flatMap((mutation) => mutation.payload.colorHex ?? [])),
      ]);

      await db
        .insert(categoriesTable)
        .values(
          run.mutations.map(({ rowId, payload }) => ({
            id: rowId,
            name: payload.name,
            profileId: payload.profileId,
            colorId:
              (payload.colorHex == null ? payload.colorId : colorIds.get(payload.colorHex)) ?? null,
            updatedAt: now(),
          })),
        )
        .onConflictDoUpdate({
          target: categoriesTable.id,
          set: {
            name: excluded(categoriesTable.name),
            colorId: excluded(categoriesTable.colorId),
            updatedAt: now(),
          },
          setWhere: and(
            sql`${categoriesTable.profileId} = excluded.profile_id`,
            isNull(categoriesTable.deletedAt),
          ),
        });

      continue;
    }

    // Transactions. The account and category a row is filed against are client ids too, so they get
    // the same treatment as the profile — grouped by profile, since one batch may span several.
    const byProfile = new Map<
      string,
      { accountIds: (string | null)[]; categoryIds: (string | null)[] }
    >();
    for (const { payload } of run.mutations) {
      const group = byProfile.get(payload.profileId) ?? { accountIds: [], categoryIds: [] };
      group.accountIds.push(payload.accountId);
      group.categoryIds.push(payload.categoryId);
      byProfile.set(payload.profileId, group);
    }
    await Promise.all(
      [...byProfile].flatMap(([profileId, group]) => [
        assertAccountsInProfile(profileId, group.accountIds, db),
        assertCategoriesInProfile(profileId, group.categoryIds, db),
      ]),
    );

    await db
      .insert(transactionsTable)
      .values(
        // Spelled out rather than spread, mirroring the `set` below: these are the columns a push
        // writes, and the two lists have to agree or an insert and an update of the same row would
        // not produce the same row.
        run.mutations.map(({ rowId, payload }) => ({
          id: rowId,
          type: payload.type,
          necessityLevel: payload.necessityLevel,
          amount: payload.amount,
          comment: payload.comment,
          createdAt: payload.createdAt,
          accountId: payload.accountId,
          categoryId: payload.categoryId,
          profileId: payload.profileId,
          updatedAt: now(),
        })),
      )
      .onConflictDoUpdate({
        target: transactionsTable.id,
        set: {
          type: excluded(transactionsTable.type),
          necessityLevel: excluded(transactionsTable.necessityLevel),
          amount: excluded(transactionsTable.amount),
          comment: excluded(transactionsTable.comment),
          createdAt: excluded(transactionsTable.createdAt),
          accountId: excluded(transactionsTable.accountId),
          categoryId: excluded(transactionsTable.categoryId),
          updatedAt: now(),
        },
        setWhere: and(
          sql`${transactionsTable.profileId} = excluded.profile_id`,
          isNull(transactionsTable.deletedAt),
        ),
      });
  }

  await recomputeBalances(db, [...profileIds]);

  return { conflicts, touched, profileIds };
}
