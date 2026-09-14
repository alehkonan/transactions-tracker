import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

const APP_CACHE_PREFIX = "transactions-tracker-";
const DATABASE_NAME = "transactions-tracker";
const SENTINEL_KEY = "e2e-storage-failure-sentinel";
const SENTINEL_VALUE = { purpose: "prove storage failures do not reset IndexedDB" };
const IDB_FAILURE_FLAG = "e2e-force-idb-unavailable";
const DELETE_CALLS_KEY = "e2e-delete-database-calls";
const IDB_UNAVAILABLE_MESSAGE = "Browser storage is unavailable for this test.";

async function openDatabase(page: Page): Promise<void> {
  await page.evaluate(async (databaseName) => {
    const request = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result), { once: true });
      request.addEventListener("error", () => reject(request.error), { once: true });
    });
    database.close();
  }, DATABASE_NAME);
}

async function writeSentinel(page: Page): Promise<void> {
  await page.evaluate(
    async ({ databaseName, key, value }) => {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });

      try {
        const transaction = database.transaction("meta", "readwrite");
        transaction.objectStore("meta").put(value, key);
        await new Promise<void>((resolve, reject) => {
          transaction.addEventListener("complete", () => resolve(), { once: true });
          transaction.addEventListener("abort", () => reject(transaction.error), { once: true });
          transaction.addEventListener("error", () => reject(transaction.error), { once: true });
        });
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, key: SENTINEL_KEY, value: SENTINEL_VALUE },
  );
}

async function readSentinel(page: Page): Promise<unknown> {
  return page.evaluate(
    async ({ databaseName, key }) => {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.addEventListener("success", () => resolve(request.result), { once: true });
        request.addEventListener("error", () => reject(request.error), { once: true });
      });

      try {
        const sentinelRequest = database
          .transaction("meta", "readonly")
          .objectStore("meta")
          .get(key);
        return await new Promise<unknown>((resolve, reject) => {
          sentinelRequest.addEventListener("success", () => resolve(sentinelRequest.result), {
            once: true,
          });
          sentinelRequest.addEventListener("error", () => reject(sentinelRequest.error), {
            once: true,
          });
        });
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, key: SENTINEL_KEY },
  );
}

async function ensureControlledShell(page: Page): Promise<void> {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Welcome", exact: true })).toBeVisible();

  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          return registration?.active?.state === "activated";
        }),
      { timeout: 15_000 },
    )
    .toBe(true);

  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) {
    await page.reload();
  }

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null), {
      timeout: 15_000,
    })
    .toBe(true);

  await expect
    .poll(() =>
      page.evaluate(async (prefix) => {
        const names = await caches.keys();
        return names.some((name) => name.startsWith(prefix));
      }, APP_CACHE_PREFIX),
    )
    .toBe(true);
}

test("unavailable IndexedDB shows a retryable load failure without resetting local data", async ({
  context,
  page,
}) => {
  await context.addInitScript(
    ({ deleteCallsKey, failureFlag, failureMessage }) => {
      const factoryPrototype = Object.getPrototypeOf(indexedDB) as IDBFactory;
      const originalOpen = factoryPrototype.open;
      const originalDeleteDatabase = factoryPrototype.deleteDatabase;

      Object.defineProperty(factoryPrototype, "open", {
        configurable: true,
        value(this: IDBFactory, name: string, version?: number) {
          if (localStorage.getItem(failureFlag) === "true") {
            throw new DOMException(failureMessage, "SecurityError");
          }
          return Reflect.apply(
            originalOpen,
            this,
            version === undefined ? [name] : [name, version],
          );
        },
      });
      Object.defineProperty(factoryPrototype, "deleteDatabase", {
        configurable: true,
        value(this: IDBFactory, name: string) {
          const calls = Number(localStorage.getItem(deleteCallsKey) ?? "0");
          localStorage.setItem(deleteCallsKey, String(calls + 1));
          return Reflect.apply(originalDeleteDatabase, this, [name]);
        },
      });
    },
    {
      deleteCallsKey: DELETE_CALLS_KEY,
      failureFlag: IDB_FAILURE_FLAG,
      failureMessage: IDB_UNAVAILABLE_MESSAGE,
    },
  );

  await page.goto("/transactions");
  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await openDatabase(page);
  await writeSentinel(page);
  await page.evaluate((failureFlag) => localStorage.setItem(failureFlag, "true"), IDB_FAILURE_FLAG);

  await page.goto("/transactions?idb-unavailable");

  await expect(page.getByRole("heading", { name: "Could not load your data" })).toBeVisible();
  await expect(page.getByText(IDB_UNAVAILABLE_MESSAGE, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Offline", exact: true })).toHaveCount(0);
  await expect(
    page.getByText(/saved on this device|Everything on this device is on the server/i),
  ).toHaveCount(0);
  await expect(
    page.evaluate((key) => Number(localStorage.getItem(key) ?? "0"), DELETE_CALLS_KEY),
  ).resolves.toBe(0);

  await page.evaluate((failureFlag) => localStorage.removeItem(failureFlag), IDB_FAILURE_FLAG);
  await page.getByRole("button", { name: "Try again", exact: true }).click();

  await expect(page).toHaveURL(/\/login(?:\?|$)/);
  await expect(readSentinel(page)).resolves.toEqual(SENTINEL_VALUE);
  await expect(
    page.evaluate((key) => Number(localStorage.getItem(key) ?? "0"), DELETE_CALLS_KEY),
  ).resolves.toBe(0);
});

test("cache eviction shows offline recovery guidance and repair preserves IndexedDB", async ({
  context,
  page,
}) => {
  await ensureControlledShell(page);
  await writeSentinel(page);

  const evictedCaches = await page.evaluate(async (prefix) => {
    const names = (await caches.keys()).filter((name) => name.startsWith(prefix));
    await Promise.all(names.map((name) => caches.delete(name)));
    return names;
  }, APP_CACHE_PREFIX);
  expect(evictedCaches.length).toBeGreaterThan(0);
  await expect(
    page.evaluate(
      async (prefix) => (await caches.keys()).filter((name) => name.startsWith(prefix)),
      APP_CACHE_PREFIX,
    ),
  ).resolves.toEqual([]);

  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.clearBrowserCache");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await context.setOffline(true);
  const response = await page.goto("/transactions?cache-evicted", {
    waitUntil: "domcontentloaded",
  });

  expect(response?.status()).toBe(503);
  await expect(page.getByRole("heading", { name: "Offline", exact: true })).toBeVisible();
  await expect(
    page.getByText("This app update is not available offline yet. Reconnect and try again.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByText(/saved on this device|Everything on this device is on the server/i),
  ).toHaveCount(0);
  await expect(readSentinel(page)).resolves.toEqual(SENTINEL_VALUE);

  await context.setOffline(false);
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: false });
  await cdp.detach();
  await page.goto("/pwa-recovery.html");
  await expect(page.getByRole("heading", { name: "Repair the offline app" })).toBeVisible();
  await expect(
    page.getByText("Your local profiles, transactions, and unsynced changes stay on this device.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByTestId("pwa-repair")).toBeVisible();

  await page.getByTestId("pwa-repair").click();
  await expect(page.getByText("Offline app repaired.", { exact: false })).toBeVisible();
  await expect(readSentinel(page)).resolves.toEqual(SENTINEL_VALUE);
});
