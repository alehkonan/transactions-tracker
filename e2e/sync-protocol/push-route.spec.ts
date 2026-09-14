import { randomUUID } from "node:crypto";
import { expect, test as baseTest } from "@playwright/test";
import { test } from "../fixtures/auth";
import { readReplicaOwnerUserId } from "../fixtures/indexed-db";

baseTest(
  "non-UI endpoints preserve real responses instead of the versioned SPA shell",
  async ({ request }) => {
    const artifactResponse = await request.get("/offline-artifacts.json");
    expect(artifactResponse.status()).toBe(200);
    const { shellUrl } = (await artifactResponse.json()) as { shellUrl: string };
    const shell = await request.get(shellUrl);
    const successfulShellBody = await shell.text();

    expect(shell.status()).toBe(200);
    expect(shell.headers()["content-type"]).toBe("text/html; charset=utf-8");

    const [push, serverFunction, script] = await Promise.all([
      request.post("/api/push", {
        data: { protocolVersion: 2, expectedOwnerUserId: 1, mutations: [] },
      }),
      request.get("/_serverFn/not-a-real-function"),
      request.get("/not-a-real-asset.js"),
    ]);
    const [pushBody, serverFunctionBody, scriptBody] = await Promise.all([
      push.text(),
      serverFunction.text(),
      script.text(),
    ]);

    expect(push.status()).toBe(401);
    expect(push.headers()["content-type"]).toBe("text/plain;charset=UTF-8");
    expect(pushBody).toBe("Unauthorized");

    expect(serverFunction.status()).toBe(403);
    expect(serverFunction.headers()["content-type"]).toBe("text/plain;charset=UTF-8");

    expect(script.status()).toBe(404);
    expect(script.headers()["content-type"]).toBe("text/html; charset=utf-8");
    expect(scriptBody).toContain("Oops! Page not found");

    for (const body of [pushBody, serverFunctionBody, scriptBody]) {
      expect(body).not.toBe(successfulShellBody);
    }
  },
);

test("the HTTP push route returns the production protocol shape", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const result = await page.evaluate(async (expectedOwnerUserId) => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        expectedOwnerUserId,
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
  }, ownerUserId);

  expect(result.status).toBe(200);
  expect(result.body).toEqual({
    protocolVersion: 2,
    ownerUserId,
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

test("the HTTP push route rejects a replica owner mismatch", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const result = await page.evaluate(async (expectedOwnerUserId) => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        protocolVersion: 2,
        expectedOwnerUserId,
        mutations: [
          {
            mutationId: "01994f62-b486-7000-8000-000000000091",
            rowId: "01994f62-b486-7000-8000-000000000092",
            baseUpdatedAt: null,
            table: "profiles",
            op: "upsert",
            payload: { name: "Must not be written" },
          },
        ],
      }),
    });
    const body = (await response.json()) as { code?: string };
    return { status: response.status, code: body.code };
  }, ownerUserId + 1);

  expect(result).toEqual({ status: 409, code: "REPLICA_OWNER_MISMATCH" });
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

test("a rejected non-empty legacy push leaves no row or receipt before a v2 retry", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const mutationId = randomUUID();
  const rowId = randomUUID();
  const legacyMutation = {
    mutationId,
    rowId,
    baseUpdatedAt: null,
    table: "profiles",
    op: "upsert",
    payload: { name: "Legacy intent must not be written" },
  } as const;

  const legacyFailure = await page.evaluate(async (mutation) => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations: [mutation] }),
    });
    const body = (await response.json()) as { code?: string };
    return { status: response.status, code: body.code };
  }, legacyMutation);

  expect(legacyFailure).toEqual({ status: 426, code: "SYNC_PROTOCOL_UNSUPPORTED" });

  const accepted = await page.evaluate(
    async ({ expectedOwnerUserId, rejectedMutation }) => {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2,
          expectedOwnerUserId,
          mutations: [
            {
              ...rejectedMutation,
              payload: { name: "Accepted v2 intent" },
            },
          ],
        }),
      });
      const body = (await response.json()) as {
        applied: string[];
        canonicalRows: { profiles: Array<{ id: string; name: string; deletedAt: string | null }> };
        conflicts: unknown[];
      };
      return { status: response.status, body };
    },
    { expectedOwnerUserId: ownerUserId, rejectedMutation: legacyMutation },
  );

  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([mutationId]);
  expect(accepted.body.conflicts).toEqual([]);
  expect(accepted.body.canonicalRows.profiles).toEqual([
    expect.objectContaining({ id: rowId, name: "Accepted v2 intent", deletedAt: null }),
  ]);
});
