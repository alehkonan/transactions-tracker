import { randomUUID } from "node:crypto";
import { expect, test as base } from "@playwright/test";
import type { BrowserContext, Locator, Page, TestInfo } from "@playwright/test";

const SYNCED_TITLE = /Everything on this device is on the server/;
const E2E_PROFILE_NAME = "E2E Profile";
export const E2E_ACCOUNT_NAME = "E2E Account";
const E2E_TEST_PASSWORD = "E2e-Password!Round-Trip-2026";

const bootGateObservations = new WeakMap<Page, Promise<boolean>>();

type AuthCredentials = {
  username: string;
  password: string;
};

export type E2EFixtures = {
  /** Unique credentials registered through the password Create account UI. */
  authCredentials: AuthCredentials;
  /** A newly registered page, left on the profile-selection screen. */
  authenticatedPage: Page;
  /** An authenticated page with one selected profile and one account. */
  onboardedPage: Page;
  /** Resolves to whether the first-run loading gate was observed during registration. */
  bootGateShown: Promise<boolean>;
};

/**
 * Playwright's browser contexts isolate IndexedDB, cookies and BroadcastChannel state. Each test
 * therefore creates its own password user through the public UI rather than sharing storage state.
 */
export const test = base.extend<E2EFixtures>({
  authCredentials: async ({ browserName: _browserName }, use, testInfo) => {
    await use({ username: uniqueUsername(testInfo), password: E2E_TEST_PASSWORD });
  },

  authenticatedPage: async ({ authCredentials, page }, use) => {
    await installBootGateInstrumentation(page);
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await page.getByRole("button", { name: "Create account", exact: true }).click();
    await page.getByLabel("Username", { exact: true }).fill(authCredentials.username);
    await page.getByLabel("Password", { exact: true }).fill(authCredentials.password);
    await page.getByLabel("Confirm password", { exact: true }).fill(authCredentials.password);
    await page.getByRole("button", { name: "Create account", exact: true }).last().click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });

    bootGateObservations.set(page, observeBootGate(page));

    await use(page);
  },

  bootGateShown: async ({ authenticatedPage }, use) => {
    const observation = bootGateObservations.get(authenticatedPage);
    if (!observation)
      throw new Error("The authenticated page did not register a boot-gate observation.");
    await use(observation);
  },

  onboardedPage: async ({ authenticatedPage }, use) => {
    await completeOnboarding(authenticatedPage);
    await waitForSynced(authenticatedPage);
    await use(authenticatedPage);
  },
});

/** Completes the minimum UI onboarding needed to create and display transactions. */
export async function completeOnboarding(page: Page): Promise<string> {
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("button", { name: "New profile" }).click();

  const profileDialog = page.getByRole("dialog");
  await expect(profileDialog).toBeVisible();
  await profileDialog.getByLabel("Profile name").fill(E2E_PROFILE_NAME);
  await profileDialog.getByRole("button", { name: "Create", exact: true }).click();

  await expect(page.getByText(E2E_PROFILE_NAME, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Open", exact: true }).click();
  await expect(page).toHaveURL(/\/transactions$/, { timeout: 30_000 });

  await page.goto("/accounts");
  await page.getByRole("button", { name: "Add account" }).click();

  const accountDialog = page.getByRole("dialog");
  await expect(accountDialog).toBeVisible();
  await accountDialog.getByLabel("Name").fill(E2E_ACCOUNT_NAME);
  await accountDialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page.getByText(E2E_ACCOUNT_NAME, { exact: true })).toBeVisible();

  return E2E_ACCOUNT_NAME;
}

/** Waits for the accessible sync sentence rather than the viewport-dependent visible label. */
export async function waitForSynced(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: SYNCED_TITLE })).toBeVisible({ timeout: 30_000 });
}

/** Creates one transaction through the real form and returns its unique comment. */
export async function createTransaction(page: Page, comment: string): Promise<void> {
  await page.getByRole("button", { name: "Add transaction" }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await chooseOption(dialog, "Account", `${E2E_ACCOUNT_NAME} (USD)`);
  await dialog.getByLabel("Amount").fill("12.34");
  await dialog.getByLabel("Comment").fill(comment);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(comment, { exact: false })).toBeVisible();
}

/** Copies only the forgeable route-guard hints into a fresh context with no auth cookies or IDB. */
export async function contextWithStaleHints(page: Page): Promise<BrowserContext> {
  const browser = page.context().browser();
  if (!browser) throw new Error("The E2E page is not attached to a browser.");

  const hints = (await page.context().cookies(page.url())).filter(
    (cookie) => cookie.name === "session_hint" || cookie.name === "profile_hint",
  );
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin });
  await context.addCookies(hints);
  return context;
}

async function chooseOption(dialog: Locator, label: string, option: string): Promise<void> {
  await dialog.getByLabel(label).click();
  await dialog.page().getByRole("option", { name: option, exact: true }).click();
}

export async function installBootGateInstrumentation(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const windowWithTestState = window as typeof window & { e2eBootGateSeen?: boolean };
    windowWithTestState.e2eBootGateSeen = sessionStorage.getItem("e2eBootGateSeen") === "true";

    const markBootGate = () => {
      if (document.body?.textContent?.includes("Loading your data…")) {
        windowWithTestState.e2eBootGateSeen = true;
        sessionStorage.setItem("e2eBootGateSeen", "true");
      }
    };
    new MutationObserver(markBootGate).observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    const pollingTimer = window.setInterval(markBootGate, 10);
    window.setTimeout(() => window.clearInterval(pollingTimer), 30_000);
    markBootGate();
  });
}

export function observeBootGate(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const windowWithTestState = window as typeof window & { e2eBootGateSeen?: boolean };
    const currentlyVisible = document.body?.textContent?.includes("Loading your data…") ?? false;
    const seen = currentlyVisible || sessionStorage.getItem("e2eBootGateSeen") === "true";
    if (seen) {
      windowWithTestState.e2eBootGateSeen = true;
      sessionStorage.setItem("e2eBootGateSeen", "true");
    }
    return seen;
  });
}

export function uniqueUsername(testInfo: TestInfo): string {
  return `e2e-${testInfo.workerIndex}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}
