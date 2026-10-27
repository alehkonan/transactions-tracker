import path from "node:path";
import { defineConfig } from "drizzle-kit";
import { getDatabaseCredentials } from "./src/database/connection.server";

export default defineConfig({
  dialect: "postgresql",
  schema: path.join("src", "database", "schema.ts"),
  out: path.join("src", "database", "migrations"),
  dbCredentials: getDatabaseCredentials(),
});
