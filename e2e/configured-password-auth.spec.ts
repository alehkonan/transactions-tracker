import { expect, test } from "@playwright/test";

const configuredUsername = process.env.E2E_TEST_USERNAME!;
const configuredPassword = process.env.E2E_TEST_PASSWORD!;
const invalidCredentialsMessage = "Unable to sign in. Check your credentials and try again.";

test("the configured password user can sign in", async ({ page }) => {
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  await page.getByLabel("Username", { exact: true }).fill(configuredUsername);
  await page.getByLabel("Password", { exact: true }).fill(configuredPassword);
  await page.getByRole("button", { name: "Sign in", exact: true }).last().click();

  const outcome = await Promise.race([
    page.waitForURL(/\/profile$/, { timeout: 30_000 }).then(() => "signed-in" as const),
    page
      .getByText(invalidCredentialsMessage)
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => "rejected" as const),
  ]);

  if (outcome === "rejected") {
    throw new Error(
      `Configured E2E user "${configuredUsername}" could not sign in. Ensure the user exists in the target database and that E2E_TEST_PASSWORD is correct.`,
    );
  }

  await expect(page.getByRole("heading", { name: "Choose a profile" })).toBeVisible();
});
