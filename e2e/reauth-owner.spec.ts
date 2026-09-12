import { expect } from "@playwright/test";
import { test } from "./fixtures/auth";

test("password reauthentication cannot replace replica owner A with user B", async ({
  authenticatedPage: page,
  authCredentials,
  browser,
}) => {
  test.setTimeout(60_000);

  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  const otherUsername = `${authCredentials.username}-other`;

  await otherPage.goto(new URL("/login", page.url()).href);
  const otherOwnerId = await otherPage.evaluate(
    async ({ username, password }) => {
      const modulePath = "/src/api/auth.functions.ts";
      const { getSyncIdentity, passwordSignUp } = (await import(/* @vite-ignore */ modulePath)) as {
        getSyncIdentity(): Promise<{ id: number; username: string } | Response>;
        passwordSignUp(options: {
          data: { username: string; password: string };
        }): Promise<{ id: number; username: string } | Response>;
      };
      const signUp = await passwordSignUp({ data: { username, password } });
      if (signUp instanceof Response) throw new Error(await signUp.text());
      const identity = await getSyncIdentity();
      if (identity instanceof Response) throw new Error("Could not resolve user B.");
      return identity.id;
    },
    { username: otherUsername, password: authCredentials.password },
  );
  await otherContext.close();

  const result = await page.evaluate(
    async ({ username, password, otherOwnerId: expectedOtherOwnerId }) => {
      const modulePath = "/src/api/auth.functions.ts";
      const { getSyncIdentity, passwordSignIn } = (await import(/* @vite-ignore */ modulePath)) as {
        getSyncIdentity(): Promise<{ id: number; username: string } | Response>;
        passwordSignIn(options: {
          data: { username: string; password: string; expectedUserId: number };
        }): Promise<{ id: number; username: string } | Response>;
      };
      const before = await getSyncIdentity();
      if (before instanceof Response) throw new Error("Could not resolve user A.");
      if (before.id === expectedOtherOwnerId) throw new Error("The test users must be distinct.");

      const signIn = await passwordSignIn({
        data: { username, password, expectedUserId: before.id },
      });
      if (!(signIn instanceof Response))
        throw new Error("Expected reauthentication to be rejected.");
      const error = (await signIn.json()) as { code?: string };

      const after = await getSyncIdentity();
      if (after instanceof Response)
        throw new Error("The original session was unexpectedly cleared.");

      return {
        status: signIn.status,
        code: error.code,
        ownerBefore: before.id,
        ownerAfter: after.id,
      };
    },
    {
      username: otherUsername,
      password: authCredentials.password,
      otherOwnerId,
    },
  );

  expect(result).toMatchObject({
    status: 409,
    code: "REPLICA_OWNER_MISMATCH",
  });
  expect(result.ownerAfter).toBe(result.ownerBefore);
});
