import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

// No top-level side effects: this module must be fully tree-shakeable so the
// TanStack Start compiler can drop it (and the postgres driver) from the client
// bundle. The connection is created lazily on first use, inside server-fn handlers.
const globalForDb = globalThis as unknown as {
  client?: ReturnType<typeof postgres>;
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
    const client =
      globalForDb.client ??
      postgres({
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        host: process.env.POSTGRES_HOST,
        port: Number(process.env.POSTGRES_PORT),
        database: process.env.POSTGRES_DB,
        // Deployed as serverless functions, so concurrency comes from many instances rather than
        // many connections within one. The driver's default pool of 10 would multiply per instance
        // and, against a 500MB database where each backend costs several MB of RAM, exhaust
        // `max_connections` long before it ever helped throughput.
        max: 1,
        // Required by Supavisor transaction mode and safe if the reported port is actually session mode.
        prepare: false,
        // Let an idle instance hand its connection back rather than holding it until it is frozen.
        idle_timeout: 20,
        // Leave enough room for a controlled retry well before the platform request boundary.
        connect_timeout: 3,
        // Visible in pg_stat_activity without exposing a host, credential, user, or request payload.
        connection: { application_name: "transactions-tracker-runtime" },
      });
    globalForDb.client = client;
    globalForDb.db = drizzle(client, { schema });
  }
  return globalForDb.db;
}
