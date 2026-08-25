import { defineConfig, devices } from "@playwright/test";

const isPwaRun = process.argv.includes("--project=pwa") || process.env.PLAYWRIGHT_PWA === "true";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: "http://localhost:5454",
    trace: "on-first-retry",
  },

  projects: isPwaRun
    ? [
        {
          name: "pwa",
          testMatch: /offline-cold-start\.spec\.ts/,
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
          testIgnore: /offline-cold-start\.spec\.ts/,
          use: { ...devices["Desktop Chrome"] },
        },
        {
          name: "firefox",
          testIgnore: /offline-cold-start\.spec\.ts/,
          use: { ...devices["Desktop Firefox"] },
        },
        {
          name: "webkit",
          testIgnore: /offline-cold-start\.spec\.ts/,
          use: { ...devices["Desktop Safari"] },
        },
      ],

  webServer: isPwaRun
    ? {
        command: "pnpm build && pnpm preview --port 5455",
        url: "http://localhost:5455",
        reuseExistingServer: !process.env.CI,
      }
    : {
        command: "pnpm dev",
        url: "http://localhost:5454",
        reuseExistingServer: !process.env.CI,
      },
});
