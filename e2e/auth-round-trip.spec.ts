import { expect } from "@playwright/test";
import { test } from "./fixtures/auth";
import { test as passkeyTest } from "./fixtures/passkey-auth";

test("a password account signs out and signs in again", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

  await page.getByLabel("Username", { exact: true }).fill(authCredentials.username);
  await page.getByLabel("Password", { exact: true }).fill("Wrong-Password!Still-Strong");
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(
    page.getByText("Unable to sign in. Check your credentials and try again."),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Password", { exact: true }).fill(authCredentials.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
});

test("a duplicate password signup is rejected", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByLabel("Username", { exact: true }).fill(authCredentials.username);
  await page.getByLabel("Password", { exact: true }).fill(authCredentials.password);
  await page.getByLabel("Confirm password", { exact: true }).fill(authCredentials.password);
  await page.getByRole("button", { name: "Create account", exact: true }).last().click();

  await expect(page.getByText("That username is already taken.")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});

passkeyTest(
  "a registered discoverable passkey signs in again",
  async ({ onboardedPasskeyPage: page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

    await page.getByRole("button", { name: "Sign in with a passkey" }).click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
  },
);
