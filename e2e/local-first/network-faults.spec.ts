import { expect } from "@playwright/test";
import {
  E2E_ACCOUNT_NAME,
  createTransaction,
  test as authTest,
  waitForSynced,
} from "../fixtures/auth";
import { FaultProxy, startFaultProxy } from "../fixtures/fault-proxy";
import type { Page } from "@playwright/test";

const PREVIEW_ORIGIN = "http://localhost:5455";
const PROXY_PORT = 5456;
const PROXY_ORIGIN = `http://localhost:${PROXY_PORT}`;
const DATABASE_NAME = "transactions-tracker";
const STALE_CURSOR = "2000-01-01T00:00:00.000Z";
const SERVER_FUNCTION = { pathname: /^\/_serverFn\// } as const;

const test = authTest.extend<{}, { faultProxy: FaultProxy }>({
  faultProxy: [
    // oxlint-disable-next-line no-empty-pattern -- Playwright worker fixtures require an object destructuring first parameter.
    async ({}, use) => {
      const proxy = await startFaultProxy({ upstream: PREVIEW_ORIGIN, port: PROXY_PORT });
      try {
        await use(proxy);
      } finally {
        await proxy.close();
      }
    },
    { scope: "worker", auto: true },
  ],
});

test.use({ baseURL: PROXY_ORIGIN });
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeEach(({ faultProxy }) => {
  faultProxy.reset();
});

test.afterEach(({ faultProxy }) => {
  faultProxy.reset();
});

type ReplicaSnapshot = {
  descriptor: {
    replicaId: string;
    identity: { ownerUserId: number; replicaId: string; username: string } | null;
    lifecycle: string;
    syncAuth: string;
    legacyOwnership: unknown;
  };
  cursors: Record<string, { updatedAt: string; id: string | null }>;
  selectedProfileId: string | null;
  localRevision: number;
  lastSyncedAt: number | null;
  profiles: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
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
        localRevision,
        lastSyncedAt,
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
        read(meta.get("lastSyncedAt")),
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
          lastSyncedAt: lastSyncedAt ?? null,
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

async function makeCursorsStale(page: Page): Promise<void> {
  await page.evaluate(
    async ({ databaseName, staleCursor }) => {
      const openRequest = indexedDB.open(databaseName);
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        openRequest.addEventListener("success", () => resolve(openRequest.result));
        openRequest.addEventListener("error", () => reject(openRequest.error));
      });

      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = database.transaction("meta", "readwrite");
          const meta = transaction.objectStore("meta");
          const cursorsRequest = meta.get("cursors");
          cursorsRequest.addEventListener("success", () => {
            const cursors = structuredClone(
              cursorsRequest.result as Record<string, { updatedAt: string; id: string | null }>,
            );
            for (const cursor of Object.values(cursors)) cursor.updatedAt = staleCursor;
            meta.put(cursors, "cursors");
          });
          cursorsRequest.addEventListener("error", () => reject(cursorsRequest.error));
          transaction.addEventListener("complete", () => resolve());
          transaction.addEventListener("error", () => reject(transaction.error));
          transaction.addEventListener("abort", () => reject(transaction.error));
        });
      } finally {
        database.close();
      }
    },
    { databaseName: DATABASE_NAME, staleCursor: STALE_CURSOR },
  );
}

async function ensureControlledReplica(page: Page): Promise<void> {
  await page.goto("/accounts");
  await waitForSynced(page);
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Service worker did not become ready.")), 10_000),
      ),
    ]);
  });

  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) {
    await page.reload();
    await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
  }

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null))
    .toBe(true);
  await page.evaluate(async () => {
    const controller = navigator.serviceWorker.controller;
    if (!controller) throw new Error("The cached-navigation test has no controlling worker.");
    const source = await fetch(controller.scriptURL).then((response) => response.text());
    const buildId = /const BUILD_ID = ([^;]+);/.exec(source)?.[1]?.replaceAll('"', "");
    if (!buildId) throw new Error("The controlling worker has no build ID.");
    const cacheNames = await caches.keys();
    if (!cacheNames.includes(`transactions-tracker-${buildId}`)) {
      throw new Error(`No complete cache exists for controlling build ${buildId}.`);
    }
  });
}

async function editAccountName(page: Page, currentName: string, nextName: string): Promise<void> {
  if (!page.url().endsWith("/accounts")) {
    await page.getByRole("link", { name: "Accounts" }).click();
    await expect(page).toHaveURL(/\/accounts$/);
  }
  await page
    .getByRole("button", { name: new RegExp(`^Edit ${escapeRegExp(currentName)}`) })
    .click();
  const dialog = page.getByRole("dialog", { name: "Edit account" });
  await dialog.getByLabel("Name").fill(nextName);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText(nextName, { exact: true })).toBeVisible();
}

function expectSameDurableReplica(before: ReplicaSnapshot, after: ReplicaSnapshot): void {
  expect(after).toEqual(before);
}

function expectOnlySyncAuthChanged(
  before: ReplicaSnapshot,
  after: ReplicaSnapshot,
  syncAuth: string,
): void {
  expect(after).toEqual({
    ...before,
    descriptor: { ...before.descriptor, syncAuth },
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("P02: a controlled cached navigation stays local during a 15s upstream document hold", async ({
  onboardedPage: page,
  faultProxy,
}) => {
  await ensureControlledReplica(page);

  const documentHold = faultProxy.hold(
    {
      method: "GET",
      pathname: "/accounts",
      header: { name: "accept", value: "text/html" },
    },
    { name: "P02-document-hold", autoReleaseMs: 15_000 },
  );
  const probeStartedAt = Date.now();
  let probeSettled = false;
  const upstreamProbe = fetch(`${faultProxy.origin}/accounts?upstream-document-probe=P02`, {
    headers: { accept: "text/html" },
  }).finally(() => {
    probeSettled = true;
  });

  await documentHold.waitForHits();
  expect(documentHold.pendingCount).toBe(1);

  const navigationStartedAt = Date.now();
  await page.goto("/accounts?cached-navigation=P02", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();

  expect(Date.now() - navigationStartedAt).toBeLessThan(1_500);
  expect(probeSettled).toBe(false);
  expect(documentHold.hitCount, "the controlled navigation must not reach the upstream proxy").toBe(
    1,
  );
  expect(documentHold.pendingCount).toBe(1);

  const probeResponse = await upstreamProbe;
  expect(probeResponse.status).toBe(200);
  expect(Date.now() - probeStartedAt).toBeGreaterThanOrEqual(14_500);
  await documentHold.waitForCompletions();
});

test("P03: a local edit commits while boot sync is held for 15s", async ({
  onboardedPage: page,
  faultProxy,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);

  const syncHold = faultProxy.hold(SERVER_FUNCTION, {
    name: "P03-sync-hold",
    times: 1,
    autoReleaseMs: 15_000,
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await syncHold.waitForHits();
  const heldAt = Date.now();

  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
  const editedName = "P03 edit saved during held sync";
  await editAccountName(page, E2E_ACCOUNT_NAME, editedName);
  const duringHold = await readReplica(page);

  expect(duringHold.accounts).toContainEqual(expect.objectContaining({ name: editedName }));
  expect(duringHold.outbox).toHaveLength(1);
  expect(syncHold.pendingCount).toBe(1);
  expect(syncHold.completionCount).toBe(0);

  await syncHold.waitForCompletions(1, 20_000);
  expect(Date.now() - heldAt).toBeGreaterThanOrEqual(14_500);
});

test("P06: a real post-boot 401 preserves the queue and closes every automatic retry path", async ({
  onboardedPage: page,
  faultProxy,
}) => {
  await page.goto("/transactions");
  await waitForSynced(page);

  const unauthorized = faultProxy.respond(SERVER_FUNCTION, {
    name: "P06-sync-401",
    status: 401,
    body: "Authentication is required.",
  });
  await createTransaction(page, "P06 queued before 401");
  const before401 = await readReplica(page);
  await unauthorized.waitForHits();
  await unauthorized.waitForCompletions();

  await expect(page.getByRole("button", { name: /^Sign in to sync\./ })).toBeVisible();
  expectOnlySyncAuthChanged(before401, await readReplica(page), "login-required");
  expect(unauthorized.hitCount).toBe(1);

  await createTransaction(page, "P06 edit after 401");
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(61_500);

  expect(unauthorized.hitCount, "edit, online and the one-minute timer must stay auth-paused").toBe(
    1,
  );
  const afterTriggers = await readReplica(page);
  expect(afterTriggers.outbox).toHaveLength(before401.outbox.length + 1);
  expect(afterTriggers.descriptor.syncAuth).toBe("login-required");
  expect(afterTriggers.transactions).toContainEqual(
    expect.objectContaining({ comment: "P06 queued before 401" }),
  );
  expect(afterTriggers.transactions).toContainEqual(
    expect.objectContaining({ comment: "P06 edit after 401" }),
  );
});

test("P07: 503, timeout/interruption and offline reload preserve rows, outbox and auth admission", async ({
  onboardedPage: page,
  context,
  faultProxy,
}) => {
  await page.goto("/transactions");
  await waitForSynced(page);

  const unavailable = faultProxy.respond(SERVER_FUNCTION, {
    name: "P07-sync-503",
    status: 503,
    headers: { "retry-after": "2" },
    body: "Injected retryable outage.",
  });
  const comment = "P07 durable local transaction";
  await createTransaction(page, comment);
  const locallyCommitted = await readReplica(page);
  await unavailable.waitForHits();
  await unavailable.waitForCompletions();
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();
  expectSameDurableReplica(locallyCommitted, await readReplica(page));
  expect((await readReplica(page)).descriptor.syncAuth).toBe("authenticated");

  unavailable.disable();
  const interrupted = faultProxy.interrupt(SERVER_FUNCTION, {
    name: "P07-sync-interruption",
    delayMs: 100,
  });
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await interrupted.waitForHits();
  await interrupted.waitForCompletions();
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();
  expectSameDurableReplica(locallyCommitted, await readReplica(page));

  interrupted.disable();
  const timedOut = faultProxy.hold(SERVER_FUNCTION, { name: "P07-sync-timeout" });
  await page.getByRole("button", { name: /^1 unsynced/ }).click();
  await timedOut.waitForHits();
  expect(timedOut.pendingCount).toBe(1);
  expectSameDurableReplica(locallyCommitted, await readReplica(page));
  timedOut.interrupt();
  await timedOut.waitForCompletions();
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();
  expectSameDurableReplica(locallyCommitted, await readReplica(page));

  await context.setOffline(true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByText(comment, { exact: false })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByRole("button", { name: /^Offline/ })).toBeVisible();
  expectSameDurableReplica(locallyCommitted, await readReplica(page));
  expect((await readReplica(page)).descriptor.syncAuth).toBe("authenticated");
  await context.setOffline(false);
});

test("P17: a failed stale-cursor full refresh leaves the old replica intact", async ({
  onboardedPage: page,
  faultProxy,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await makeCursorsStale(page);
  const beforeRefresh = await readReplica(page);
  expect(
    Object.values(beforeRefresh.cursors).every((cursor) => cursor.updatedAt === STALE_CURSOR),
  ).toBe(true);

  const unavailable = faultProxy.respond(
    { ...SERVER_FUNCTION, method: "GET" },
    {
      name: "P17-full-refresh-503",
      status: 503,
      headers: { "retry-after": "2" },
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await unavailable.waitForHits();
  await unavailable.waitForCompletions();

  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Sync failed/ })).toBeVisible();
  expectSameDurableReplica(beforeRefresh, await readReplica(page));
});

test("P18: an edit during staged stale refresh fences off the replacement swap", async ({
  onboardedPage: page,
  faultProxy,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await makeCursorsStale(page);
  const beforeRefresh = await readReplica(page);

  const stagedPull = faultProxy.hold(
    { ...SERVER_FUNCTION, method: "GET" },
    {
      name: "P18-staged-full-pull",
      times: 1,
    },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await stagedPull.waitForHits();
  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();

  const stagedRequest = faultProxy.requests.find((request) => request.fault === stagedPull.name);
  expect(stagedRequest, "the stale-cursor boot must issue a full pull").toBeDefined();
  expect(`${stagedRequest?.url}${stagedRequest?.body.toString("utf8")}`).not.toContain(
    STALE_CURSOR,
  );

  const editedName = "P18 edit wins over staged replacement";
  await editAccountName(page, E2E_ACCOUNT_NAME, editedName);
  const afterEdit = await readReplica(page);
  expect(afterEdit.localRevision).toBe(beforeRefresh.localRevision + 1);
  expect(afterEdit.outbox).toHaveLength(beforeRefresh.outbox.length + 1);
  expect(afterEdit.accounts).toContainEqual(expect.objectContaining({ name: editedName }));
  expect(stagedPull.pendingCount).toBe(1);

  const unavailable = faultProxy.respond(SERVER_FUNCTION, {
    name: "P18-post-fence-503",
    status: 503,
    headers: { "retry-after": "2" },
  });
  stagedPull.release();
  await stagedPull.waitForCompletions(1, 30_000);
  await unavailable.waitForHits(1, 15_000);
  await expect(page.getByRole("button", { name: /^1 unsynced/ })).toBeVisible();

  expectSameDurableReplica(afterEdit, await readReplica(page));
  await expect(page.getByText(editedName, { exact: true })).toBeVisible();
});
