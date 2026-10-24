import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { E2E_ACCOUNT_NAME, openSecondDevice, test, waitForSynced } from "../fixtures/auth";
import {
  expectOperatingReconciled,
  pushMutations,
  readFinancialReplica,
} from "../fixtures/transfers";

test("fixed-currency accounts retain money through offline edits, archive filtering, reload, and another device", async ({
  onboardedPage: page,
  context,
  authCredentials,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) {
    await page.reload();
    await expect(page.getByTestId("accounts-list")).toBeVisible();
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller != null))
    .toBe(true);
  const source = (await readFinancialReplica(page)).accounts[0];
  const categoryId = randomUUID();
  const seeded = await pushMutations(page, [
    {
      mutationId: randomUUID(),
      rowId: categoryId,
      table: "categories",
      op: "upsert",
      baseUpdatedAt: null,
      payload: { name: "Preserved history", colorId: null, profileId: source.profileId },
    },
    ...["-12.34", "15.00"].map((amount) => ({
      mutationId: randomUUID(),
      rowId: randomUUID(),
      table: "transactions" as const,
      op: "upsert" as const,
      baseUpdatedAt: null,
      payload: {
        type: Number(amount) < 0 ? ("EXPENSE" as const) : ("INCOME" as const),
        amount,
        comment: "Existing account history",
        accountId: source.id,
        categoryId,
        profileId: source.profileId,
        createdAt: new Date("2026-01-01T12:00:00Z"),
        necessityLevel: "MEDIUM" as const,
      },
    })),
  ]);
  expect(seeded.status).toBe(200);
  await page.getByTestId("sync-status").click();
  await expect.poll(async () => (await readFinancialReplica(page)).transactions.length).toBe(2);
  await waitForSynced(page);
  const history = (await readFinancialReplica(page)).transactions;
  expect(history).toHaveLength(2);
  await context.setOffline(true);

  const cards = page.getByTestId("accounts-list").getByTestId(/^account-/);
  await cards.filter({ hasText: E2E_ACCOUNT_NAME }).click();
  const form = page.getByTestId("account-form");
  await expect(form.getByTestId("account-currency")).toBeDisabled();
  await expect(form.getByTestId("account-currency")).toHaveValue("USD");
  await form.getByTestId("account-name").fill("Archived wallet");
  await form.getByTestId("account-initial-balance").fill("100.00");
  await form.getByTestId("account-status").selectOption("ARCHIVED");
  await form.getByTestId("account-submit").click();

  await expect(page.getByTestId("accounts-empty")).toHaveText("No active accounts.");
  await expect(page.getByTestId("accounts-total")).toContainText(/102[.,]66/);
  await expect(page.getByTestId("operating-balances")).toContainText(/102[.,]66/);
  expectOperatingReconciled(await readFinancialReplica(page));
  const totalWithArchivedMoney = await page.getByTestId("accounts-total").textContent();

  await page.getByTestId("account-create").click();
  await expect(form.getByTestId("account-currency")).toBeEnabled();
  await form.getByTestId("account-name").fill("Euro card");
  await form.getByTestId("account-currency").selectOption("EUR");
  await form.getByTestId("account-submit").click();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Euro card");

  await page.getByTestId("accounts-status").selectOption("ARCHIVED");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Archived wallet");
  await page.getByTestId("accounts-status").selectOption("ALL");
  await expect(cards).toHaveCount(2);
  await expect(page.getByTestId("accounts-total")).toHaveText(totalWithArchivedMoney!);
  expect((await readFinancialReplica(page)).transactions).toEqual(history);
  expectOperatingReconciled(await readFinancialReplica(page));

  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Euro card");
  await page.getByTestId("accounts-status").selectOption("ARCHIVED");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Archived wallet");
  await expect(page.getByTestId("accounts-total")).toHaveText(totalWithArchivedMoney!);
  await expect(page.getByTestId("operating-reconciliation")).toContainText(
    "All sphere balances match account balances",
  );
  expectOperatingReconciled(await readFinancialReplica(page));

  await context.setOffline(false);
  // Chromium's offline emulation loses its online event after a cached navigation. Exercise the
  // supported explicit sync action after restoring the actual network connection.
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  const { context: secondContext, page: secondPage } = await openSecondDevice(
    page,
    authCredentials,
  );
  try {
    await secondPage.goto("/accounts");
    await waitForSynced(secondPage);
    await secondPage.getByTestId("accounts-status").selectOption("ARCHIVED");
    const archivedCard = secondPage.getByTestId("accounts-list").getByTestId(/^account-/);
    await expect(archivedCard).toHaveCount(1);
    await expect(archivedCard).toContainText("Archived wallet");
    await expect(secondPage.getByTestId("accounts-total")).toHaveText(totalWithArchivedMoney!);
    await expect(secondPage.getByTestId("operating-balances")).toContainText(/102[.,]66/);
    expectOperatingReconciled(await readFinancialReplica(secondPage));
    await archivedCard.click();
    await expect(secondPage.getByTestId("account-initial-balance")).toHaveValue("100.00");
    await expect(secondPage.getByTestId("account-currency")).toHaveValue("USD");
    await expect(secondPage.getByTestId("account-currency")).toBeDisabled();
    expect(
      (await readFinancialReplica(secondPage)).transactions.toSorted((a, b) =>
        a.id.localeCompare(b.id),
      ),
    ).toEqual(history.toSorted((a, b) => a.id.localeCompare(b.id)));
  } finally {
    await secondContext.close();
  }
});

test("an interrupted allocation pull remains incomplete after an offline reload", async ({
  onboardedPage: page,
  context,
}) => {
  await page.goto("/accounts");
  await waitForSynced(page);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (!(await page.evaluate(() => navigator.serviceWorker.controller != null))) await page.reload();
  await context.setOffline(true);
  await page.evaluate(async () => {
    const request = indexedDB.open("transactions-tracker");
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = database.transaction("meta", "readwrite");
    transaction
      .objectStore("meta")
      .put(["profiles", "accounts", "categories", "transactions", "spheres"], "completeTables");
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  await page.reload();
  await expect(page.getByTestId("operating-reconciliation")).toContainText("Incomplete balances");
  await context.setOffline(false);
  await page.getByTestId("sync-status").click();
  await waitForSynced(page);
  await expect(page.getByTestId("operating-reconciliation")).toContainText(
    "All sphere balances match account balances",
  );
});
