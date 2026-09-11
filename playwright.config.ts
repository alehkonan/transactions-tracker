import { loadEnvFile } from "node:process";
import { defineConfig, devices } from "@playwright/test";

loadEnvFile(".env");

const isPwaRun = process.argv.includes("--project=pwa") || process.env.PLAYWRIGHT_PWA === "true";
const pwaTestPattern = /(?:offline-cold-start|pwa-startup)\.spec\.ts/;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5454",
    trace: "on-first-retry",
  },

  projects: isPwaRun
    ? [
        {
          name: "pwa",
          testMatch: pwaTestPattern,
          use: {
            ...devices["Desktop Chrome"],
            baseURL: "http://localhost:5455",
            serviceWorkers: "allow",
          },
        },
      ]
    : [
        {
          name: "chromium",
          testIgnore: pwaTestPattern,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "firefox",
          testIgnore: pwaTestPattern,
          use: { ...devices["Desktop Firefox"] },
        },
        {
          name: "webkit",
          testIgnore: pwaTestPattern,
          use: { ...devices["Desktop Safari"] },
        },
      ],

  webServer: isPwaRun
    ? {
        command: "pnpm build && pnpm preview --port 5455 --strictPort",
        url: "http://localhost:5455",
        reuseExistingServer: false,
        timeout: 120_000,
      }
    : {
        command: "pnpm dev -- --strictPort",
        url: "http://localhost:5454",
        reuseExistingServer: !process.env.CI,
      },
});
