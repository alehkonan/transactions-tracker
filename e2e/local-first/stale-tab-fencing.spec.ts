import { expect } from "@playwright/test";
import { completeOnboarding, test as authTest, waitForSynced } from "../fixtures/auth";
import { LOCAL_TRANSACTION_COMMENT, test } from "../fixtures/local-replica";
import type { BrowserContext, Page, Request, Route } from "@playwright/test";

const DATABASE_NAME = "transactions-tracker";
const SERVER_FUNCTION_PATTERN = "**/_serverFn/**";
const AUTH_COOKIE_NAMES = new Set([
  "access_token",
  "refresh_token",
  "session_hint",
  "profile_hint",
]);
const STALE_ACCOUNT_NAME = "P13 stale account must not commit";
const STALE_TRANSACTION_COMMENT = "P13 stale transaction must not commit";
const STALE_IMPORT_COMMENT = "P13 stale import must not commit";
const STALE_IMPORT_FILE = "p13-stale-import.csv";

const STALE_IMPORT_CSV = [
  "categoryName,comment,outcomeAccountName,outcome,outcomeCurrencyShortTitle,incomeAccountName,income,incomeCurrencyShortTitle,createdDate",
  `,${STALE_IMPORT_COMMENT},E2E Account,7.89,USD,,,,2026-09-14`,
].join("\n");

type ReplicaIdentity = {
  ownerUserId: number;
  replicaId: string;
  username: string;
};

type ReplicaSnapshot = {
  descriptor: {
    replicaId: string;
    identity: ReplicaIdentity | null;
    lifecycle: string;
    syncAuth: string;
    [key: string]: unknown;
  };
  cursors: unknown;
  selectedProfileId: string | null;
  localRevision: number;
  profiles: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
};

type FinancialSnapshot = Pick<
  ReplicaSnapshot,
  "profiles" | "accounts" | "categories" | "transactions" | "outbox"
>;

type ObservedSyncRequest = {
  url: string;
  postData: string;
};

async function readReplica(page: Page): Promise<ReplicaSnapshot> {
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
      const [
        descriptor,
        cursors,
        selectedProfileId,
        localRevision,
        profiles,
        accounts,
        categories,
        transactions,
        outbox,
      ] = await Promise.all([
        read(meta.get("replicaDescriptor")),
        read(meta.get("cursors")),
        read(meta.get("selectedProfileId")),
        read(meta.get("localRevision")),
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
          localRevision: localRevision ?? 0,
          profiles,
          accounts,
          categories,
          transactions,
          outbox,
        }),
      ) as ReplicaSnapshot;
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

function financialSnapshot(snapshot: ReplicaSnapshot): FinancialSnapshot {
  return {
    profiles: snapshot.profiles,
    accounts: snapshot.accounts,
    categories: snapshot.categories,
    transactions: snapshot.transactions,
    outbox: snapshot.outbox,
  };
}

function rowIds(snapshot: ReplicaSnapshot): string[] {
  return [snapshot.profiles, snapshot.accounts, snapshot.categories, snapshot.transactions]
    .flat()
    .flatMap((row) => (typeof row.id === "string" ? [row.id] : []));
}

async function signUpThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByTestId("password-auth-mode-sign-up").click();
  await page.getByTestId("password-auth-username").fill(username);
  await page.getByTestId("password-auth-password").fill(password);
  await page.getByTestId("password-auth-confirm-password").fill(password);
  await page.getByTestId("password-auth-submit").click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
}

async function createOnboardedUser(
  context: BrowserContext,
  username: string,
  password: string,
): Promise<{ page: Page; snapshot: ReplicaSnapshot }> {
  const page = await context.newPage();
  await signUpThroughUi(page, username, password);
  await completeOnboarding(page);
  await waitForSynced(page);
  return { page, snapshot: await readReplica(page) };
}

function observeSyncRequest(request: Request, requests: ObservedSyncRequest[]): void {
  if (request.method() !== "POST") return;
  if (!request.url().includes("/_serverFn/") && !request.url().endsWith("/api/push")) return;
  requests.push({ url: request.url(), postData: request.postData() ?? "" });
}

async function installDroppedSyncBroadcasts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const originalAddEventListener = BroadcastChannel.prototype.addEventListener;
    Object.defineProperty(BroadcastChannel.prototype, "addEventListener", {
      configurable: true,
      value: function (
        this: BroadcastChannel,
        type: string,
        listener: EventListenerOrEventListenerObject,
        options?: boolean | AddEventListenerOptions,
      ) {
        if (this.name === "transactions-tracker:sync" && type === "message") return;
        Reflect.apply(originalAddEventListener, this, [type, listener, options]);
      },
    });
  });
}

async function newStalePage(context: BrowserContext, path: string): Promise<Page> {
  const page = await context.newPage();
  await installDroppedSyncBroadcasts(page);
  await page.goto(path);
  return page;
}

async function holdSignOut(context: BrowserContext): Promise<{
  waitForRequest: () => Promise<void>;
  release: () => void;
  handler: (route: Route) => Promise<void>;
}> {
  let releaseRequest!: () => void;
  let markRequestSeen!: () => void;
  let captured = false;
  const released = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  const requestSeen = new Promise<void>((resolve) => {
    markRequestSeen = resolve;
  });

  const handler = async (route: Route) => {
    const request = route.request();
    const isBodylessPost = request.method() === "POST" && (request.postData() ?? "").length === 0;
    if (!captured && isBodylessPost) {
      captured = true;
      markRequestSeen();
      await released;
      await route.continue();
      return;
    }
    await route.continue();
  };

  await context.route(SERVER_FUNCTION_PATTERN, handler);
  return { waitForRequest: () => requestSeen, release: releaseRequest, handler };
}

async function submitStaleForms(options: {
  accountPage: Page;
  transactionPage: Page;
  importPage: Page;
}): Promise<void> {
  const { accountPage, transactionPage, importPage } = options;
  const accountDialog = accountPage.getByRole("dialog", { name: "Add account" });
  const transactionDialog = transactionPage.getByRole("dialog", { name: "Add transaction" });

  await accountDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(accountDialog).toBeVisible();
  await expect(accountDialog.getByRole("button", { name: "Create", exact: true })).toBeEnabled();

  await transactionDialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(transactionDialog).toContainText("Failed to save transaction. Please try again.");

  await importPage.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    importPage.getByText("The local replica changed while the operation was in progress.", {
      exact: true,
    }),
  ).toBeVisible();
}

test("P11: cookies for B cannot sync, drain, or merge durable replica A through any trigger", async ({
  localReplicaPage: pageA,
  authCredentials,
  browser,
  context,
}) => {
  test.setTimeout(180_000);

  const replicaA = await readReplica(pageA);
  expect(replicaA.outbox).toHaveLength(1);
  expect(replicaA.transactions).toContainEqual(
    expect.objectContaining({ comment: LOCAL_TRANSACTION_COMMENT }),
  );
  const ownerA = replicaA.descriptor.identity?.ownerUserId;
  expect(ownerA).toEqual(expect.any(Number));

  const otherContext = await browser.newContext({ baseURL: new URL(pageA.url()).origin });
  const usernameB = `${authCredentials.username}-p11-b`;
  let replicaB: ReplicaSnapshot;
  let cookiesB;
  try {
    const userB = await createOnboardedUser(otherContext, usernameB, authCredentials.password);
    replicaB = userB.snapshot;
    cookiesB = (await otherContext.cookies()).filter((cookie) =>
      AUTH_COOKIE_NAMES.has(cookie.name),
    );
  } finally {
    await otherContext.close();
  }

  expect(replicaB!.descriptor.identity?.ownerUserId).not.toBe(ownerA);
  expect(cookiesB!).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "access_token" })]),
  );

  await context.clearCookies();
  await context.addCookies(cookiesB!);
  await pageA.close({ runBeforeUnload: false });
  await context.setOffline(false);

  const syncRequests: ObservedSyncRequest[] = [];
  const responseStatuses: number[] = [];
  const onRequest = (request: Request) => observeSyncRequest(request, syncRequests);
  context.on("request", onRequest);
  context.on("response", (response) => {
    if (response.request().method() === "POST" && response.url().includes("/_serverFn/")) {
      responseStatuses.push(response.status());
    }
  });

  const mismatchedPage = await context.newPage();
  await mismatchedPage.goto("/transactions");
  await expect(mismatchedPage.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
  await expect
    .poll(async () => (await readReplica(mismatchedPage)).descriptor.syncAuth)
    .toBe("owner-mismatch");
  await expect(mismatchedPage.getByRole("button", { name: /^Sign in to sync\./ })).toBeVisible();
  expect(responseStatuses).toContain(409);

  const requestsAfterMismatch = syncRequests.length;
  expect(requestsAfterMismatch).toBeGreaterThan(0);

  await mismatchedPage.getByRole("button", { name: /^Sign in to sync\./ }).click();
  await expect(mismatchedPage).toHaveURL(/\/login(?:\?|$)/);
  expect(syncRequests).toHaveLength(requestsAfterMismatch);

  await mismatchedPage.goBack();
  await expect(mismatchedPage.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
  await mismatchedPage.reload();
  await expect(mismatchedPage.getByText(LOCAL_TRANSACTION_COMMENT, { exact: false })).toBeVisible();
  expect(syncRequests).toHaveLength(requestsAfterMismatch);

  await mismatchedPage.evaluate(() => window.dispatchEvent(new Event("online")));
  await mismatchedPage.waitForTimeout(500);
  expect(syncRequests).toHaveLength(requestsAfterMismatch);

  await mismatchedPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await mismatchedPage.waitForTimeout(500);
  expect(syncRequests).toHaveLength(requestsAfterMismatch);

  await mismatchedPage.waitForTimeout(61_500);
  expect(syncRequests).toHaveLength(requestsAfterMismatch);

  const afterAllTriggers = await readReplica(mismatchedPage);
  expect(afterAllTriggers.descriptor).toEqual({
    ...replicaA.descriptor,
    syncAuth: "owner-mismatch",
  });
  expect(afterAllTriggers.cursors).toEqual(replicaA.cursors);
  expect(afterAllTriggers.selectedProfileId).toBe(replicaA.selectedProfileId);
  expect(afterAllTriggers.localRevision).toBe(replicaA.localRevision);
  expect(financialSnapshot(afterAllTriggers)).toEqual(financialSnapshot(replicaA));

  const idsFromB = rowIds(replicaB!);
  const idsAfterAllTriggers = rowIds(afterAllTriggers);
  expect(idsFromB.length).toBeGreaterThan(0);
  for (const id of idsFromB) expect(idsAfterAllTriggers).not.toContain(id);

  const obligationIdentifiers = replicaA.outbox.flatMap((entry) =>
    [entry.mutationId, entry.rowId].filter((value): value is string => typeof value === "string"),
  );
  expect(obligationIdentifiers.length).toBeGreaterThan(0);
  for (const request of syncRequests) {
    for (const identifier of obligationIdentifiers) {
      expect(
        request.postData,
        `sync request ${request.url} exposed A obligation ${identifier} under B cookies`,
      ).not.toContain(identifier);
    }
  }
});

authTest(
  "P13: transition and replacement fence stale account, transaction, and import actions",
  async ({ onboardedPage: activePage, authCredentials, context }) => {
    authTest.setTimeout(150_000);

    await activePage.goto("/transactions");
    await waitForSynced(activePage);
    const replicaA = await readReplica(activePage);
    expect(replicaA.outbox).toEqual([]);

    const accountPage = await newStalePage(context, "/accounts");
    await accountPage.getByRole("button", { name: "Add account", exact: true }).click();
    const accountDialog = accountPage.getByRole("dialog", { name: "Add account" });
    await accountDialog.getByLabel("Name").fill(STALE_ACCOUNT_NAME);

    const transactionPage = await newStalePage(context, "/transactions");
    await transactionPage
      .getByRole("button", { name: "Add transaction", exact: true })
      .first()
      .click();
    const transactionDialog = transactionPage.getByRole("dialog", { name: "Add transaction" });
    await transactionDialog.getByLabel("Account").selectOption({ label: "E2E Account (USD)" });
    await transactionDialog.getByLabel("Amount").fill("4.56");
    await transactionDialog.getByLabel("Comment").fill(STALE_TRANSACTION_COMMENT);

    const importPage = await newStalePage(context, "/transactions-import");
    await importPage.locator('input[type="file"]').setInputFiles({
      name: STALE_IMPORT_FILE,
      mimeType: "text/csv",
      buffer: Buffer.from(STALE_IMPORT_CSV),
    });
    await expect(importPage.getByText(STALE_IMPORT_FILE, { exact: true })).toBeVisible();
    await expect(importPage.getByRole("button", { name: "Next", exact: true })).toBeEnabled();

    const signOutHold = await holdSignOut(context);
    await activePage.goto("/settings");
    await activePage.getByRole("button", { name: "Sign out", exact: true }).click();
    const confirmation = activePage.getByRole("dialog", { name: "Sign out on this device" });
    await confirmation.getByRole("button", { name: "Sign out", exact: true }).click();
    await signOutHold.waitForRequest();

    await expect
      .poll(async () => (await readReplica(accountPage)).descriptor.lifecycle)
      .toBe("transitioning");
    const transitioning = await readReplica(accountPage);
    await submitStaleForms({ accountPage, transactionPage, importPage });
    expect(financialSnapshot(await readReplica(accountPage))).toEqual(
      financialSnapshot(transitioning),
    );

    signOutHold.release();
    await expect(activePage).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
    await context.unroute(SERVER_FUNCTION_PATTERN, signOutHold.handler);

    const replacement = await readReplica(activePage);
    expect(replacement.descriptor.replicaId).not.toBe(replicaA.descriptor.replicaId);
    expect(financialSnapshot(replacement)).toEqual({
      profiles: [],
      accounts: [],
      categories: [],
      transactions: [],
      outbox: [],
    });

    const usernameB = `${authCredentials.username}-p13-b`;
    await signUpThroughUi(activePage, usernameB, authCredentials.password);
    await completeOnboarding(activePage);
    await waitForSynced(activePage);
    const replicaB = await readReplica(activePage);
    expect(replicaB.descriptor.replicaId).toBe(replacement.descriptor.replicaId);
    expect(replicaB.descriptor.identity?.ownerUserId).not.toBe(
      replicaA.descriptor.identity?.ownerUserId,
    );
    expect(replicaB.outbox).toEqual([]);

    await submitStaleForms({ accountPage, transactionPage, importPage });
    const afterReplacementActions = await readReplica(activePage);
    expect(financialSnapshot(afterReplacementActions)).toEqual(financialSnapshot(replicaB));
    expect(afterReplacementActions.accounts).not.toContainEqual(
      expect.objectContaining({ name: STALE_ACCOUNT_NAME }),
    );
    expect(afterReplacementActions.transactions).not.toContainEqual(
      expect.objectContaining({ comment: STALE_TRANSACTION_COMMENT }),
    );
    expect(afterReplacementActions.transactions).not.toContainEqual(
      expect.objectContaining({ comment: STALE_IMPORT_COMMENT }),
    );

    await accountPage.bringToFront();
    await accountPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(accountDialog).not.toBeVisible();
    await expect(accountPage.getByText(STALE_ACCOUNT_NAME, { exact: true })).toHaveCount(0);

    await transactionPage.bringToFront();
    await transactionPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(transactionDialog).not.toBeVisible();
    await expect(
      transactionPage.getByText(STALE_TRANSACTION_COMMENT, { exact: false }),
    ).toHaveCount(0);

    await importPage.bringToFront();
    await importPage.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
    await expect(importPage.locator('input[type="file"]')).toHaveValue("");
    await expect(importPage.getByText(STALE_IMPORT_FILE, { exact: true })).toHaveCount(0);
    expect(financialSnapshot(await readReplica(importPage))).toEqual(financialSnapshot(replicaB));
  },
);
