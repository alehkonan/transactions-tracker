import { expect, test } from "@playwright/test";

const APP_CACHE = "transactions-tracker-recovery-test";
const OTHER_CACHE = "unrelated-recovery-test";
const SENTINEL_DATABASE = "pwa-recovery-sentinel";

test("repairs PWA files without deleting local IndexedDB data", async ({ page }) => {
  await page.goto("/pwa-recovery.html");
  await expect(page.getByRole("heading", { name: "Repair the offline app" })).toBeVisible();

  await page.evaluate(
    async ({ appCache, otherCache, databaseName }) => {
      await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      await caches.open(appCache);
      await caches.open(otherCache);
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(databaseName, 1);
        request.addEventListener(
          "upgradeneeded",
          () => request.result.createObjectStore("sentinel"),
          {
            once: true,
          },
        );
        request.addEventListener("error", () => reject(request.error), { once: true });
        request.addEventListener(
          "success",
          () => {
            request.result.close();
            resolve();
          },
          { once: true },
        );
      });
    },
    { appCache: APP_CACHE, otherCache: OTHER_CACHE, databaseName: SENTINEL_DATABASE },
  );

  await page.getByTestId("pwa-repair").click();
  await expect(page.getByTestId("pwa-open-app")).toBeVisible();
  await expect(page.getByText("Offline app repaired.", { exact: false })).toBeVisible();

  const retainedState = await page.evaluate(
    async ({ appCache, otherCache, databaseName }) => {
      const cacheNames = await caches.keys();
      const databases = await indexedDB.databases();
      return {
        appCache: cacheNames.includes(appCache),
        otherCache: cacheNames.includes(otherCache),
        sentinelDatabase: databases.some((database) => database.name === databaseName),
        registrations: (await navigator.serviceWorker.getRegistrations()).length,
      };
    },
    { appCache: APP_CACHE, otherCache: OTHER_CACHE, databaseName: SENTINEL_DATABASE },
  );

  expect(retainedState).toEqual({
    appCache: false,
    otherCache: true,
    sentinelDatabase: true,
    registrations: 0,
  });
});
