import { drizzle } from "drizzle-orm/postgres-js";
import { createPostgresClient } from "./connection.server";
import * as schema from "./schema";

// No top-level side effects: this module must be fully tree-shakeable so the
// TanStack Start compiler can drop it (and the postgres driver) from the client
// bundle. The connection is created lazily on first use, inside server-fn handlers.
const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof createPostgresClient>;
  db?: ReturnType<typeof drizzle<typeof schema>>;
};

type Database = ReturnType<typeof drizzle<typeof schema>>;

/**
 * A handle statements can run on: the connection itself, or an open transaction.
 *
 * Helpers that read on behalf of a write — the ownership assertions, say — have to accept the
 * transaction, or they query outside it and cannot see the rows the batch inserted a moment ago.
 */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export function getDb() {
  if (!globalForDb.db) {
    const client = globalForDb.client ?? createPostgresClient("transactions-tracker-runtime");
    globalForDb.client = client;
    globalForDb.db = drizzle(client, { schema });
  }
  return globalForDb.db;
}
