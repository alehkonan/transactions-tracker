import path from "node:path";
import { defineConfig } from "drizzle-kit";

process.loadEnvFile(".env.local");

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set in env");
  process.exit(1);
}

export default defineConfig({
  dialect: "postgresql",
  schema: path.join("src", "database", "schema.ts"),
  out: path.join("src", "database", "migrations"),
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
