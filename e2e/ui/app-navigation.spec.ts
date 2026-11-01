import { expect } from "@playwright/test";
import { createTransaction, E2E_ACCOUNT_NAME, test } from "../fixtures/auth";

test("tabs retain transaction search and filters through profile selection", async ({
  onboardedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions");
  await createTransaction(page, "Navigation retention");
  await page.getByTestId("transaction-search").fill("Navigation retention");
  await page.goto(
    `/transactions?q=Navigation%20retention&account=${encodeURIComponent(E2E_ACCOUNT_NAME)}`,
  );

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-profile").click();
  await page.getByTestId("parent-back").click();
  await page.getByTestId("nav-transactions").click();

  await expect(page.getByTestId("transaction-search")).toHaveValue("Navigation retention");
  await expect(page).toHaveURL(/account=/);
  await expect(page.getByTestId("transaction-filters")).toHaveAccessibleName(
    "Transaction filters, 1 active",
  );
  await expect(page.getByTestId("transaction-list")).toBeVisible();
});
