import { expect, test } from "@playwright/test";

const CACHE_PREFIX = "transactions-tracker-";

/** A ready registration alone is insufficient: offline assertions require a controlling worker. */
async function ensureControlledShell(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/login");
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("No service worker became ready within 10 seconds.")),
          10_000,
        ),
      ),
    ]);
  });

  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) {
    await page.goto("/login");
  }

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null))
    .toBe(true);

  return page.evaluate(async (cachePrefix) => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error("The active service worker does not control the shell.");

    const workerSource = await fetch(controller.scriptURL).then((response) => response.text());
    const buildId = /const BUILD_ID = ([^;]+);/.exec(workerSource)?.[1]?.replaceAll('"', "");
    if (!buildId) throw new Error("The controlling worker has no readable build version.");

    const cacheNames = await caches.keys();
    if (!cacheNames.includes(`${cachePrefix}${buildId}`)) {
      throw new Error(`The shell cache does not match controlling worker ${buildId}.`);
    }
    return buildId;
  }, CACHE_PREFIX);
}

test("an anonymous production shell installs a valid controlling worker", async ({ page }) => {
  const buildId = await ensureControlledShell(page);
  expect(buildId).toMatch(/^build-\d+$/);
});

test("a controlled shell does not wait for a slow navigation response", async ({ page }) => {
  const buildId = await ensureControlledShell(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 3_000,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });

  const startedAt = Date.now();
  try {
    await page.goto(`/login?pwa-build=${buildId}`, { waitUntil: "domcontentloaded" });
  } finally {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  }

  expect(Date.now() - startedAt).toBeLessThan(1_500);
  await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();
});
