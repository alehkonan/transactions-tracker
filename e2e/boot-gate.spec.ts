import { expect } from "@playwright/test";
import {
  E2E_ACCOUNT_NAME,
  completeOnboarding,
  contextWithStaleHints,
  test,
  waitForSynced,
} from "./fixtures/auth";

test.describe("boot gate", () => {
  test("hydrates first-run and returning data, stays usable in a warm offline tab, and rejects a dead session", async ({
    authenticatedPage,
    bootGateShown,
    context,
  }) => {
    expect(await bootGateShown).toBe(true);
    await expect(authenticatedPage).toHaveURL(/\/profile$/);
    await expect(
      authenticatedPage.getByRole("heading", { name: "Choose a profile" }),
    ).toBeVisible();

    await completeOnboarding(authenticatedPage);
    await waitForSynced(authenticatedPage);
    await expect(authenticatedPage.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();

    await authenticatedPage.reload();
    await expect(authenticatedPage.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();

    await context.setOffline(true);
    await expect(authenticatedPage.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();
    await expect(
      authenticatedPage.getByText("Could not load your data", { exact: true }),
    ).toHaveCount(0);
    await context.setOffline(false);

    const staleContext = await contextWithStaleHints(authenticatedPage);
    try {
      const stalePage = await staleContext.newPage();
      await stalePage.goto("/");
      await expect(stalePage).toHaveURL(/\/login$/, { timeout: 30_000 });
    } finally {
      await staleContext.close();
    }
  });
});
