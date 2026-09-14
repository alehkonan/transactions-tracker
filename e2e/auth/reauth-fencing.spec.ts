import { expect } from "@playwright/test";
import { completeOnboarding, createTransaction, test, waitForSynced } from "../fixtures/auth";
import {
  LOCAL_TRANSACTION_COMMENT,
  clearAuthCookies,
  test as localReplicaTest,
} from "../fixtures/local-replica";
import type { BrowserContext, CDPSession, Page, Request, Route } from "@playwright/test";

const DATABASE_NAME = "transactions-tracker";
const SERVER_FUNCTION_PATH = "/_serverFn/";
const AUTH_COOKIE_NAMES = new Set(["access_token", "refresh_token", "session_hint"]);
const FINANCIAL_STORES = ["profiles", "accounts", "categories", "transactions"] as const;

type ReplicaIdentity = {
  ownerUserId: number;
  replicaId: string;
  username: string;
};

type ReplicaDescriptor = {
  replicaId: string;
  identity: ReplicaIdentity | null;
  lifecycle: "active" | "transitioning" | "signed-out";
  syncAuth?: "unknown" | "authenticated" | "login-required" | "owner-mismatch";
  legacyOwnership: unknown;
};

type DurableReplicaSnapshot = {
  descriptor: ReplicaDescriptor;
  metadata: Array<{ key: string; value: unknown }>;
  profiles: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  transactions: Array<Record<string, unknown>>;
  outbox: Array<Record<string, unknown>>;
};

type VirtualAuthenticator = {
  cdp: CDPSession;
  authenticatorId: string;
};

async function readDurableReplica(page: Page): Promise<DurableReplicaSnapshot> {
  return page.evaluate(async (databaseName) => {
    const openRequest = indexedDB.open(databaseName);
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      openRequest.addEventListener("success", () => resolve(openRequest.result));
      openRequest.addEventListener("error", () => reject(openRequest.error));
    });

    try {
      const transaction = database.transaction(
        ["meta", "profiles", "accounts", "categories", "transactions", "outbox"],
        "readonly",
      );
      // oxlint-disable-next-line unicorn/consistent-function-scoping -- must stay in the serialized browser closure.
      const read = <T>(request: IDBRequest<T>) =>
        new Promise<T>((resolve, reject) => {
          request.addEventListener("success", () => resolve(request.result));
          request.addEventListener("error", () => reject(request.error));
        });
      const meta = transaction.objectStore("meta");
      const [metaKeys, metaValues, profiles, accounts, categories, transactions, outbox] =
        await Promise.all([
          read(meta.getAllKeys()),
          read(meta.getAll()),
          read(transaction.objectStore("profiles").getAll()),
          read(transaction.objectStore("accounts").getAll()),
          read(transaction.objectStore("categories").getAll()),
          read(transaction.objectStore("transactions").getAll()),
          read(transaction.objectStore("outbox").getAll()),
        ]);
      const descriptorIndex = metaKeys.indexOf("replicaDescriptor");
      const descriptor = metaValues[descriptorIndex] as ReplicaDescriptor;
      const metadata = metaKeys.flatMap((key, index) =>
        key === "replicaDescriptor" ? [] : [{ key: String(key), value: metaValues[index] }],
      );

      return JSON.parse(
        JSON.stringify({
          descriptor,
          metadata,
          profiles,
          accounts,
          categories,
          transactions,
          outbox,
        }),
      ) as DurableReplicaSnapshot;
    } finally {
      database.close();
    }
  }, DATABASE_NAME);
}

function financialRows(snapshot: DurableReplicaSnapshot) {
  return {
    profiles: snapshot.profiles,
    accounts: snapshot.accounts,
    categories: snapshot.categories,
    transactions: snapshot.transactions,
  };
}

function replicaIdentityRowsAndOutbox(snapshot: DurableReplicaSnapshot) {
  return {
    descriptor: {
      replicaId: snapshot.descriptor.replicaId,
      identity: snapshot.descriptor.identity,
      lifecycle: snapshot.descriptor.lifecycle,
      syncAuth: snapshot.descriptor.syncAuth,
    },
    rows: financialRows(snapshot),
    outbox: snapshot.outbox,
  };
}

function expectBoundIdentity(snapshot: DurableReplicaSnapshot): ReplicaIdentity {
  const identity = snapshot.descriptor.identity;
  expect(identity).not.toBeNull();
  expect(identity?.replicaId).toBe(snapshot.descriptor.replicaId);
  return identity!;
}

async function expectEmptyReplica(page: Page): Promise<DurableReplicaSnapshot> {
  await expect
    .poll(async () => replicaIdentityRowsAndOutbox(await readDurableReplica(page)))
    .toMatchObject({
      descriptor: { identity: null, lifecycle: "active" },
      rows: { profiles: [], accounts: [], categories: [], transactions: [] },
      outbox: [],
    });
  return readDurableReplica(page);
}

async function waitForLoginRequired(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const descriptor = (await readDurableReplica(page)).descriptor;
        return { lifecycle: descriptor.lifecycle, syncAuth: descriptor.syncAuth };
      },
      { timeout: 30_000 },
    )
    .toEqual({ lifecycle: "active", syncAuth: "login-required" });
}

async function openQueuedReplicaForReauthentication(page: Page): Promise<DurableReplicaSnapshot> {
  await clearAuthCookies(page);
  await page.context().setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForLoginRequired(page);

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("password-auth-username")).toBeVisible();

  const snapshot = await readDurableReplica(page);
  expect(snapshot.outbox).toHaveLength(1);
  expect(snapshot.descriptor.lifecycle).toBe("active");
  expect(snapshot.descriptor.syncAuth).toBe("login-required");
  return snapshot;
}

async function expectNoAuthCookies(context: BrowserContext): Promise<void> {
  const authCookies = (await context.cookies()).filter((cookie) =>
    AUTH_COOKIE_NAMES.has(cookie.name),
  );
  expect(authCookies).toEqual([]);
}

async function exercisePausedSyncTriggers(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event("online"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(1_500);
}

async function signUpThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.getByTestId("password-auth-mode-sign-up").click();
  await page.getByTestId("password-auth-username").fill(username);
  await page.getByTestId("password-auth-password").fill(password);
  await page.getByTestId("password-auth-confirm-password").fill(password);
  await page.getByTestId("password-auth-submit").click();
  await expect(page).toHaveURL(/\/profile$/, { timeout: 30_000 });
}

async function signInThroughUi(page: Page, username: string, password: string): Promise<void> {
  await page.getByTestId("password-auth-mode-sign-in").click();
  await page.getByTestId("password-auth-username").fill(username);
  await page.getByTestId("password-auth-password").fill(password);
  await page.getByTestId("password-auth-submit").click();
  await expect
    .poll(async () => (await readDurableReplica(page)).descriptor.identity?.username ?? null, {
      timeout: 30_000,
    })
    .toBe(username);
}

async function signOutThroughUi(page: Page, outboxCount: number): Promise<void> {
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  const title = outboxCount > 0 ? "Unsynced changes will be lost" : "Sign out on this device";
  const confirmation = page.getByRole("dialog", { name: title });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", {
      name: outboxCount > 0 ? "Sign out anyway" : "Sign out",
      exact: true,
    })
    .click();
  await expect(page).toHaveURL(/\/login(?:\?|$)/, { timeout: 30_000 });
}

function disableConditionalPasskeyAutofill(): void {
  const credential = globalThis.PublicKeyCredential;
  if (!credential) return;
  Object.defineProperty(credential, "isConditionalMediationAvailable", {
    configurable: true,
    value: async () => false,
  });
}

async function addVirtualPasskey(
  page: Page,
  options: { disableAutofill?: boolean } = {},
): Promise<VirtualAuthenticator> {
  if (options.disableAutofill !== false) {
    await page.context().addInitScript(disableConditionalPasskeyAutofill);
    await page.evaluate(disableConditionalPasskeyAutofill);
  }

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  await page.goto("/settings");
  const addPasskey = page.getByRole("button", { name: "Add passkey", exact: true });
  await expect(addPasskey).toBeVisible({ timeout: 30_000 });
  await addPasskey.click();
  await expect(page.getByText(/1 passkey attached\./)).toBeVisible({ timeout: 30_000 });

  return { cdp, authenticatorId };
}

function enableConditionalPasskeyAutofill(): void {
  const credential = globalThis.PublicKeyCredential;
  if (!credential) return;
  Object.defineProperty(credential, "isConditionalMediationAvailable", {
    configurable: true,
    value: async () => true,
  });
}

async function setAutomaticPresence(
  authenticator: VirtualAuthenticator,
  enabled: boolean,
): Promise<void> {
  await authenticator.cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId: authenticator.authenticatorId,
    enabled,
  });
}

function observeServerFunctions(context: BrowserContext): string[] {
  const bodies: string[] = [];
  context.on("request", (request: Request) => {
    if (new URL(request.url()).pathname.startsWith(SERVER_FUNCTION_PATH)) {
      bodies.push(request.postData() ?? "");
    }
  });
  return bodies;
}

localReplicaTest(
  "P09: failed password reauthentication preserves the exact queued replica and keeps sync paused",
  async ({ localReplicaPage: page, authCredentials, context }) => {
    localReplicaTest.setTimeout(90_000);

    const before = await openQueuedReplicaForReauthentication(page);
    expect(before.transactions).toContainEqual(
      expect.objectContaining({ comment: LOCAL_TRANSACTION_COMMENT }),
    );
    const requests = observeServerFunctions(context);

    await page.getByTestId("password-auth-username").fill(authCredentials.username);
    await page.getByTestId("password-auth-password").fill("Wrong-Password!Still-Strong-For-P09");
    await page.getByTestId("password-auth-submit").click();

    await expect(
      page.getByText("Unable to sign in. Check your credentials and try again."),
    ).toBeVisible();
    expect(await readDurableReplica(page)).toEqual(before);
    await expectNoAuthCookies(context);

    const requestCountAfterFailure = requests.length;
    await exercisePausedSyncTriggers(page);
    expect(requests).toHaveLength(requestCountAfterFailure);
    expect(await readDurableReplica(page)).toEqual(before);
  },
);

test("P09: cancelled passkey reauthentication preserves the exact queued replica and keeps sync paused", async ({
  onboardedPage: page,
  authCredentials,
  browserName,
  context,
}) => {
  test.setTimeout(120_000);
  test.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");

  const authenticator = await addVirtualPasskey(page);
  await page.goto("/transactions");
  await waitForSynced(page);
  await context.setOffline(true);
  const comment = `P09 cancelled passkey ${authCredentials.username}`;
  await createTransaction(page, comment);
  const before = await openQueuedReplicaForReauthentication(page);
  expect(before.transactions).toContainEqual(expect.objectContaining({ comment }));

  await setAutomaticPresence(authenticator, false);
  const requests = observeServerFunctions(context);
  const optionsResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith(SERVER_FUNCTION_PATH),
  );
  const passkeyButton = page.getByTestId("passkey-auth-sign-in");
  await passkeyButton.click();
  await optionsResponse;
  await expect(passkeyButton).toBeDisabled();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.goto("/transactions", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(comment, { exact: false })).toBeVisible();
  expect(await readDurableReplica(page)).toEqual(before);
  await expectNoAuthCookies(context);

  const requestCountAfterCancellation = requests.length;
  await exercisePausedSyncTriggers(page);
  expect(requests).toHaveLength(requestCountAfterCancellation);
  expect(await readDurableReplica(page)).toEqual(before);
});

test("P08: same-user conditional passkey autofill preserves the exact queued replica", async ({
  onboardedPage: page,
  authCredentials,
  browserName,
  context,
}) => {
  test.setTimeout(120_000);
  test.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");

  await addVirtualPasskey(page, { disableAutofill: false });
  await page.goto("/transactions");
  await waitForSynced(page);
  await context.setOffline(true);
  const comment = `P08 conditional passkey ${authCredentials.username}`;
  await createTransaction(page, comment);

  await clearAuthCookies(page);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitForLoginRequired(page);
  const before = await readDurableReplica(page);
  expect(before.outbox).toHaveLength(1);
  expect(before.transactions).toContainEqual(expect.objectContaining({ comment }));

  const authFinalizations: string[] = [];
  const holdSync = async (route: Route) => {
    const request = route.request();
    const body = request.postData() ?? "";
    if (body.includes("authenticatorData")) authFinalizations.push(body);
    if (
      request.method() === "POST" &&
      body.includes("protocolVersion") &&
      body.includes("expectedOwnerUserId")
    ) {
      await route.fulfill({ status: 503, contentType: "text/plain", body: "Sync held for P08" });
      return;
    }
    await route.continue();
  };
  await context.route("**/_serverFn/**", holdSync);
  await context.addInitScript(enableConditionalPasskeyAutofill);

  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    await expect
      .poll(async () => (await readDurableReplica(page)).descriptor.syncAuth, { timeout: 30_000 })
      .toBe("authenticated");
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    expect(authFinalizations).toHaveLength(1);

    const after = await readDurableReplica(page);
    expect(after).toEqual({
      ...before,
      descriptor: { ...before.descriptor, syncAuth: "authenticated" },
    });
  } finally {
    await context.unroute("**/_serverFn/**", holdSync);
  }
});

test("P12: a delayed A callback cannot cross an A-to-B-to-A replica replacement fence", async ({
  onboardedPage: pageA,
  authCredentials,
  browserName,
  context,
}) => {
  test.setTimeout(180_000);
  test.skip(browserName !== "chromium", "CDP virtual authenticators require Chromium");

  const authenticator = await addVirtualPasskey(pageA);
  await pageA.goto("/transactions");
  await waitForSynced(pageA);
  const originalServerReplica = await readDurableReplica(pageA);
  const originalIdentity = expectBoundIdentity(originalServerReplica);
  expect(originalServerReplica.outbox).toEqual([]);

  await context.setOffline(true);
  const localOnlyComment = `P12 old A ${authCredentials.username}`;
  await createTransaction(pageA, localOnlyComment);
  const oldA = await openQueuedReplicaForReauthentication(pageA);
  expect(expectBoundIdentity(oldA)).toEqual(originalIdentity);
  expect(oldA.transactions).toContainEqual(expect.objectContaining({ comment: localOnlyComment }));
  expect(oldA.outbox).toHaveLength(1);

  const pageB = await context.newPage();
  await pageB.goto("/login");
  await expect(pageB.getByTestId("password-auth-username")).toBeVisible();

  await setAutomaticPresence(authenticator, false);
  const serverFunctionBodies = observeServerFunctions(context);
  const optionsResponse = pageA.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith(SERVER_FUNCTION_PATH),
  );
  await pageA.getByTestId("passkey-auth-sign-in").click();
  await optionsResponse;
  await expect(pageA.getByTestId("passkey-auth-sign-in")).toBeDisabled();
  expect(
    serverFunctionBodies.some((body) => body.includes("authenticatorData")),
    "the held A ceremony must not have reached auth finalization before replacement",
  ).toBe(false);

  pageA.on("dialog", (dialog) => void dialog.accept());
  await signOutThroughUi(pageB, 1);
  const emptyAfterA = await expectEmptyReplica(pageB);
  expect(emptyAfterA.descriptor.replicaId).not.toBe(oldA.descriptor.replicaId);

  const userB = `${authCredentials.username}-p12-b`;
  await signUpThroughUi(pageB, userB, authCredentials.password);
  await completeOnboarding(pageB);
  await waitForSynced(pageB);
  const boundB = await readDurableReplica(pageB);
  const identityB = expectBoundIdentity(boundB);
  expect(identityB.ownerUserId).not.toBe(originalIdentity.ownerUserId);
  expect(identityB.username).toBe(userB);
  expect(identityB.replicaId).toBe(emptyAfterA.descriptor.replicaId);
  expect(boundB.outbox).toEqual([]);
  expect(financialRows(boundB)).not.toEqual(financialRows(oldA));

  await pageB.goto("/settings");
  await signOutThroughUi(pageB, 0);
  const emptyAfterB = await expectEmptyReplica(pageB);
  expect(emptyAfterB.descriptor.replicaId).not.toBe(boundB.descriptor.replicaId);

  await signInThroughUi(pageB, authCredentials.username, authCredentials.password);
  await waitForSynced(pageB);
  await expect
    .poll(async () => ({
      rows: financialRows(await readDurableReplica(pageB)),
      outbox: (await readDurableReplica(pageB)).outbox,
    }))
    .toEqual({ rows: financialRows(originalServerReplica), outbox: [] });

  const newA = await readDurableReplica(pageB);
  const newAIdentity = expectBoundIdentity(newA);
  expect(newAIdentity).toEqual({
    ownerUserId: originalIdentity.ownerUserId,
    replicaId: emptyAfterB.descriptor.replicaId,
    username: authCredentials.username,
  });
  expect(newA.descriptor.replicaId).not.toBe(oldA.descriptor.replicaId);
  expect(newA.transactions).not.toContainEqual(
    expect.objectContaining({ comment: localOnlyComment }),
  );
  expect(newA.outbox).toEqual([]);

  await setAutomaticPresence(authenticator, true);
  await pageB.waitForTimeout(1_500);
  expect(
    serverFunctionBodies.filter((body) => body.includes("authenticatorData")),
    "the pre-replacement A callback must never finalize against the replacement A replica",
  ).toEqual([]);
  expect(replicaIdentityRowsAndOutbox(await readDurableReplica(pageB))).toEqual(
    replicaIdentityRowsAndOutbox(newA),
  );

  for (const store of FINANCIAL_STORES) {
    expect(newA[store]).toEqual(originalServerReplica[store]);
  }
});
