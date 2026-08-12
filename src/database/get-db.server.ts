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
      });
    if (process.env.NODE_ENV !== "production") globalForDb.client = client;
    globalForDb.db = drizzle(client, { schema });
  }
  return globalForDb.db;
}
