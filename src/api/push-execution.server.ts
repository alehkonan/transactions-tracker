import { getDb, type Executor } from "~/database/get-db.server";
import { applyMutations, type AppliedBatch } from "./apply-mutations.server";
import { readCanonicalRows, readColors } from "./push.server";
import type { TouchedIds } from "./apply-mutations.server";
import type { Color, Mutation, PushChangesResult, SyncedRows } from "~/modules/sync/sync-types";

type PushExecutionDependencies<Database> = {
  /** Owns the atomic mutation transaction. */
  runTransaction<T>(work: (transaction: Database) => Promise<T>): Promise<T>;
  /** The committed database handle used for post-transaction reads. */
  readDatabase(): Database;
  applyMutations(database: Database, userId: number, mutations: Mutation[]): Promise<AppliedBatch>;
  readCanonicalRows(database: Database, touched: TouchedIds): Promise<SyncedRows>;
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
            dependencies.applyMutations(transaction, userId, mutations),
          );

    const database = dependencies.readDatabase();
    const [canonicalRows, colors] = await Promise.all([
      appliedBatch == null
        ? emptyRows()
        : dependencies.readCanonicalRows(database, appliedBatch.touched),
      dependencies.readColors(database),
    ]);

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
  runTransaction: <T>(work: (transaction: Executor) => Promise<T>) => getDb().transaction(work),
  readDatabase: getDb,
  applyMutations,
  readCanonicalRows,
  readColors,
});
