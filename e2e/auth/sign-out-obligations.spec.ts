import { expect } from "@playwright/test";
import { completeOnboarding } from "../fixtures/auth";
import { LOCAL_TRANSACTION_COMMENT, test } from "../fixtures/local-replica";
import type { BrowserContext, Page, Route } from "@playwright/test";

const DATABASE_NAME = "transactions-tracker";
const DRAFT_FILE_NAME = "pending-import-draft.csv";
const SERVER_FUNCTION_PATTERN = "**/_serverFn/**";
const FINANCIAL_STORES = ["profiles", "accounts", "categories", "transactions"] as const;

const DRAFT_CSV = [
  "categoryName,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle,createdDate",
  ",Draft transaction,E2E Account,1,USD,,,,2026-09-14",
].join("\n");

type ReplicaSnapshot = {
  descriptor: {
    replicaId: string;
    identity: { ownerUserId: number; replicaId: string; username: string } | null;
    lifecycle: "active" | "transitioning" | "signed-out";
    syncAuth?: "unknown" | "authenticated" | "login-required" | "owner-mismatch";
    legacyOwnership: unknown;
  };
  profiles: unknown[];
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  outbox: unknown[];
};

type ServerFunctionBarrier = {
  failBodylessPosts: boolean;
  bodylessPostAttempts: number;
  blockedSyncAttempts: number;
};

async function readReplicaSnapshot(page: Page): Promise<ReplicaSnapshot> {
  return page.evaluate(async (databaseName) => {
    const openRequest = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      const transaction = database.transaction(
        ["meta", "profiles", "accounts", "categories", "transactions", "outbox"],
        "readonly",
      );
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay in the serialized browser closure.
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      const meta = transaction.objectStore("meta");
      const [descriptor, profiles, accounts, categories, transactions, outbox] = await Promise.all([
        read(meta.get("replicaDescriptor")),
        read(transaction.objectStore("profiles").getAll()),
        read(transaction.objectStore("accounts").getAll()),
        read(transaction.objectStore("categories").getAll()),
        read(transaction.objectStore("transactions").getAll()),
        read(transaction.objectStore("outbox").getAll()),
      ]);

      return JSON.parse(
        JSON.stringify({ descriptor, profiles, accounts, categories, transactions, outbox }),
      ) as ReplicaSnapshot;
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

async function duplicateDurableOutboxEntry(page: Page): Promise<void> {
  await page.evaluate(async (databaseName) => {
    const openRequest = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction("outbox", "readwrite");
        const outbox = transaction.objectStore("outbox");
        const entriesRequest = outbox.getAll();

        entriesRequest.addEventListener("success", () => {
          const first = entriesRequest.result[0] as Record<string, unknown> | undefined;
          if (!first) {
            transaction.abort();
            reject(
              new Error("Expected the local authenticated fixture to contain an outbox entry."),
            );
            return;
          }

          const duplicate = structuredClone(first);
          delete duplicate.seq;
          duplicate.mutationId = crypto.randomUUID();
          outbox.add(duplicate);
        });
        entriesRequest.addEventListener("error", () => reject(entriesRequest.error));
        transaction.addEventListener("complete", () => resolve());
        transaction.addEventListener("error", () => reject(transaction.error));
        transaction.addEventListener("abort", () => reject(transaction.error));
      });
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

async function installServerFunctionBarrier(
  context: BrowserContext,
  state: ServerFunctionBarrier,
): Promise<(route: Route) => Promise<void>> {
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") {
      await route.continue();
      return;
    }

    const hasBody = (request.postData() ?? "").length > 0;
    if (hasBody) {
      state.blockedSyncAttempts += 1;
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Sync unavailable in test",
      });
      return;
    }

    state.bodylessPostAttempts += 1;
    if (state.failBodylessPosts) {
      await route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Sign-out unavailable in test",
      });
      return;
    }

    await route.continue();
  };

  await context.route(SERVER_FUNCTION_PATTERN, handler);
  return handler;
}

async function openSignOutConfirmation(page: Page) {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Unsynced changes will be lost" });
  await expect(confirmation).toBeVisible();
  return confirmation;
}

async function signUpThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.getByTestId("password-auth-mode-sign-up").click();
  await page.getByTestId("password-auth-username").fill(username);
  await page.getByTestId("password-auth-password").fill(password);
  await page.getByTestId("password-auth-confirm-password").fill(password);
  await page.getByTestId("password-auth-submit").click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
}

test("warns from the durable outbox and exposes server sign-out failure without discarding the replica", async ({
  localReplicaPage: page,
  context,
}) => {
  test.setTimeout(90_000);

  const barrier: ServerFunctionBarrier = {
    failBodylessPosts: false,
    bodylessPostAttempts: 0,
    blockedSyncAttempts: 0,
  };
  await installServerFunctionBarrier(context, barrier);
  await context.setOffline(false);
  await page.goto("/settings");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();

  // Change IndexedDB behind the hydrated UI. The confirmation must read the durable queue, not the
  // visible Zustand count that was hydrated before this second entry existed.
  await duplicateDurableOutboxEntry(page);
  const before = await readReplicaSnapshot(page);
  expect(before.outbox).toHaveLength(2);
  expect(before.transactions).toContainEqual(
    expect.objectContaining({ comment: LOCAL_TRANSACTION_COMMENT }),
  );

  const confirmation = await openSignOutConfirmation(page);
  await expect(confirmation).toContainText(
    "2 unsynced changes exist only on this device. Signing out now permanently removes them along with the local copy.",
  );

  barrier.failBodylessPosts = true;
  await confirmation.getByRole("button", { name: "Sign out anyway", exact: true }).click();

  await expect(
    page.getByText("Could not sign out. Your local data remains on this device.", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  expect(barrier.bodylessPostAttempts).toBeGreaterThan(0);

  const after = await readReplicaSnapshot(page);
  expect(after.profiles).toEqual(before.profiles);
  expect(after.accounts).toEqual(before.accounts);
  expect(after.categories).toEqual(before.categories);
  expect(after.transactions).toEqual(before.transactions);
  expect(after.outbox).toEqual(before.outbox);
  expect(after.descriptor.identity).toEqual(before.descriptor.identity);
  expect(after.descriptor.replicaId).toBe(before.descriptor.replicaId);
  expect(after.descriptor.lifecycle).toBe("active");
  expect(after.descriptor.syncAuth).toBe("login-required");
});

test("successful sign-out clears financial rows, import draft, and outbox before the next user", async ({
  localReplicaPage: page,
  authCredentials,
  context,
}) => {
  test.setTimeout(120_000);

  const barrier: ServerFunctionBarrier = {
    failBodylessPosts: false,
    bodylessPostAttempts: 0,
    blockedSyncAttempts: 0,
  };
  const routeHandler = await installServerFunctionBarrier(context, barrier);
  await context.setOffline(false);
  await page.goto("/transactions-import");

  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: DRAFT_FILE_NAME,
    mimeType: "text/csv",
    buffer: Buffer.from(DRAFT_CSV),
  });
  await expect(page.getByText(DRAFT_FILE_NAME, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeEnabled();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);

  const before = await readReplicaSnapshot(page);
  expect(before.outbox).toHaveLength(1);
  expect(before.transactions).toContainEqual(
    expect.objectContaining({ comment: LOCAL_TRANSACTION_COMMENT }),
  );

  const confirmation = await openSignOutConfirmation(page);
  await expect(confirmation).toContainText(
    "1 unsynced change exist only on this device. Signing out now permanently removes them along with the local copy.",
  );
  await confirmation.getByRole("button", { name: "Sign out anyway", exact: true }).click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
  expect(barrier.bodylessPostAttempts).toBeGreaterThan(0);

  const cleared = await readReplicaSnapshot(page);
  for (const store of FINANCIAL_STORES) expect(cleared[store]).toEqual([]);
  expect(cleared.outbox).toEqual([]);
  expect(cleared.descriptor.identity).toBeNull();
  expect(cleared.descriptor.lifecycle).toBe("active");
  expect(cleared.descriptor.replicaId).not.toBe(before.descriptor.replicaId);

  await context.unroute(SERVER_FUNCTION_PATTERN, routeHandler);
  const nextUsername = `${authCredentials.username}-next`;
  await signUpThroughUi(page, nextUsername, authCredentials.password);
  await completeOnboarding(page);

  await page.getByRole("link", { name: "Transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);
  await expect(page.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toHaveCount(0);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: "Import transactions", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions-import$/);
  await expect(page.getByText(DRAFT_FILE_NAME, { exact: true })).toHaveCount(0);
  await expect(page.locator('input[type="file"]')).toHaveValue("");
  await expect(page.getByRole("button", { name: "Next", exact: true })).toBeDisabled();
});
