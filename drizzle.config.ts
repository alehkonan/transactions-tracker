import path from "node:path";
import { defineConfig } from "drizzle-kit";

// process.loadEnvFile(".env.local");

export default defineConfig({
  dialect: "postgresql",
  schema: path.join("src", "database", "schema.ts"),
  out: path.join("src", "database", "migrations"),
  dbCredentials: {
    user: process.env.POSTGRES_USER!,
    password: process.env.POSTGRES_PASSWORD!,
    host: process.env.POSTGRES_HOST!,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB!,
  },
});
