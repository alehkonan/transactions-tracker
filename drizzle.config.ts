import { defineConfig } from "drizzle-kit";

process.loadEnvFile(".env.local");

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set in env");
  process.exit(1);
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/drizzle/schema.ts",
  out: "./src/drizzle/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
