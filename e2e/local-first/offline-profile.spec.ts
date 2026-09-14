import { expect } from "@playwright/test";
import { test } from "../fixtures/auth";
import type { Page } from "@playwright/test";

const DATABASE_NAME = "transactions-tracker";
const PROFILE_NAME = "P16 Offline Profile";
const ACCOUNT_NAME = "P16 Offline Account";

type QueuedMutation = {
  seq: number;
  table: string;
  op: string;
  rowId: string;
  payload?: Record<string, unknown>;
};

type OfflineSnapshot = {
  selectedProfileId?: string;
  profiles: Array<{ id: string; name?: string }>;
  accounts: Array<{ id: string; name?: string; profileId?: string }>;
  outbox: QueuedMutation[];
};

async function ensureControlledShell(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Service worker did not become ready.")), 10_000),
      ),
    ]);
  });

  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) await page.reload();

  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null), {
      message: "the offline profile scenario requires a controlled, fully precached document",
    })
    .toBe(true);
}

async function readOfflineSnapshot(page: Page): Promise<OfflineSnapshot> {
  return page.evaluate(async (databaseName) => {
    const openRequest = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      const transaction = database.transaction(
        ["meta", "profiles", "accounts", "outbox"],
        "readonly",
      );
      const selectedProfileRequest = transaction.objectStore("meta").get("selectedProfileId");
      const profilesRequest = transaction.objectStore("profiles").getAll();
      const accountsRequest = transaction.objectStore("accounts").getAll();
      const outboxRequest = transaction.objectStore("outbox").getAll();
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay in the serialized browser closure.
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });

      const [selectedProfileId, profiles, accounts, outbox] = await Promise.all([
        read(selectedProfileRequest),
        read(profilesRequest),
        read(accountsRequest),
        read(outboxRequest),
      ]);

      return { selectedProfileId, profiles, accounts, outbox } as OfflineSnapshot;
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

test("creates and selects a profile offline before queueing its dependent account", async ({
  authenticatedPage: page,
  context,
}) => {
  await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
  await ensureControlledShell(page);
  await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
  await context.setOffline(true);

  await page.getByRole("button", { name: "New profile" }).click();
  const profileDialog = page.getByRole("dialog");
  await profileDialog.getByLabel("Profile name").fill(PROFILE_NAME);
  await profileDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(profileDialog).not.toBeVisible();
  await expect(page.getByText(PROFILE_NAME, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/);

  await page.getByRole("link", { name: "Accounts" }).click();
  await expect(page).toHaveURL(/\/accounts$/);
  await page.getByRole("button", { name: "Add account", exact: true }).click();

  const accountDialog = page.getByRole("dialog");
  await accountDialog.getByLabel("Name").fill(ACCOUNT_NAME);
  await accountDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(accountDialog).not.toBeVisible();
  await expect(page.getByText(ACCOUNT_NAME, { exact: true })).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page).toHaveURL(/\/accounts$/);
  await expect(page.getByText(ACCOUNT_NAME, { exact: true })).toBeVisible();

  const snapshot = await readOfflineSnapshot(page);
  const profile = snapshot.profiles.find((candidate) => candidate.name === PROFILE_NAME);
  expect(profile).toBeDefined();
  expect(snapshot.selectedProfileId).toBe(profile?.id);

  const account = snapshot.accounts.find((candidate) => candidate.name === ACCOUNT_NAME);
  expect(account).toMatchObject({ profileId: profile?.id });

  const profileMutationIndex = snapshot.outbox.findIndex(
    (mutation) =>
      mutation.table === "profiles" &&
      mutation.op === "upsert" &&
      mutation.rowId === profile?.id &&
      mutation.payload?.name === PROFILE_NAME,
  );
  const accountMutationIndex = snapshot.outbox.findIndex(
    (mutation) =>
      mutation.table === "accounts" &&
      mutation.op === "upsert" &&
      mutation.rowId === account?.id &&
      mutation.payload?.profileId === profile?.id &&
      mutation.payload?.name === ACCOUNT_NAME,
  );

  expect(profileMutationIndex).toBeGreaterThanOrEqual(0);
  expect(accountMutationIndex).toBeGreaterThan(profileMutationIndex);
  expect(snapshot.outbox[profileMutationIndex].seq).toBeLessThan(
    snapshot.outbox[accountMutationIndex].seq,
  );
});
