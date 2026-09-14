import { expect } from "@playwright/test";
import { test, waitForSynced } from "../fixtures/auth";
import { E2E_ACCOUNT_NAME } from "../fixtures/auth";

type StartupTiming = {
  navigation: number | null;
  firstContentfulPaint: number | null;
  localRead: number | null;
  localReady: number | null;
  sync: number | null;
};

async function readStartupTiming(page: import("@playwright/test").Page): Promise<StartupTiming> {
  return page.evaluate(() => {
    // oxlint-disable-next-line unicorn/consistent-function-scoping -- this helper must stay in the serialized browser closure.
    const mark = (name: string) =>
      performance.getEntriesByName(`transactions-tracker:${name}`, "mark").at(-1)?.startTime ??
      null;
    const navigation = performance.getEntriesByType("navigation").at(-1)?.duration ?? null;
    const firstContentfulPaint =
      performance.getEntriesByName("first-contentful-paint", "paint").at(-1)?.startTime ?? null;
    const localReadStart = mark("local-read-start");
    const localReadEnd = mark("local-read-end");
    const syncStart = mark("sync-start");
    const syncEnd = mark("sync-end");
    return {
      navigation,
      firstContentfulPaint,
      localRead:
        localReadStart == null || localReadEnd == null ? null : localReadEnd - localReadStart,
      localReady: mark("local-ready"),
      sync: syncStart == null || syncEnd == null ? null : syncEnd - syncStart,
    };
  });
}

/**
 * This suite runs through the shared Playwright config, which always builds fresh production
 * artifacts and starts `vite preview` before launching a browser.
 */
test("opens a warm app after a cold reload without a connection", async ({
  onboardedPage: page,
  context,
}, testInfo) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) {
    await page.reload();
    await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null))
    .toBe(true);
  const firstVisit = await readStartupTiming(page);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible({ timeout: 30_000 });
  // Playwright's network emulation does not update navigator.onLine or emit the browser event.
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: /^Offline/ })).toBeVisible();

  // This deep link was not visited online. Its lazy chunk and validated filters must both survive.
  await page.goto("/statistics?period=1y");
  await expect(page).toHaveURL(/\/statistics\?period=1y$/);
  await expect(
    page.getByRole("heading", { name: "Statistics", includeHidden: true }),
  ).toBeAttached();

  const repeatVisit = await readStartupTiming(page);
  const timings = { firstVisit, repeatVisit };
  console.info(`PWA startup timings ${JSON.stringify(timings)}`);
  await testInfo.attach("pwa-startup-timings.json", {
    body: JSON.stringify(timings, null, 2),
    contentType: "application/json",
  });
});
