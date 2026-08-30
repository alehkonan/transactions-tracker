import { pathToFileURL } from "node:url";
import postgres from "postgres";
import { RETENTION_DAYS, SWEPT_TABLES } from "../../src/modules/sync/synced-tables.ts";

/**
 * Tombstone garbage collection: the deletions that have been replicated for long enough that no
 * client still needs to hear about them.
 *
 * A delete in this app is a row with `deleted_at` set, never a `DELETE` — a row that simply vanishes
 * is invisible to a delta pull and would live on every client forever. The cost is that the
 * tombstones accumulate, so they are swept once they are older than the window a client is allowed
 * to be away for. A device that has been dormant longer than that does not resume from its cursor at
 * all; it drops its local copy and pulls afresh (see `isCursorStale`), which is the other half of
 * this and the reason the two numbers are deliberately far apart.
 *
 * Runs on a schedule in production and by hand in development:
 *
 * ```
 * pnpm gc:tombstones
 * ```
 *
 * Deliberately standalone — it talks to postgres directly rather than through `getDb()` and the
 * Drizzle schema, so it is a file Node can run on its own and a function Netlify can bundle without
 * server graph in behind it. The table order and retention constants come from one dependency-free
 * module shared with the sync client.
 */

export const config = { schedule: "@daily" };

type SweepResult = Record<string, number>;

function getSslConfig() {
  const encodedCertificate = process.env.POSTGRES_CA_CERT_BASE64;
  const deployed = process.env.NODE_ENV === "production" || process.env.NETLIFY === "true";

  if (!encodedCertificate) {
    if (deployed) throw new Error("POSTGRES_CA_CERT_BASE64 is required in deployed environments");
    return false;
  }

  const ca = Buffer.from(encodedCertificate, "base64").toString("utf8");
  if (!ca.includes("-----BEGIN CERTIFICATE-----") || !ca.includes("-----END CERTIFICATE-----")) {
    throw new Error("POSTGRES_CA_CERT_BASE64 does not contain a valid PEM certificate");
  }

  return { ca, rejectUnauthorized: true };
}

function connect() {
  const host = process.env.POSTGRES_HOST;
  if (!host) throw new Error("POSTGRES_HOST is not set — no database to sweep.");

  return postgres({
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    host,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    ssl: getSslConfig(),
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 3,
    connection: { application_name: "transactions-tracker-tombstone-gc" },
  });
}

/**
 * Hard-deletes every tombstone past the retention window, and reports how many per table.
 *
 * One statement per table rather than one statement with several CTEs: the cascades mean two
 * branches of the same statement could try to delete the same row from the same snapshot, and
 * housekeeping that runs off the request path has no reason to be clever about round trips.
 */
export async function sweepTombstones(): Promise<SweepResult> {
  const sql = connect();

  try {
    const removed: SweepResult = {};

    /* oxlint-disable no-await-in-loop -- maintenance deletes are intentionally sequential. */
    for (const table of SWEPT_TABLES) {
      const result = await sql`
        delete from ${sql(table)}
        where deleted_at is not null
          and deleted_at < now() - ${`${RETENTION_DAYS} days`}::interval
      `;
      removed[table] = result.count;
    }
    /* oxlint-enable no-await-in-loop */

    return removed;
  } finally {
    await sql.end();
  }
}

/** The scheduled invocation. Netlify reads `config.schedule` above to know when to call it. */
export default async function handler(): Promise<Response> {
  const removed = await sweepTombstones();
  console.log("Swept tombstones older than %d days:", RETENTION_DAYS, removed);

  return new Response(JSON.stringify(removed), {
    headers: { "content-type": "application/json" },
  });
}

// Run the sweep when this file is executed directly (`pnpm gc:tombstones`), so it can be tried
// against a real database without waiting for a deploy or for midnight. Netlify imports the module
// rather than running it, so this stays inert there.
if (process.argv[1] != null && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const removed = await sweepTombstones();
  console.log("Swept tombstones older than %d days:", RETENTION_DAYS, removed);
}
