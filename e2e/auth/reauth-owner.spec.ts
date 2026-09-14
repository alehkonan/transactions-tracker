import { expect } from "@playwright/test";
import { readReplicaOwnerUserId, type ReplicaDescriptor } from "../fixtures/indexed-db";
import { clearAuthCookies, LOCAL_TRANSACTION_COMMENT, test } from "../fixtures/local-replica";
import type { Page } from "@playwright/test";

type DurableReplicaSnapshot = {
  descriptor: ReplicaDescriptor;
  metadata: Array<{ key: string; value: unknown }>;
  profiles: unknown[];
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  outbox: unknown[];
};

async function signUpThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("password-auth-mode-sign-up").click();
  await page.getByTestId("password-auth-username").fill(username);
  await page.getByTestId("password-auth-password").fill(password);
  await page.getByTestId("password-auth-confirm-password").fill(password);
  await page.getByTestId("password-auth-submit").click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
}

async function readDurableReplicaSnapshot(page: Page): Promise<DurableReplicaSnapshot> {
  return page.evaluate(async () => {
    const request = indexedDB.open("transactions-tracker");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result));
      request.addEventListener("error", () => reject(request.error));
    });

    try {
      const storeNames = ["meta", "profiles", "accounts", "categories", "transactions", "outbox"];
      const transaction = database.transaction(storeNames, "readonly");
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay in the serialized browser closure.
      const read = <T>(idbRequest: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          idbRequest.addEventListener("success", () => resolve(idbRequest.result));
          idbRequest.addEventListener("error", () => reject(idbRequest.error));
        });
      const meta = transaction.objectStore("meta");
      const [metaKeys, metaValues, profiles, accounts, categories, transactions, outbox] =
        await Promise.all([
          read(meta.getAllKeys()),
          read(meta.getAll()),
          read(transaction.objectStore("profiles").getAll()),
          read(transaction.objectStore("accounts").getAll()),
          read(transaction.objectStore("categories").getAll()),
          read(transaction.objectStore("transactions").getAll()),
          read(transaction.objectStore("outbox").getAll()),
        ]);
      const descriptorIndex = metaKeys.indexOf("replicaDescriptor");
      const descriptor = metaValues[descriptorIndex] as ReplicaDescriptor;
      const metadata = metaKeys.flatMap((key, index) =>
        key === "replicaDescriptor" ? [] : [{ key: String(key), value: metaValues[index] }],
      );

      return JSON.parse(
        JSON.stringify({
          descriptor,
          metadata,
          profiles,
          accounts,
          categories,
          transactions,
          outbox,
        }),
      ) as DurableReplicaSnapshot;
    } finally {
      database.close();
    }
  });
}

test("password reauthentication cannot replace replica owner A or its pending obligations with user B", async ({
  localReplicaPage: page,
  authCredentials,
  browser,
  context,
}) => {
  test.setTimeout(60_000);

  const before = await readDurableReplicaSnapshot(page);
  expect(before.outbox).toHaveLength(1);
  expect(before.transactions).toContainEqual(
    expect.objectContaining({ comment: LOCAL_TRANSACTION_COMMENT }),
  );
  const ownerA = await readReplicaOwnerUserId(page);
  const otherContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  const otherPage = await otherContext.newPage();
  const otherUsername = `${authCredentials.username}-other`;

  try {
    await signUpThroughUi(otherPage, otherUsername, authCredentials.password);
    const ownerB = await readReplicaOwnerUserId(otherPage);
    expect(ownerB).not.toBe(ownerA);
  } finally {
    await otherContext.close();
  }

  // Simulate an expired session without using product sign-out, which intentionally deletes the replica.
  await clearAuthCookies(page);
  await context.setOffline(false);
  await page.goto("/login");
  await page.getByTestId("password-auth-username").fill(otherUsername);
  await page.getByTestId("password-auth-password").fill(authCredentials.password);
  await page.getByTestId("password-auth-submit").click();

  await expect(
    page.getByText("Unable to sign in. Check your credentials and try again."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login(?:\?|$)/);

  const after = await readDurableReplicaSnapshot(page);
  expect(after).toEqual({
    ...before,
    descriptor: {
      ...before.descriptor,
      identity: {
        ownerUserId: ownerA,
        replicaId: before.descriptor.replicaId,
        username: authCredentials.username,
      },
      lifecycle: "active",
      syncAuth: "login-required",
      legacyOwnership: { kind: "migrated" },
    },
  });
  const authCookies = (await page.context().cookies()).filter((cookie) =>
    ["access_token", "refresh_token"].includes(cookie.name),
  );
  expect(authCookies).toEqual([]);
});
