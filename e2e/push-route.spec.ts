import { expect } from "@playwright/test";
import { test } from "./fixtures/auth";

test("the HTTP push route returns the shared result shape", async ({ authenticatedPage: page }) => {
  const result = await page.evaluate(async () => {
    const modulePath = "/src/api/auth.functions.ts";
    const { getSyncIdentity } = (await import(/* @vite-ignore */ modulePath)) as {
      getSyncIdentity(): Promise<{ id: number; username: string } | Response>;
    };
    const identity = await getSyncIdentity();
    if (identity instanceof Response) throw new Error("Could not resolve the authenticated user.");

    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        expectedOwnerUserId: identity.id,
        mutations: [],
      }),
    });

    return {
      status: response.status,
      body: (await response.json()) as {
        protocolVersion: number;
        ownerUserId: number;
        applied: unknown[];
        canonicalRows: Record<string, unknown[]>;
        conflicts: unknown[];
        colors: unknown[];
      },
    };
  });

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    protocolVersion: 2,
    ownerUserId: expect.any(Number),
    applied: [],
    canonicalRows: {
      profiles: [],
      accounts: [],
      categories: [],
      transactions: [],
    },
    conflicts: [],
    colors: expect.any(Array),
  });
});

test("every sync transport rejects a replica owner mismatch", async ({
  authenticatedPage: page,
}) => {
  const result = await page.evaluate(async () => {
    const authModulePath = "/src/api/auth.functions.ts";
    const syncModulePath = "/src/api/sync.functions.ts";
    const { getSyncIdentity } = (await import(/* @vite-ignore */ authModulePath)) as {
      getSyncIdentity(): Promise<{ id: number; username: string } | Response>;
    };
    const { pullChanges, pushChanges, checkIntegrity } = (await import(
      /* @vite-ignore */ syncModulePath
    )) as {
      pullChanges(options: { data: unknown }): Promise<unknown>;
      pushChanges(options: { data: unknown }): Promise<unknown>;
      checkIntegrity(options: { data: unknown }): Promise<unknown>;
    };
    const identity = await getSyncIdentity();
    if (identity instanceof Response) throw new Error("Could not resolve the authenticated user.");
    const context = { protocolVersion: 2, expectedOwnerUserId: identity.id + 1 };
    const mutation = {
      mutationId: "01994f62-b486-7000-8000-000000000091",
      rowId: "01994f62-b486-7000-8000-000000000092",
      baseUpdatedAt: null,
      table: "profiles",
      op: "upsert",
      payload: { name: "Must not be written" },
    };

    // oxlint-disable-next-line unicorn/consistent-function-scoping -- must live in the serialized page.evaluate closure.
    const read = async (value: unknown) => {
      if (!(value instanceof Response))
        throw new Error("Expected the server to reject the request.");
      const body = (await value.json()) as { code?: string };
      return { status: value.status, code: body.code };
    };

    const httpResponse = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...context, mutations: [mutation] }),
    });

    const failures = await Promise.all([
      read(await pullChanges({ data: context })),
      read(await pushChanges({ data: { ...context, mutations: [mutation] } })),
      read(await checkIntegrity({ data: context })),
      read(httpResponse),
    ]);
    const validContext = { protocolVersion: 2, expectedOwnerUserId: identity.id };
    const pull = await pullChanges({ data: validContext });
    const integrity = await checkIntegrity({ data: validContext });
    if (pull instanceof Response || integrity instanceof Response) {
      throw new Error("Expected matching-owner sync requests to succeed.");
    }

    return {
      failures,
      ownerUserId: identity.id,
      pull: pull as {
        protocolVersion: number;
        ownerUserId: number;
        rows: { profiles: unknown[] };
      },
      integrity: integrity as { protocolVersion: number; ownerUserId: number },
    };
  });

  expect(result.failures).toEqual(
    Array.from({ length: 4 }, () => ({ status: 409, code: "REPLICA_OWNER_MISMATCH" })),
  );
  expect(result.pull).toMatchObject({
    protocolVersion: 2,
    ownerUserId: result.ownerUserId,
    rows: { profiles: [] },
  });
  expect(result.integrity).toMatchObject({
    protocolVersion: 2,
    ownerUserId: result.ownerUserId,
  });
});

test("a legacy HTTP worker fails closed before an empty push", async ({
  authenticatedPage: page,
}) => {
  const failure = await page.evaluate(async () => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations: [] }),
    });
    const body = (await response.json()) as { code?: string };
    return { status: response.status, code: body.code };
  });

  expect(failure).toEqual({ status: 426, code: "SYNC_PROTOCOL_UNSUPPORTED" });
});
