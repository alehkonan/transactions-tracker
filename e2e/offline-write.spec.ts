import { expect } from "@playwright/test";
import { createTransaction, test, waitForSynced } from "./fixtures/auth";

test("an offline transaction queues locally and pushes after reconnect", async ({
  onboardedPage: page,
  context,
}) => {
  await page.goto("/transactions");
  await waitForSynced(page);

  await context.setOffline(true);
  const comment = "E2E offline transaction";
  await createTransaction(page, comment);

  await expect(page.getByText(comment, { exact: false })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /saved on this device, waiting for a connection/ }),
  ).toBeVisible({ timeout: 10_000 });

  await context.setOffline(false);
  await waitForSynced(page);

  await page.reload();
  await expect(page.getByText(comment, { exact: false })).toBeVisible({ timeout: 30_000 });
});
