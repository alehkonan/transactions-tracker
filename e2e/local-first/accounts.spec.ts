import { expect } from "@playwright/test";
import { E2E_ACCOUNT_NAME, test, waitForSynced } from "../fixtures/auth";

test("fixed-currency accounts retain money through offline edits, archive filtering, reload, and another device", async ({
  onboardedPage: page,
  context,
  browser,
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
  await expect(page.getByTestId("accounts-total")).toContainText(/100[.,]00/);
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

  await page.reload();
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Euro card");
  await page.getByTestId("accounts-status").selectOption("ARCHIVED");
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText("Archived wallet");
  await expect(page.getByTestId("accounts-total")).toHaveText(totalWithArchivedMoney!);

  await context.setOffline(false);
  await waitForSynced(page);
  // Cookies identify the same user; a fresh browser context has no IndexedDB replica.
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await context.storageState(),
  });
  try {
    const secondPage = await secondContext.newPage();
    await secondPage.goto("/profile");
    await secondPage.getByTestId("profile-open").click();
    await expect(secondPage).toHaveURL(/\/transactions$/);
    await secondPage.goto("/accounts");
    await waitForSynced(secondPage);
    await secondPage.getByTestId("accounts-status").selectOption("ARCHIVED");
    const archivedCard = secondPage.getByTestId("accounts-list").getByTestId(/^account-/);
    await expect(archivedCard).toHaveCount(1);
    await expect(archivedCard).toContainText("Archived wallet");
    await expect(secondPage.getByTestId("accounts-total")).toHaveText(totalWithArchivedMoney!);
    await archivedCard.click();
    await expect(secondPage.getByTestId("account-initial-balance")).toHaveValue("100.00");
    await expect(secondPage.getByTestId("account-currency")).toHaveValue("USD");
    await expect(secondPage.getByTestId("account-currency")).toBeDisabled();
  } finally {
    await secondContext.close();
  }
});
