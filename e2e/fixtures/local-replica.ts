import { expect } from "@playwright/test";
import { createTransaction, test as authTest } from "./auth";
import type { Page } from "@playwright/test";

const AUTH_COOKIE_NAMES = new Set(["access_token", "refresh_token", "session_hint"]);
export const LOCAL_TRANSACTION_COMMENT = "E2E local-only transaction";

type LocalReplicaFixtures = {
  /** The same browser page and IndexedDB after creating one transaction with the network offline. */
  localReplicaPage: Page;
};

export const test = authTest.extend<LocalReplicaFixtures>({
  localReplicaPage: async ({ onboardedPage: page, context }, use) => {
    await page.goto("/transactions");
    await expect(
      page.getByRole("button", { name: "Add transaction", exact: true }).first(),
    ).toBeVisible();
    await context.setOffline(true);
    await createTransaction(page, LOCAL_TRANSACTION_COMMENT);
    await expect(page.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
    await expect
      .poll(() => readReplicaCounts(page))
      .toMatchObject({
        profiles: 1,
        accounts: 1,
        transactions: 1,
        outbox: 1,
      });

    await use(page);
    await context.setOffline(false);
  },
});

/** Expires the server session without replacing the browser context or touching its IndexedDB. */
export async function clearAuthCookies(page: Page): Promise<void> {
  const context = page.context();
  const cookies = await context.cookies();
  await context.clearCookies();
  await context.addCookies(cookies.filter((cookie) => !AUTH_COOKIE_NAMES.has(cookie.name)));
}

export async function readReplicaCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const request = indexedDB.open("transactions-tracker");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });

    try {
      const stores = ["profiles", "accounts", "transactions", "outbox"];
      const transaction = database.transaction(stores, "readonly");
      const entries = await Promise.all(
        stores.map(
          (store) =>
            new Promise<[string, number]>((resolve, reject) => {
              const count = transaction.objectStore(store).count();
              count.addEventListener("success", () => resolve([store, count.result]));
              count.addEventListener("error", () => reject(count.error));
            }),
        ),
      );
      return Object.fromEntries(entries);
    } finally {
      database.close();
    }
  });
}
