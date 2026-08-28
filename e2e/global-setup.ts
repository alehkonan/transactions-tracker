import { execFileSync } from "node:child_process";

/** Applies committed migrations before the E2E server functions handle any test requests. */
export default function globalSetup(): void {
  try {
    execFileSync("pnpm", ["db:migrate"], { stdio: "inherit" });
  } catch {
    throw new Error(
      "E2E database setup failed. Start Postgres with `docker compose up -d db` and verify the required auth/database environment is configured.",
    );
  }
}
