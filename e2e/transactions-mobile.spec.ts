import { expect } from "@playwright/test";
import { test } from "./fixtures/auth";

const TRANSACTION_COMMENT = "Mobile add action remains reachable";

test("the add transaction action stays reachable above a populated mobile list", async ({
  onboardedPage: page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/transactions");

  const addButton = page.getByRole("button", { name: "Add transaction", exact: true });
  await addButton.click();

  const createDialog = page.getByRole("dialog");
  await createDialog.getByLabel("Account").click();
  await page.getByRole("option", { name: /E2E Account \(USD\)/ }).click();
  await createDialog.getByLabel("Amount").fill("12.34");
  await createDialog.getByLabel("Comment").fill(TRANSACTION_COMMENT);
  await createDialog.getByRole("button", { name: "Save", exact: true }).click();

  await expect(page.getByText(TRANSACTION_COMMENT, { exact: false })).toBeVisible();
  await expect(addButton).toBeVisible();
  await addButton.click();
  await expect(page.getByRole("dialog")).toBeVisible();
});
