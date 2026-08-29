import { applyMutations, type AppliedBatch } from "./apply-mutations.server";
import { runDatabaseTransaction, runReadDatabaseTransaction } from "./database-resilience.server";
import { readCanonicalRows, readColors } from "./push.server";
import { withSyncPhase } from "./sync-observability.server";
import type { TouchedIds } from "./apply-mutations.server";
import type { Executor } from "~/database/get-db.server";
import type { Color, Mutation, PushChangesResult, SyncedRows } from "~/modules/sync/sync-types";

type PushExecutionDependencies<Database> = {
  /** Owns the atomic mutation transaction. */
  runTransaction<T>(work: (transaction: Database) => Promise<T>): Promise<T>;
  /** Owns bounded reads after the mutation transaction commits. */
  runReadTransaction<T>(work: (transaction: Database) => Promise<T>): Promise<T>;
  applyMutations(database: Database, userId: number, mutations: Mutation[]): Promise<AppliedBatch>;
  readCanonicalRows(database: Database, userId: number, touched: TouchedIds): Promise<SyncedRows>;
  readColors(database: Database): Promise<Color[]>;
};

function emptyRows(): SyncedRows {
  return { profiles: [], accounts: [], categories: [], transactions: [] };
}

/**
 * Builds the shared push execution module. The factory is an internal test seam: production callers
 * use `executePush`, while tests can provide recording collaborators without mocking Drizzle.
 */
export function createPushExecution<Database>(
  dependencies: PushExecutionDependencies<Database>,
): (userId: number, mutations: Mutation[]) => Promise<PushChangesResult> {
  return async (userId, mutations) => {
    const appliedBatch =
      mutations.length === 0
        ? null
        : await dependencies.runTransaction((transaction) =>
            withSyncPhase(
              "push.apply_batch",
              () => dependencies.applyMutations(transaction, userId, mutations),
              { mutationCount: mutations.length },
              (batch) => ({ conflictCount: batch.conflicts.length }),
            ),
          );

    const { canonicalRows, colors } = await dependencies.runReadTransaction(async (database) => {
      const committedRows =
        appliedBatch == null
          ? emptyRows()
          : await withSyncPhase(
              "push.canonical_rows",
              () => dependencies.readCanonicalRows(database, userId, appliedBatch.touched),
              {},
              (rows) => ({
                profiles: rows.profiles.length,
                accounts: rows.accounts.length,
                categories: rows.categories.length,
                transactions: rows.transactions.length,
              }),
            );
      const committedColors = await withSyncPhase(
        "push.colors",
        () => dependencies.readColors(database),
        {},
        (rows) => ({ rowCount: rows.length }),
      );
      return { canonicalRows: committedRows, colors: committedColors };
    });

    return {
      applied: mutations.map((mutation) => mutation.mutationId),
      canonicalRows,
      conflicts: appliedBatch?.conflicts ?? [],
      colors,
    };
  };
}

/** Executes one validated, authenticated push and returns the shared result shape. */
export const executePush = createPushExecution<Executor>({
  runTransaction: <T>(work: (transaction: Executor) => Promise<T>) =>
    runDatabaseTransaction("push.write", work),
  runReadTransaction: <T>(work: (transaction: Executor) => Promise<T>) =>
    runReadDatabaseTransaction("push.read", work),
  applyMutations,
  readCanonicalRows,
  readColors,
});
