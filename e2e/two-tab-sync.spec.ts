import { expect } from "@playwright/test";
import { E2E_ACCOUNT_NAME, createTransaction, test, waitForSynced } from "./fixtures/auth";

test("a transaction written in one tab appears in the other without a reload", async ({
  onboardedPage: pageA,
  context,
}) => {
  await pageA.goto("/transactions");
  await waitForSynced(pageA);

  const pageB = await context.newPage();
  await pageB.goto("/transactions");
  await waitForSynced(pageB);

  const comment = "E2E two-tab transaction";
  await createTransaction(pageA, comment);
  await expect(pageA.getByText(comment, { exact: false })).toBeVisible();
  await expect(pageB.getByText(comment, { exact: false })).toBeVisible({ timeout: 10_000 });

  await expect(pageB.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
});
