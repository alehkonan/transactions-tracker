import { expect, test } from "@playwright/test";
import {
  DATABASE_NAME,
  readReplicaDescriptor,
  waitForDatabaseVersion,
} from "../fixtures/indexed-db";

test("the fresh dataset never adopts the old replica or pending writes", async ({ page }) => {
  // The recovery document has the app origin without opening the application's IndexedDB.
  await page.goto("/pwa-recovery.html");
  await page.evaluate(async () => {
    const request = indexedDB.open("transactions-tracker", 4);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("outbox", { keyPath: "mutationId" });
      request.result.createObjectStore("meta");
    };
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const transaction = database.transaction(["outbox", "meta"], "readwrite");
      transaction.objectStore("outbox").put({ mutationId: "legacy-pending-write" });
      transaction.objectStore("meta").put({ ownerUserId: 1 }, "replicaDescriptor");
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });

  await page.goto("/");
  await expect(page.getByTestId("password-auth-username")).toBeVisible();
  await waitForDatabaseVersion(page);
  expect((await readReplicaDescriptor(page)).identity).toBeNull();

  const queued = await page.evaluate(async (currentName) => {
    async function count(databaseName: string): Promise<number> {
      const request = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const rows = database.transaction("outbox", "readonly").objectStore("outbox").count();
        return await new Promise<number>((resolve, reject) => {
          rows.onsuccess = () => resolve(rows.result);
          rows.onerror = () => reject(rows.error);
        });
      } finally {
        database.close();
      }
    }
    return { old: await count("transactions-tracker"), current: await count(currentName) };
  }, DATABASE_NAME);

  expect(queued).toEqual({ old: 1, current: 0 });
});
