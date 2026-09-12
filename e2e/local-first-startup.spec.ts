import { expect } from "@playwright/test";
import {
  LOCAL_TRANSACTION_COMMENT,
  clearAuthCookies,
  readReplicaCounts,
  test,
} from "./fixtures/local-replica";

const EXPECTED_REPLICA_COUNTS = {
  profiles: 1,
  accounts: 1,
  transactions: 1,
  outbox: 1,
};

async function readReplicaDescriptor(
  page: import("@playwright/test").Page,
): Promise<{ lifecycle?: string; syncAuth?: string } | undefined> {
  return page.evaluate(async () => {
    const request = indexedDB.open("transactions-tracker");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });
    try {
      const descriptorRequest = database
        .transaction("meta", "readonly")
        .objectStore("meta")
        .get("replicaDescriptor");
      return await new Promise<{ lifecycle?: string; syncAuth?: string } | undefined>(
        (resolve, reject) => {
          descriptorRequest.addEventListener("success", () => resolve(descriptorRequest.result));
          descriptorRequest.addEventListener("error", () => reject(descriptorRequest.error));
        },
      );
    } finally {
      database.close();
    }
  });
}

test.describe("local-first startup and reauthentication", () => {
  test("an expired session keeps the existing local replica open", async ({
    localReplicaPage: page,
    context,
  }) => {
    await clearAuthCookies(page);
    await context.setOffline(false);

    await page.goto("/transactions");

    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
    await expect.poll(() => readReplicaCounts(page)).toMatchObject(EXPECTED_REPLICA_COUNTS);
  });

  test("same-user reauthentication preserves rows and the pending outbox", async ({
    authCredentials,
    localReplicaPage: page,
    context,
  }) => {
    await clearAuthCookies(page);
    await context.setOffline(false);
    await page.addInitScript(() => {
      const factoryPrototype = Object.getPrototypeOf(indexedDB) as IDBFactory;
      const originalDeleteDatabase = factoryPrototype.deleteDatabase;
      Object.defineProperty(factoryPrototype, "deleteDatabase", {
        configurable: true,
        value(this: IDBFactory, name: string) {
          const calls = Number(sessionStorage.getItem("e2e-delete-database-calls") ?? "0");
          sessionStorage.setItem("e2e-delete-database-calls", String(calls + 1));
          return originalDeleteDatabase.call(this, name);
        },
      });
      sessionStorage.setItem("e2e-delete-database-observer", "installed");
    });
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem("e2e-delete-database-observer")))
      .toBe("installed");

    await page.getByTestId("password-auth-username").fill(authCredentials.username);
    await page.getByTestId("password-auth-password").fill(authCredentials.password);
    await page.getByTestId("password-auth-submit").click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
    await expect
      .poll(() =>
        page.evaluate(() => Number(sessionStorage.getItem("e2e-delete-database-calls") ?? "0")),
      )
      .toBe(0);

    // The current delete can be blocked by an open IDB connection and still report success. Closing
    // the document releases it while keeping the same browser context and origin storage.
    await page.close();
    const reopenedPage = await context.newPage();
    await reopenedPage.goto("/profile");
    await expect.poll(() => readReplicaCounts(reopenedPage)).toMatchObject(EXPECTED_REPLICA_COUNTS);
    await expect
      .poll(async () => (await readReplicaDescriptor(reopenedPage))?.syncAuth)
      .toBe("authenticated");
  });
});
