import { expect } from "@playwright/test";
import { test, waitForSynced } from "./fixtures/auth";
import { E2E_ACCOUNT_NAME } from "./fixtures/auth";

/**
 * This runs in the production-only `pwa` project. A service worker is intentionally not registered
 * by the Vite dev server, so a dev-server test would prove the wrong thing.
 */
test("opens a warm app after a cold reload without a connection", async ({
  onboardedPage: page,
  context,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: /^Offline/ })).toBeVisible();

  // The route chunk is lazy-loaded, so this also proves the complete client asset graph was cached.
  await page.getByRole("link", { name: "Statistics" }).click();
  await expect(page.getByRole("heading", { name: "Statistics" })).toBeVisible();
});
