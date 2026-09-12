import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

loadEnvFile(".env");

export default defineConfig({
  testDir: "./e2e",
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5454",
    trace: "on-first-retry",
    acceptDownloads: false,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5454",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
