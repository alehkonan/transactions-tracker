import { expect, test } from "@playwright/test";

const CACHE_PREFIX = "transactions-tracker-";

/** A ready registration alone is insufficient: offline assertions require a controlling worker. */
async function ensureControlledShell(page: import("@playwright/test").Page): Promise<string> {
  await page.goto("/login");
  const workerState = await page.evaluate(async () => {
    const ready = await Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 10_000)),
    ]);
    if (ready) return { ready: true, registration: "active", failedPrecache: [] as string[] };

    const registration = await navigator.serviceWorker.getRegistration();
    const artifacts = (await fetch("/offline-artifacts.json", { cache: "no-store" }).then(
      (response) => response.json(),
    )) as { precache: string[] };
    const failedPrecache = (
      await Promise.all(
        artifacts.precache.map(async (url) => {
          try {
            const response = await fetch(url, { cache: "no-store" });
            return response.ok ? null : `${url} (${response.status})`;
          } catch (error) {
            return `${url} (${error instanceof Error ? error.message : "fetch failed"})`;
          }
        }),
      )
    ).filter((failure): failure is string => failure != null);

    return {
      ready: false,
      registration:
        registration?.installing?.state ??
        registration?.waiting?.state ??
        registration?.active?.state ??
        "missing",
      failedPrecache,
    };
  });
  expect(workerState, "service worker installation diagnostics").toMatchObject({
    ready: true,
    registration: "active",
    failedPrecache: [],
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
  expect(buildId).toMatch(/^[a-f\d]{20}$/);
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
