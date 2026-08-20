import { expect } from "@playwright/test";
import { test } from "./fixtures/auth";

test("a registered discoverable passkey signs in again", async ({ onboardedPage: page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
});
