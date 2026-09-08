import { expect, test as base } from "@playwright/test";
import {
  completeOnboarding,
  installBootGateInstrumentation,
  observeBootGate,
  uniqueUsername,
  waitForSynced,
} from "./auth";
import type { Page } from "@playwright/test";

const bootGateObservations = new WeakMap<Page, Promise<boolean>>();

type PasskeyFixtures = {
  /** A newly registered discoverable-passkey page, available only in Chromium. */
  authenticatedPasskeyPage: Page;
  /** A passkey-authenticated page with one selected profile and one account. */
  onboardedPasskeyPage: Page;
  /** Resolves to whether the first-run loading gate was observed during registration. */
  passkeyBootGateShown: Promise<boolean>;
};

export const test = base.extend<PasskeyFixtures>({
  authenticatedPasskeyPage: async ({ browserName, page }, use, testInfo) => {
    testInfo.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");

    await installBootGateInstrumentation(page);
    await installConditionalAutofillControls(page);
    await enableVirtualAuthenticator(page);
    await page.goto("/login");
    await page.waitForLoadState("networkidle");

    await page.getByLabel("Username for a new passkey account").fill(uniqueUsername(testInfo));
    await page.getByRole("button", { name: "Create account with a passkey" }).click();
    await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });

    bootGateObservations.set(page, observeBootGate(page));
    await use(page);
  },

  onboardedPasskeyPage: async ({ authenticatedPasskeyPage }, use) => {
    await completeOnboarding(authenticatedPasskeyPage);
    await waitForSynced(authenticatedPasskeyPage);
    await use(authenticatedPasskeyPage);
  },

  passkeyBootGateShown: async ({ authenticatedPasskeyPage }, use) => {
    const observation = bootGateObservations.get(authenticatedPasskeyPage);
    if (!observation) throw new Error("The passkey page did not register a boot-gate observation.");
    await use(observation);
  },
});

async function installConditionalAutofillControls(page: Page): Promise<void> {
  // Disable conditional WebAuthn autofill so it cannot race explicit registration/sign-in ceremonies.
  await page.addInitScript(() => {
    const credential = globalThis.PublicKeyCredential;
    if (!credential) return;

    Object.defineProperty(credential, "isConditionalMediationAvailable", {
      configurable: true,
      value: async () => false,
    });
  });
}

async function enableVirtualAuthenticator(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}
