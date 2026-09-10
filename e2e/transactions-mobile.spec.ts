import { expect } from "@playwright/test";
import { createTransaction, E2E_ACCOUNT_NAME, test } from "./fixtures/auth";

const TRANSACTION_COMMENT = "Mobile add action remains reachable";
const FILTER_LAYOUT_COMMENT = "Clearing filters restores the ledger height";

test("the add transaction action stays reachable above a populated mobile list", async ({
  onboardedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions");

  const addButton = page.getByRole("button", { name: "Add transaction", exact: true }).first();
  await addButton.click();

  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Account").selectOption({ label: `${E2E_ACCOUNT_NAME} (USD)` });
  await createDialog.getByLabel("Amount").fill("12.34");
  await createDialog.getByLabel("Comment").fill(TRANSACTION_COMMENT);
  await createDialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(createDialog).not.toBeVisible();
  await expect(page.getByText(TRANSACTION_COMMENT, { exact: false })).toBeVisible();
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});

test("clearing filters restores the mobile transaction list height", async ({
  onboardedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions");
  await createTransaction(page, FILTER_LAYOUT_COMMENT);

  const list = page.getByRole("region", { name: "Transactions grouped by day" });
  const listHeight = () =>
    list.evaluate((element) => Math.round(element.getBoundingClientRect().height));
  const initialHeight = await listHeight();

  await page.getByRole("button", { name: "Transaction filters", exact: true }).click();
  const filtersDialog = page.getByRole("dialog", { name: "Filters" });
  await filtersDialog.getByLabel("Account").selectOption({ label: E2E_ACCOUNT_NAME });
  await filtersDialog.getByRole("button", { name: "Close filters" }).click();

  await expect(
    page.getByRole("button", { name: `Remove ${E2E_ACCOUNT_NAME} filter` }),
  ).toBeVisible();
  await expect.poll(listHeight).toBeLessThan(initialHeight);

  await page.getByRole("button", { name: "Clear all", exact: true }).click();
  await expect.poll(listHeight).toBe(initialHeight);
});
