import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  accountsTable,
  categoriesTable,
  colorsTable,
  mutationReceiptsTable,
  profilesTable,
  transactionsTable,
} from "~/database/tables";
import {
  createBatchAuthorization,
  type BatchAuthorizationOperation,
} from "./batch-authorization.server";
import { fingerprintMutation, MutationIntentMismatchError } from "./mutation-receipts.server";
import { readCanonicalRows, type CanonicalRowReadOperation } from "./push.server";
import { withSyncPhase } from "./sync-observability.server";
import type { SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import type { Executor } from "~/database/get-db.server";
import type {
  AcceptanceCanonicalRow,
  Mutation,
  MutationFor,
  PushConflict,
  SyncedRows,
  SyncedTable,
} from "~/modules/sync/sync-types";

export type ApplyMutationOperation =
  | CanonicalRowReadOperation
  | "receipt.claim"
  | "receipt.read"
  | `conflict.read.${SyncedTable}`
  | BatchAuthorizationOperation
  | `mutation.tombstone.${SyncedTable}`
  | `mutation.upsert.${SyncedTable}`
  | "color.insert"
  | "color.read"
  | "receipt.persist-outcomes"
  | "balance.recompute";

export type ApplyMutationOperationRunner = <Result>(
  operation: ApplyMutationOperation,
  query: () => Promise<Result>,
) => Promise<Result>;

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
    if (
      current &&
      current.table === mutation.table &&
      current.op === mutation.op &&
      !current.mutations.some((candidate) => candidate.rowId === mutation.rowId)
    ) {
      // Safe by the checks above: the run and the mutation agree on both discriminants, which is
      // exactly what the mapped type keys `mutations` on. A repeated row starts a new run because
      // PostgreSQL cannot affect one row twice in a single upsert statement, and each mutation needs
      // its own acceptance-time canonical outcome.
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
 * Reports rows this run is about to write over that have moved on since the client last saw them.
 *
 * Detection only — the write goes ahead regardless, because resolution is last-write-wins on the
 * server clock. Scoped to rows the caller can see, so a uuid guessed at random tells them nothing
 * about whether it exists.
 */
type StaleBase = {
  mutationId: string;
  table: SyncedTable;
  rowId: string;
  baseUpdatedAt: number | null;
  conflictingServerUpdatedAt: number;
};

async function findStaleBases(
  db: Executor,
  run: Run,
  scope: SQL | undefined,
  runOperation: ApplyMutationOperationRunner,
): Promise<StaleBase[]> {
  const table = syncedTables[run.table];
  const ids = run.mutations.map((mutation) => mutation.rowId);

  const existing = await runOperation(`conflict.read.${run.table}`, () =>
    withSyncPhase(
      "push.conflict_reads",
      () =>
        db
          .select({ id: table.id, updatedAt: table.updatedAt })
          .from(table)
          .where(and(inArray(table.id, ids), scope)),
      { table: run.table, operation: run.op, mutationCount: run.mutations.length },
      (rows) => ({ rowCount: rows.length }),
    ),
  );

  // Milliseconds, matching what the client had to send: it holds the driver-parsed `Date`, so the
  // stored microseconds are precision neither side can compare on. See `Mutation.baseUpdatedAt`.
  const updatedAtById = new Map(existing.map((row) => [row.id, row.updatedAt.getTime()]));

  return run.mutations.flatMap((mutation) => {
    const serverUpdatedAt = updatedAtById.get(mutation.rowId);
    if (serverUpdatedAt == null || serverUpdatedAt === mutation.baseUpdatedAt) return [];

    return [
      {
        mutationId: mutation.mutationId,
        table: run.table,
        rowId: mutation.rowId,
        baseUpdatedAt: mutation.baseUpdatedAt,
        conflictingServerUpdatedAt: serverUpdatedAt,
      },
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
  tableName: SyncedTable,
  table: (typeof syncedTables)[SyncedTable],
  where: SQL | undefined,
  runOperation: ApplyMutationOperationRunner,
): Promise<string[]> {
  const rows = await runOperation(`mutation.tombstone.${tableName}`, () =>
    db
      .update(table)
      .set({ deletedAt: now(), updatedAt: now() })
      .where(and(where, isNull(table.deletedAt)))
      .returning({ id: table.id }),
  );
  return rows.map((row) => row.id);
}

/**
 * Resolves the hexes a batch's categories carried into `colors` rows, minting the ones the palette
 * does not have yet.
 *
 * The client cannot mint a color id — `colors` is keyed by a serial and shared by every user — so
 * the CSV import sends the hex it generated and this turns it into an id. `hex` is unique, which is
 * what makes it idempotent: two devices importing the same category converge on one palette entry.
 */
async function resolveColorIds(
  db: Executor,
  hexes: string[],
  runOperation: ApplyMutationOperationRunner,
): Promise<Map<string, number>> {
  if (hexes.length === 0) return new Map();

  await runOperation("color.insert", () =>
    db
      .insert(colorsTable)
      .values(hexes.map((hex) => ({ hex })))
      .onConflictDoNothing(),
  );

  const rows = await runOperation("color.read", () =>
    db.select().from(colorsTable).where(inArray(colorsTable.hex, hexes)),
  );

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
async function recomputeBalances(
  db: Executor,
  profileIds: string[],
  runOperation: ApplyMutationOperationRunner,
): Promise<void> {
  if (profileIds.length === 0) return;

  await runOperation("balance.recompute", () =>
    db
      .update(accountsTable)
      .set({ balance: sql`${accountsTable.initialBalance} + ${transactionsSum}` })
      .where(and(inArray(accountsTable.profileId, profileIds), isNull(accountsTable.deletedAt))),
  );
}

function canonicalRowFor(
  rows: SyncedRows,
  table: SyncedTable,
  rowId: string,
): SyncedRows[SyncedTable][number] | undefined {
  return (rows[table] as SyncedRows[SyncedTable][number][]).find((row) => row.id === rowId);
}

function serializeCanonicalRow(
  row: SyncedRows[SyncedTable][number] | undefined,
): AcceptanceCanonicalRow | null {
  return row == null ? null : (JSON.parse(JSON.stringify(row)) as AcceptanceCanonicalRow);
}

function recordAppliedMutations(
  run: Run,
  affectedRowIds: string[],
  appliedMutationIds: Set<string>,
): void {
  const affected = new Set(affectedRowIds);
  for (const mutation of run.mutations) {
    if (affected.has(mutation.rowId)) appliedMutationIds.add(mutation.mutationId);
  }
}

function classifyCanonicalOutcome(
  mutationApplied: boolean,
  canonicalRow: SyncedRows[SyncedTable][number] | undefined,
): PushConflict["classification"] {
  if (mutationApplied) return "intent-applied";
  if (canonicalRow?.deletedAt != null) return "canonical-deleted";
  return "canonical-diverged";
}

function acceptanceProfileId(
  mutation: Mutation,
  canonicalRow: SyncedRows[SyncedTable][number] | undefined,
): string | null {
  if (mutation.table === "profiles") return mutation.rowId;
  if (canonicalRow && "profileId" in canonicalRow) return canonicalRow.profileId;
  return mutation.op === "upsert" ? mutation.payload.profileId : null;
}

function acceptanceEntityLabel(
  mutation: Mutation,
  canonicalRow: SyncedRows[SyncedTable][number] | undefined,
): string {
  if (canonicalRow && "name" in canonicalRow) return canonicalRow.name;
  if (mutation.op === "upsert" && "name" in mutation.payload) return mutation.payload.name;
  if (canonicalRow && "amount" in canonicalRow) {
    return canonicalRow.comment?.trim() || `${canonicalRow.type.toLowerCase()} transaction`;
  }
  return "Transaction";
}

export type AppliedBatch = {
  /** Newly applied and previously receipted ids, in the submitted outbox order. */
  applied: string[];
  conflicts: PushConflict[];
  touched: TouchedIds;
  /** Proven-owned or successfully written profiles whose account balances must be restated. */
  profileIds: Set<string>;
};

/**
 * Applies a whole batch, in order, and reports what it touched.
 *
 * Runs inside the caller's transaction: every read here — the ownership assertions especially — has
 * to see the rows earlier runs of the same batch inserted, which a separate connection could not.
 */
async function executeApplyMutations(
  db: Executor,
  userId: number,
  mutations: Mutation[],
  runOperation: ApplyMutationOperationRunner,
): Promise<AppliedBatch> {
  const touched: TouchedIds = {
    profiles: new Set(),
    accounts: new Set(),
    categories: new Set(),
    transactions: new Set(),
  };
  const profileIds = new Set<string>();
  const appliedMutationIds = new Set<string>();
  const outcomeByMutationId = new Map<string, PushConflict>();
  const fingerprintedMutations = mutations.map((mutation) => ({
    mutation,
    fingerprint: fingerprintMutation(mutation),
  }));
  const fingerprintByMutationId = new Map(
    fingerprintedMutations.map(({ mutation, fingerprint }) => [mutation.mutationId, fingerprint]),
  );

  for (const mutation of mutations) touched[mutation.table].add(mutation.rowId);

  // Claim before applying. The unique key serializes concurrent delivery of the same mutation, while
  // the surrounding transaction ensures a claim disappears if any later authorization or write fails.
  const claimedReceipts = await runOperation("receipt.claim", () =>
    withSyncPhase(
      "push.receipt_claims",
      () =>
        db
          .insert(mutationReceiptsTable)
          .values(
            fingerprintedMutations.map(({ mutation, fingerprint }) => ({
              userId,
              mutationId: mutation.mutationId,
              intentFingerprint: fingerprint,
            })),
          )
          .onConflictDoNothing()
          .returning({ mutationId: mutationReceiptsTable.mutationId }),
      { mutationCount: mutations.length },
      (receipts) => ({ claimedCount: receipts.length }),
    ),
  );
  const claimedMutationIds = new Set(claimedReceipts.map((receipt) => receipt.mutationId));
  const receipts = await runOperation("receipt.read", () =>
    db
      .select({
        mutationId: mutationReceiptsTable.mutationId,
        intentFingerprint: mutationReceiptsTable.intentFingerprint,
        conflictOutcome: mutationReceiptsTable.conflictOutcome,
        appliedAt: mutationReceiptsTable.appliedAt,
      })
      .from(mutationReceiptsTable)
      .where(
        and(
          eq(mutationReceiptsTable.userId, userId),
          inArray(
            mutationReceiptsTable.mutationId,
            mutations.map((mutation) => mutation.mutationId),
          ),
        ),
      ),
  );
  const receiptByMutationId = new Map(receipts.map((receipt) => [receipt.mutationId, receipt]));

  for (const mutation of mutations) {
    const receipt = receiptByMutationId.get(mutation.mutationId);
    if (!receipt)
      throw new Error(`Receipt claim was not visible for mutation ${mutation.mutationId}.`);

    // A null fingerprint marks a pre-upgrade receipt. Its unavailable history cannot be reconstructed,
    // so it is acknowledged from current canonical state without fabricating a conflict outcome.
    if (receipt.intentFingerprint == null) continue;
    if (receipt.intentFingerprint !== fingerprintByMutationId.get(mutation.mutationId)) {
      throw new MutationIntentMismatchError(mutation.mutationId);
    }
    if (!claimedMutationIds.has(mutation.mutationId) && receipt.conflictOutcome != null) {
      outcomeByMutationId.set(mutation.mutationId, receipt.conflictOutcome);
    }
  }

  const unreceiptedMutations = mutations.filter((mutation) =>
    claimedMutationIds.has(mutation.mutationId),
  );
  const mutationById = new Map(mutations.map((mutation) => [mutation.mutationId, mutation]));

  const persistAcceptanceOutcomes = async (staleBases: StaleBase[]): Promise<void> => {
    if (staleBases.length === 0) return;

    const staleTouched: TouchedIds = {
      profiles: new Set(),
      accounts: new Set(),
      categories: new Set(),
      transactions: new Set(),
    };
    for (const staleBase of staleBases) staleTouched[staleBase.table].add(staleBase.rowId);

    if (!authorization) throw new Error("Batch authorization was not initialized.");
    const canonicalRows = await withSyncPhase(
      "push.acceptance_outcomes",
      () =>
        readCanonicalRows(db, userId, staleTouched, runOperation, authorization.ownedProfileIds()),
      { conflictCount: staleBases.length },
    );
    const contexts = staleBases.map((staleBase) => {
      const mutation = mutationById.get(staleBase.mutationId);
      const receipt = receiptByMutationId.get(staleBase.mutationId);
      if (!mutation || !receipt) {
        throw new Error(`Acceptance context was not found for mutation ${staleBase.mutationId}.`);
      }
      const canonicalRow = canonicalRowFor(canonicalRows, staleBase.table, staleBase.rowId);
      return {
        staleBase,
        mutation,
        receipt,
        canonicalRow,
        profileId: acceptanceProfileId(mutation, canonicalRow),
      };
    });
    const newOutcomes: PushConflict[] = contexts.map(
      ({ staleBase, mutation, receipt, canonicalRow, profileId }) => ({
        mutationId: staleBase.mutationId,
        table: staleBase.table,
        rowId: staleBase.rowId,
        baseUpdatedAt: staleBase.baseUpdatedAt,
        conflictingServerUpdatedAt: staleBase.conflictingServerUpdatedAt,
        classification: classifyCanonicalOutcome(
          appliedMutationIds.has(mutation.mutationId),
          canonicalRow,
        ),
        acceptedAt: receipt.appliedAt.toISOString(),
        presentationContext: {
          profileId,
          profileName: profileId == null ? null : authorization.profileName(profileId),
          entityLabel: acceptanceEntityLabel(mutation, canonicalRow),
        },
        canonicalRow: serializeCanonicalRow(canonicalRow),
      }),
    );
    for (const outcome of newOutcomes) outcomeByMutationId.set(outcome.mutationId, outcome);

    const outcomeCases: SQL[] = [sql`case ${mutationReceiptsTable.mutationId}`];
    for (const outcome of newOutcomes) {
      outcomeCases.push(sql`when ${outcome.mutationId} then ${JSON.stringify(outcome)}::jsonb`);
    }
    outcomeCases.push(sql`end`);
    await runOperation("receipt.persist-outcomes", () =>
      db
        .update(mutationReceiptsTable)
        .set({ conflictOutcome: sql.join(outcomeCases, sql` `) })
        .where(
          and(
            eq(mutationReceiptsTable.userId, userId),
            inArray(
              mutationReceiptsTable.mutationId,
              newOutcomes.map((outcome) => outcome.mutationId),
            ),
          ),
        ),
    );
  };

  const authorization =
    unreceiptedMutations.length === 0
      ? null
      : await createBatchAuthorization(db, userId, unreceiptedMutations, runOperation);

  // Mutation runs must remain sequential: later rows can depend on parents created earlier in the batch.
  /* oxlint-disable no-await-in-loop */
  for (const run of toRuns(unreceiptedMutations)) {
    if (!authorization) throw new Error("Batch authorization was not initialized.");
    const ids = run.mutations.map((mutation) => mutation.rowId);
    const authorized = authorization.authorize(run.mutations);

    if (run.table === "profiles") {
      // A profile's own scope is its owner. Nothing is asserted up front: an insert stamps `userId`
      // from the session, and the guard below means a conflict on somebody else's uuid updates
      // nothing rather than taking their row over.
      const scope = eq(profilesTable.userId, userId);
      const runStaleBases = await findStaleBases(db, run, scope, runOperation);

      if (run.op === "delete") {
        // Profiles are tombstoned rather than hard-deleted so delta pulls can carry the deletion to
        // other devices. That means the database FK cascade does not run; mirror it explicitly for
        // every child table before tombstoning the profile itself.
        const ownedLiveProfileIds = authorized.liveTargetProfileIds;
        for (const id of ownedLiveProfileIds) profileIds.add(id);

        const affectedRowIds = await withSyncPhase(
          "push.mutation_application",
          async () => {
            if (ownedLiveProfileIds.length > 0) {
              await tombstone(
                db,
                "accounts",
                accountsTable,
                inArray(accountsTable.profileId, ownedLiveProfileIds),
                runOperation,
              );
              await tombstone(
                db,
                "categories",
                categoriesTable,
                inArray(categoriesTable.profileId, ownedLiveProfileIds),
                runOperation,
              );
              await tombstone(
                db,
                "transactions",
                transactionsTable,
                inArray(transactionsTable.profileId, ownedLiveProfileIds),
                runOperation,
              );
            }

            return tombstone(
              db,
              "profiles",
              profilesTable,
              and(inArray(profilesTable.id, ids), scope),
              runOperation,
            );
          },
          { table: run.table, operation: run.op, mutationCount: run.mutations.length },
        );
        recordAppliedMutations(run, affectedRowIds, appliedMutationIds);
        await persistAcceptanceOutcomes(runStaleBases);
        authorization.observe(
          run.mutations,
          affectedRowIds.map((id) => ({ id })),
        );
        continue;
      }

      const affectedRowIds = await runOperation("mutation.upsert.profiles", () =>
        withSyncPhase(
          "push.mutation_application",
          () =>
            db
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
              })
              .returning({ id: profilesTable.id, name: profilesTable.name }),
          { table: run.table, operation: run.op, mutationCount: run.mutations.length },
        ),
      );
      recordAppliedMutations(
        run,
        affectedRowIds.map((row) => row.id),
        appliedMutationIds,
      );

      for (const { id } of affectedRowIds) profileIds.add(id);
      await persistAcceptanceOutcomes(runStaleBases);
      authorization.observe(run.mutations, affectedRowIds);
      continue;
    }

    const owned = authorized.ownedProfileIds;
    const table = syncedTables[run.table];
    // A row outside the caller's proven profiles is not theirs to see, let alone write.
    const scope = inArray(table.profileId, owned);

    const runStaleBases = await findStaleBases(db, run, scope, runOperation);

    if (run.op === "delete") {
      const affectedRowIds = await withSyncPhase(
        "push.mutation_application",
        async () => {
          const affected = await tombstone(
            db,
            run.table,
            table,
            and(inArray(table.id, ids), scope),
            runOperation,
          );

          // Deleting an account takes its transactions with it. Their `onDelete: "cascade"` only fires
          // for a real delete, and without this the account would disappear from clients while the rows
          // filed against it stayed behind, counting towards balances belonging to nothing. The client
          // applies the same cascade to its own copy, which is what keeps the two ends agreeing.
          if (run.table === "accounts") {
            await tombstone(
              db,
              "transactions",
              transactionsTable,
              and(
                inArray(transactionsTable.accountId, ids),
                inArray(transactionsTable.profileId, owned),
              ),
              runOperation,
            );
          }
          return affected;
        },
        { table: run.table, operation: run.op, mutationCount: run.mutations.length },
      );
      recordAppliedMutations(run, affectedRowIds, appliedMutationIds);
      // Which profile the deleted rows were in is not worth a `returning` clause: a user has a
      // handful of profiles between them, and restating the balances of all of them is one indexed
      // statement that cannot miss the account a deleted transaction belonged to.
      for (const id of owned) profileIds.add(id);

      await persistAcceptanceOutcomes(runStaleBases);
      authorization.observe(
        run.mutations,
        affectedRowIds.map((id) => ({ id })),
      );
      continue;
    }

    if (run.table === "accounts") {
      const affectedRowIds = await runOperation("mutation.upsert.accounts", () =>
        withSyncPhase(
          "push.mutation_application",
          () =>
            db
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
              })
              .returning({ id: accountsTable.id, profileId: accountsTable.profileId }),
          { table: run.table, operation: run.op, mutationCount: run.mutations.length },
        ),
      );
      recordAppliedMutations(
        run,
        affectedRowIds.map((row) => row.id),
        appliedMutationIds,
      );

      await persistAcceptanceOutcomes(runStaleBases);
      authorization.observe(run.mutations, affectedRowIds);
      for (const { profileId } of affectedRowIds) {
        if (profileId != null) profileIds.add(profileId);
      }
      continue;
    }

    if (run.table === "categories") {
      const colorIds = await withSyncPhase(
        "push.color_resolution",
        () =>
          resolveColorIds(
            db,
            [...new Set(run.mutations.flatMap((mutation) => mutation.payload.colorHex ?? []))],
            runOperation,
          ),
        { mutationCount: run.mutations.length },
        (colors) => ({ colorCount: colors.size }),
      );

      const affectedRowIds = await runOperation("mutation.upsert.categories", () =>
        withSyncPhase(
          "push.mutation_application",
          () =>
            db
              .insert(categoriesTable)
              .values(
                run.mutations.map(({ rowId, payload }) => ({
                  id: rowId,
                  name: payload.name,
                  profileId: payload.profileId,
                  colorId:
                    (payload.colorHex == null ? payload.colorId : colorIds.get(payload.colorHex)) ??
                    null,
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
              })
              .returning({ id: categoriesTable.id, profileId: categoriesTable.profileId }),
          { table: run.table, operation: run.op, mutationCount: run.mutations.length },
        ),
      );
      recordAppliedMutations(
        run,
        affectedRowIds.map((row) => row.id),
        appliedMutationIds,
      );

      await persistAcceptanceOutcomes(runStaleBases);
      authorization.observe(run.mutations, affectedRowIds);
      for (const { profileId } of affectedRowIds) {
        if (profileId != null) profileIds.add(profileId);
      }
      continue;
    }

    const affectedRowIds = await runOperation("mutation.upsert.transactions", () =>
      withSyncPhase(
        "push.mutation_application",
        () =>
          db
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
            })
            .returning({ id: transactionsTable.id, profileId: transactionsTable.profileId }),
        { table: run.table, operation: run.op, mutationCount: run.mutations.length },
      ),
    );
    recordAppliedMutations(
      run,
      affectedRowIds.map((row) => row.id),
      appliedMutationIds,
    );
    await persistAcceptanceOutcomes(runStaleBases);
    authorization.observe(run.mutations, affectedRowIds);
    for (const { profileId } of affectedRowIds) profileIds.add(profileId);
  }
  /* oxlint-enable no-await-in-loop */

  await withSyncPhase(
    "push.balance_recomputation",
    () => recomputeBalances(db, [...profileIds], runOperation),
    { profileCount: profileIds.size },
  );

  return {
    applied: mutations.map((mutation) => mutation.mutationId),
    conflicts: mutations.flatMap((mutation) => outcomeByMutationId.get(mutation.mutationId) ?? []),
    touched,
    profileIds,
  };
}

export function createApplyMutations(runOperation: ApplyMutationOperationRunner) {
  return (db: Executor, userId: number, mutations: Mutation[]) =>
    executeApplyMutations(db, userId, mutations, runOperation);
}

export function applyMutations(
  db: Executor,
  userId: number,
  mutations: Mutation[],
): Promise<AppliedBatch> {
  return executeApplyMutations(db, userId, mutations, (_operation, query) => query());
}
