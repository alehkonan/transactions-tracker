import { getConnectionString } from "@netlify/database";
import postgres from "postgres";

type DatabaseCredentials =
  | { url: string; ssl: { rejectUnauthorized: true } }
  | { user: string; password: string; host: string; port: number; database: string; ssl: false };

/** Shared by the request client, Drizzle Kit, and the standalone tombstone function. */
export function getDatabaseCredentials(): DatabaseCredentials {
  if (process.env.NETLIFY === "true" && process.env.NETLIFY_DEV !== "true") {
    // Select by deployment environment, not by whether a URL happens to be set locally.
    // A missing hosted URL must fail instead of falling back to POSTGRES_* credentials.
    return {
      url: process.env.NETLIFY_DB_URL || getConnectionString(),
      ssl: { rejectUnauthorized: true },
    };
  }

  return {
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    host: process.env.POSTGRES_HOST!,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB!,
    ssl: false as const,
  };
}

/** Creates no connection until called by a server handler or the maintenance entry point. */
export function createPostgresClient(applicationName: string) {
  const credentials = getDatabaseCredentials();
  const options = {
    // Connection concurrency comes from function instances, not a pool of ten per instance.
    max: 1,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 3,
    connection: { application_name: applicationName },
    // Explicit options override URL sslmode=require, which otherwise disables verification in
    // postgres.js. Hosted databases use the system trust store rather than a Supabase-specific CA.
    ssl: credentials.ssl,
  };

  return "url" in credentials
    ? postgres(credentials.url, options)
    : postgres({ ...credentials, ...options });
}
