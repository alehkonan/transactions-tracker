import { expect } from "@playwright/test";
import { LOCAL_TRANSACTION_COMMENT, clearAuthCookies, test } from "../fixtures/local-replica";
import type { Page } from "@playwright/test";

const PENDING_ACCOUNT_NAME = "E2E Account pending reauthentication";
const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type RawRow = {
  id: string;
  updatedAt: string;
  deletedAt: string | null;
  [key: string]: unknown;
};

type RawOutboxEntry = {
  seq: number;
  mutationId: string;
  table: string;
  op: string;
  rowId: string;
  baseUpdatedAt: number | null;
  payload?: Record<string, unknown>;
};

type RawReplicaState = {
  descriptor: {
    replicaId: string;
    identity: { ownerUserId: number; replicaId: string; username: string } | null;
    lifecycle: string;
    syncAuth: string;
    legacyOwnership: unknown;
  };
  cursors: Record<string, { updatedAt: string; id: string | null }>;
  selectedProfileId: string | null;
  profiles: RawRow[];
  accounts: RawRow[];
  categories: RawRow[];
  transactions: RawRow[];
  outbox: RawOutboxEntry[];
};

async function queueAccountEditThroughUi(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole("button", { name: /^Edit E2E Account\./ }).click();

  const dialog = page.getByRole("dialog", { name: "Edit account" });
  await dialog.getByLabel("Name").fill(PENDING_ACCOUNT_NAME);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(PENDING_ACCOUNT_NAME, { exact: true })).toBeVisible();
}

async function readRawReplicaState(page: Page): Promise<RawReplicaState> {
  return page.evaluate(async () => {
    const openRequest = indexedDB.open("transactions-tracker");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      const transaction = database.transaction(
        ["profiles", "accounts", "categories", "transactions", "outbox", "meta"],
        "readonly",
      );
      const meta = transaction.objectStore("meta");
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay in the serialized browser closure.
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      const [
        descriptor,
        cursors,
        selectedProfileId,
        profiles,
        accounts,
        categories,
        transactions,
        outbox,
      ] = await Promise.all([
        read(meta.get("replicaDescriptor")),
        read(meta.get("cursors")),
        read(meta.get("selectedProfileId")),
        read(transaction.objectStore("profiles").getAll()),
        read(transaction.objectStore("accounts").getAll()),
        read(transaction.objectStore("categories").getAll()),
        read(transaction.objectStore("transactions").getAll()),
        read(transaction.objectStore("outbox").getAll()),
      ]);

      return JSON.parse(
        JSON.stringify({
          descriptor,
          cursors,
          selectedProfileId: selectedProfileId ?? null,
          profiles,
          accounts,
          categories,
          transactions,
          outbox,
        }),
      ) as RawReplicaState;
    } finally {
      database.close();
    }
  });
}

function payloadFromRow(row: RawRow): Record<string, unknown> {
  const { id: _id, updatedAt: _updatedAt, deletedAt: _deletedAt, ...payload } = row;
  return payload;
}

function expectExactPendingObligations(state: RawReplicaState, username: string): void {
  expect(state.profiles).toHaveLength(1);
  expect(state.accounts).toHaveLength(1);
  expect(state.categories).toEqual([]);
  expect(state.transactions).toHaveLength(1);
  expect(Object.keys(state.cursors).length).toBeGreaterThan(0);
  for (const cursor of Object.values(state.cursors)) {
    expect(cursor).toEqual({ updatedAt: expect.any(String), id: null });
    expect(cursor.updatedAt).not.toBe("");
  }

  const profile = state.profiles[0];
  const account = state.accounts[0];
  const transaction = state.transactions.find((row) => row.comment === LOCAL_TRANSACTION_COMMENT);
  expect(transaction).toBeDefined();
  if (!transaction) throw new Error("The local transaction created through the UI is missing.");

  const ownerUserId = state.descriptor.identity?.ownerUserId;
  expect(ownerUserId).toEqual(expect.any(Number));
  expect(state.descriptor).toEqual({
    replicaId: state.descriptor.replicaId,
    identity: {
      ownerUserId,
      replicaId: state.descriptor.replicaId,
      username,
    },
    lifecycle: "active",
    syncAuth: "authenticated",
    legacyOwnership: { kind: "migrated" },
  });
  expect(profile.userId).toBe(ownerUserId);
  expect(state.selectedProfileId).toBe(profile.id);
  expect(account).toMatchObject({
    name: PENDING_ACCOUNT_NAME,
    profileId: profile.id,
    deletedAt: null,
  });
  expect(transaction).toMatchObject({
    accountId: account.id,
    amount: "-12.34",
    categoryId: null,
    comment: LOCAL_TRANSACTION_COMMENT,
    deletedAt: null,
    necessityLevel: "MEDIUM",
    profileId: profile.id,
    type: "EXPENSE",
  });

  const [transactionMutation, accountMutation] = state.outbox;
  expect(transactionMutation?.seq).toEqual(expect.any(Number));
  expect(accountMutation?.seq).toBe(transactionMutation.seq + 1);
  expect(transactionMutation.mutationId).toMatch(UUID_V7_PATTERN);
  expect(accountMutation.mutationId).toMatch(UUID_V7_PATTERN);
  expect(transactionMutation.mutationId).not.toBe(accountMutation.mutationId);
  expect(state.outbox).toEqual([
    {
      seq: transactionMutation.seq,
      mutationId: transactionMutation.mutationId,
      table: "transactions",
      op: "upsert",
      rowId: transaction.id,
      baseUpdatedAt: null,
      payload: payloadFromRow(transaction),
    },
    {
      seq: accountMutation.seq,
      mutationId: accountMutation.mutationId,
      table: "accounts",
      op: "upsert",
      rowId: account.id,
      baseUpdatedAt: Date.parse(account.updatedAt),
      payload: payloadFromRow(account),
    },
  ]);
}

function expectPreservedReplica(
  before: RawReplicaState,
  after: RawReplicaState,
  syncAuth: "authenticated" | "login-required",
): void {
  expect(after).toEqual({
    ...before,
    descriptor: { ...before.descriptor, syncAuth },
  });
}

test.describe("local-first startup and reauthentication", () => {
  test("an expired session keeps the existing local replica and exact outbox open", async ({
    authCredentials,
    localReplicaPage: page,
    context,
  }) => {
    await queueAccountEditThroughUi(page);
    const before = await readRawReplicaState(page);
    expectExactPendingObligations(before, authCredentials.username);

    await clearAuthCookies(page);
    await context.setOffline(false);
    await page.goto("/transactions");

    await expect(page).toHaveURL(/\/transactions$/);
    await expect(page.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
    await expect
      .poll(async () => (await readRawReplicaState(page)).descriptor.syncAuth)
      .toBe("login-required");
    expectPreservedReplica(before, await readRawReplicaState(page), "login-required");
  });

  test("same-user reauthentication preserves the exact replica and pending outbox", async ({
    authCredentials,
    localReplicaPage: page,
    context,
  }) => {
    await queueAccountEditThroughUi(page);
    const before = await readRawReplicaState(page);
    expectExactPendingObligations(before, authCredentials.username);

    await clearAuthCookies(page);
    await context.setOffline(false);
    await page.goto("/transactions");
    await expect(page.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
    await expect
      .poll(async () => (await readRawReplicaState(page)).descriptor.syncAuth)
      .toBe("login-required");
    expectPreservedReplica(before, await readRawReplicaState(page), "login-required");

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
    expectPreservedReplica(before, await readRawReplicaState(page), "login-required");

    await page.getByTestId("password-auth-username").fill(authCredentials.username);
    await page.getByTestId("password-auth-password").fill(authCredentials.password);
    await page.getByTestId("password-auth-submit").click();
    await expect(page).not.toHaveURL(/\/login$/, { timeout: 30_000 });
    await context.setOffline(true);
    await expect
      .poll(() =>
        page.evaluate(() => Number(sessionStorage.getItem("e2e-delete-database-calls") ?? "0")),
      )
      .toBe(0);

    await page.close();
    const reopenedPage = await context.newPage();
    await reopenedPage.goto("/profile");
    await expect(reopenedPage.getByText("E2E Profile", { exact: true })).toBeVisible();
    await expect
      .poll(async () => (await readRawReplicaState(reopenedPage)).descriptor.syncAuth)
      .toBe("authenticated");
    expectPreservedReplica(before, await readRawReplicaState(reopenedPage), "authenticated");
  });
});
