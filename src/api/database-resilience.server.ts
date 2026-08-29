import { sql } from "drizzle-orm";
import { getDb, type Executor } from "~/database/get-db.server";
import { withSyncPhase } from "./sync-observability.server";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";

const LOCK_TIMEOUT = "1500ms";
const STATEMENT_TIMEOUT = "6s";
const IDLE_TRANSACTION_TIMEOUT = "7s";
const TRANSACTION_TIMEOUT = "8s";

/**
 * Runs request-path database work with PostgreSQL-enforced deadlines.
 *
 * The settings are local to this transaction, which is safe for transaction pooling: no session state
 * can leak to the next client that Supavisor assigns to the backend. PostgreSQL remains responsible for
 * stopping the work if the HTTP request disappears before application code can observe the failure.
 * PostgreSQL 17+ also receives an eight-second whole-transaction timeout; older versions retain the
 * statement/lock/idle protections and expose the remaining total duration through phase logs.
 */
export async function runDatabaseTransaction<T>(
  phase: string,
  work: (transaction: Executor) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> {
  return withSyncPhase(`${phase}.transaction`, () =>
    getDb().transaction(async (transaction) => {
      await withSyncPhase(`${phase}.deadlines`, () =>
        transaction.execute(sql`
          select
            set_config('lock_timeout', ${LOCK_TIMEOUT}, true) as lock_timeout,
            set_config('statement_timeout', ${STATEMENT_TIMEOUT}, true) as statement_timeout,
            set_config(
              'idle_in_transaction_session_timeout',
              ${IDLE_TRANSACTION_TIMEOUT},
              true
            ) as idle_transaction_timeout,
            case
              when current_setting('server_version_num')::int >= 170000
              then set_config('transaction_timeout', ${TRANSACTION_TIMEOUT}, true)
              else null
            end as transaction_timeout
        `),
      );

      return work(transaction);
    }, config),
  );
}

/** Uses one coherent snapshot and prevents accidental writes in request-path read transactions. */
export function runReadDatabaseTransaction<T>(
  phase: string,
  work: (transaction: Executor) => Promise<T>,
): Promise<T> {
  return runDatabaseTransaction(phase, work, {
    accessMode: "read only",
    isolationLevel: "repeatable read",
  });
}
