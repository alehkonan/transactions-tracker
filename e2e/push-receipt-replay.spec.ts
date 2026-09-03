import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "../src/database/get-db.server";
import {
  accountsTable,
  mutationReceiptsTable,
  profilesTable,
  usersTable,
} from "../src/database/tables";
import { test } from "./fixtures/auth";
import type { Mutation, PushChangesResult } from "../src/modules/sync/sync-types";
import type { Page } from "@playwright/test";

type PushResponse = {
  status: number;
  body: PushChangesResult;
};

async function pushThroughServerFunction(page: Page, mutation: Mutation): Promise<PushResponse> {
  return page.evaluate(async (submittedMutation) => {
    const modulePath = "/src/api/sync.functions.ts";
    const { pushChanges } = (await import(/* @vite-ignore */ modulePath)) as {
      pushChanges(options: {
        data: { mutations: Mutation[] };
      }): Promise<PushChangesResult | Response>;
    };
    const result = await pushChanges({ data: { mutations: [submittedMutation] } });

    if (result instanceof Response) {
      return { status: result.status, body: (await result.json()) as PushChangesResult };
    }

    return { status: 200, body: result };
  }, mutation);
}

async function pushBatchThroughHttp<Body>(
  page: Page,
  mutations: Mutation[],
): Promise<{ status: number; body: Body }> {
  return page.evaluate(async (submittedMutations) => {
    const response = await fetch("/api/push", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mutations: submittedMutations }),
    });

    return { status: response.status, body: (await response.json()) as Body };
  }, mutations);
}

async function pushThroughHttp(page: Page, mutation: Mutation): Promise<PushResponse> {
  return pushBatchThroughHttp<PushChangesResult>(page, [mutation]);
}

test("identical retries replay the immutable stale-base outcome across authenticated transports", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      id: accountsTable.id,
      name: accountsTable.name,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const conflictingServerUpdatedAt = new Date(account.updatedAt.getTime() + 1_000);
  await db
    .update(accountsTable)
    .set({ name: "Server version before acceptance", updatedAt: conflictingServerUpdatedAt })
    .where(eq(accountsTable.id, account.id));

  const mutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "Accepted local version",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;

  const accepted = await pushThroughServerFunction(page, mutation);

  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([mutation.mutationId]);
  expect(accepted.body.conflicts).toEqual([
    expect.objectContaining({
      mutationId: mutation.mutationId,
      table: "accounts",
      rowId: account.id,
      classification: "intent-applied",
      baseUpdatedAt: account.updatedAt.getTime(),
      conflictingServerUpdatedAt: conflictingServerUpdatedAt.getTime(),
      canonicalRow: expect.objectContaining({
        id: account.id,
        name: mutation.payload.name,
      }),
      presentationContext: {
        profileId: account.profileId,
        profileName: "E2E Profile",
        entityLabel: mutation.payload.name,
      },
      acceptedAt: expect.any(String),
    }),
  ]);

  const originalOutcome = accepted.body.conflicts[0];
  const laterServerUpdatedAt = new Date(conflictingServerUpdatedAt.getTime() + 10_000);
  await db
    .update(accountsTable)
    .set({ name: "Later server version", updatedAt: laterServerUpdatedAt })
    .where(eq(accountsTable.id, account.id));

  const replayed = await pushThroughHttp(page, mutation);

  expect(replayed.status).toBe(200);
  expect(replayed.body.applied).toEqual([mutation.mutationId]);
  expect(replayed.body.conflicts).toEqual([originalOutcome]);

  const [committedAccount] = await db
    .select({ name: accountsTable.name, updatedAt: accountsTable.updatedAt })
    .from(accountsTable)
    .where(eq(accountsTable.id, account.id));
  expect(committedAccount).toEqual({
    name: "Later server version",
    updatedAt: laterServerUpdatedAt,
  });
});

test("reusing an accepted mutation id rejects the whole batch without replacement state", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      userId: usersTable.id,
      id: accountsTable.id,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const acceptedMutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "Original accepted intent",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;
  const accepted = await pushThroughHttp(page, acceptedMutation);
  expect(accepted.status).toBe(200);

  const uncommittedProfileId = randomUUID();
  const uncommittedMutationId = randomUUID();
  const uncommittedMutation = {
    mutationId: uncommittedMutationId,
    rowId: uncommittedProfileId,
    baseUpdatedAt: null,
    table: "profiles",
    op: "upsert",
    payload: { name: "Must roll back" },
  } satisfies Mutation;
  const mismatchedMutation = {
    ...acceptedMutation,
    payload: { ...acceptedMutation.payload, name: "Replacement intent" },
  } satisfies Mutation;

  const rejected = await pushBatchThroughHttp<{
    code: string;
    error: string;
    mutationId: string;
  }>(page, [uncommittedMutation, mismatchedMutation]);

  expect(rejected).toEqual({
    status: 409,
    body: {
      code: "MUTATION_INTENT_MISMATCH",
      error: "A previously accepted mutation id was reused with different content.",
      mutationId: acceptedMutation.mutationId,
    },
  });

  const [committedAccount, partialProfiles, receipts] = await Promise.all([
    db
      .select({ name: accountsTable.name })
      .from(accountsTable)
      .where(eq(accountsTable.id, account.id)),
    db
      .select({ id: profilesTable.id })
      .from(profilesTable)
      .where(eq(profilesTable.id, uncommittedProfileId)),
    db
      .select({
        mutationId: mutationReceiptsTable.mutationId,
        intentFingerprint: mutationReceiptsTable.intentFingerprint,
      })
      .from(mutationReceiptsTable)
      .where(
        and(
          eq(mutationReceiptsTable.userId, account.userId),
          inArray(mutationReceiptsTable.mutationId, [
            acceptedMutation.mutationId,
            uncommittedMutationId,
          ]),
        ),
      ),
  ]);
  expect(committedAccount).toEqual([{ name: acceptedMutation.payload.name }]);
  expect(partialProfiles).toEqual([]);
  expect(receipts).toEqual([
    {
      mutationId: acceptedMutation.mutationId,
      intentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
  ]);
});

test("a conflict-free acceptance does not fabricate a conflict after later changes", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      userId: usersTable.id,
      id: accountsTable.id,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const mutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "Conflict-free accepted intent",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;

  const accepted = await pushThroughHttp(page, mutation);
  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([mutation.mutationId]);
  expect(accepted.body.conflicts).toEqual([]);

  const [receipt] = await db
    .select({
      intentFingerprint: mutationReceiptsTable.intentFingerprint,
      conflictOutcome: mutationReceiptsTable.conflictOutcome,
    })
    .from(mutationReceiptsTable)
    .where(
      and(
        eq(mutationReceiptsTable.userId, account.userId),
        eq(mutationReceiptsTable.mutationId, mutation.mutationId),
      ),
    );
  expect(receipt).toEqual({
    intentFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    conflictOutcome: null,
  });

  const laterServerUpdatedAt = new Date(account.updatedAt.getTime() + 10_000);
  await db
    .update(accountsTable)
    .set({ name: "Later server change", updatedAt: laterServerUpdatedAt })
    .where(eq(accountsTable.id, account.id));

  const replayed = await pushThroughServerFunction(page, mutation);
  expect(replayed.status).toBe(200);
  expect(replayed.body.applied).toEqual([mutation.mutationId]);
  expect(replayed.body.conflicts).toEqual([]);

  const [committedAccount] = await db
    .select({ name: accountsTable.name, updatedAt: accountsTable.updatedAt })
    .from(accountsTable)
    .where(eq(accountsTable.id, account.id));
  expect(committedAccount).toEqual({
    name: "Later server change",
    updatedAt: laterServerUpdatedAt,
  });
});

test("a legacy receipt settles from current canonical state without invented history", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      userId: usersTable.id,
      id: accountsTable.id,
      name: accountsTable.name,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const mutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "Legacy retry must not execute",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;
  await db
    .insert(mutationReceiptsTable)
    .values({ userId: account.userId, mutationId: mutation.mutationId });

  const replayed = await pushThroughHttp(page, mutation);

  expect(replayed.status).toBe(200);
  expect(replayed.body.applied).toEqual([mutation.mutationId]);
  expect(replayed.body.conflicts).toEqual([]);
  expect(replayed.body.canonicalRows.accounts).toEqual([
    expect.objectContaining({ id: account.id, name: account.name }),
  ]);

  const [committedAccount, receipt] = await Promise.all([
    db
      .select({ name: accountsTable.name })
      .from(accountsTable)
      .where(eq(accountsTable.id, account.id)),
    db
      .select({
        intentFingerprint: mutationReceiptsTable.intentFingerprint,
        conflictOutcome: mutationReceiptsTable.conflictOutcome,
      })
      .from(mutationReceiptsTable)
      .where(
        and(
          eq(mutationReceiptsTable.userId, account.userId),
          eq(mutationReceiptsTable.mutationId, mutation.mutationId),
        ),
      ),
  ]);
  expect(committedAccount).toEqual([{ name: account.name }]);
  expect(receipt).toEqual([{ intentFingerprint: null, conflictOutcome: null }]);
});

test("a stale-base outcome classifies the actual canonical deletion", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      userId: usersTable.id,
      id: accountsTable.id,
      name: accountsTable.name,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const deletedAt = new Date(account.updatedAt.getTime() + 1_000);
  await db
    .update(accountsTable)
    .set({ deletedAt, updatedAt: deletedAt })
    .where(eq(accountsTable.id, account.id));

  const mutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "This intent cannot revive a tombstone",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;

  const accepted = await pushThroughHttp(page, mutation);

  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([mutation.mutationId]);
  expect(accepted.body.conflicts).toEqual([
    expect.objectContaining({
      mutationId: mutation.mutationId,
      classification: "canonical-deleted",
      baseUpdatedAt: account.updatedAt.getTime(),
      conflictingServerUpdatedAt: deletedAt.getTime(),
      canonicalRow: expect.objectContaining({
        id: account.id,
        name: account.name,
        deletedAt: deletedAt.toISOString(),
      }),
    }),
  ]);

  const [committedAccount, receipt] = await Promise.all([
    db
      .select({ name: accountsTable.name, deletedAt: accountsTable.deletedAt })
      .from(accountsTable)
      .where(eq(accountsTable.id, account.id)),
    db
      .select({ conflictOutcome: mutationReceiptsTable.conflictOutcome })
      .from(mutationReceiptsTable)
      .where(
        and(
          eq(mutationReceiptsTable.userId, account.userId),
          eq(mutationReceiptsTable.mutationId, mutation.mutationId),
        ),
      ),
  ]);
  expect(committedAccount).toEqual([{ name: account.name, deletedAt }]);
  expect(receipt).toEqual([{ conflictOutcome: accepted.body.conflicts[0] }]);
});

test("each stale mutation in one batch preserves its own canonical outcome", async ({
  authCredentials,
  onboardedPage: page,
}) => {
  const db = getDb();
  const [account] = await db
    .select({
      id: accountsTable.id,
      initialBalance: accountsTable.initialBalance,
      currencyCode: accountsTable.currencyCode,
      status: accountsTable.status,
      type: accountsTable.type,
      profileId: accountsTable.profileId,
      updatedAt: accountsTable.updatedAt,
    })
    .from(accountsTable)
    .innerJoin(profilesTable, eq(accountsTable.profileId, profilesTable.id))
    .innerJoin(usersTable, eq(profilesTable.userId, usersTable.id))
    .where(and(eq(usersTable.username, authCredentials.username), isNull(accountsTable.deletedAt)));

  expect(account).toBeDefined();
  if (!account || !account.profileId) throw new Error("The onboarded account was not found.");

  const conflictingServerUpdatedAt = new Date(account.updatedAt.getTime() + 1_000);
  await db
    .update(accountsTable)
    .set({ name: "Server version before the batch", updatedAt: conflictingServerUpdatedAt })
    .where(eq(accountsTable.id, account.id));

  const firstMutation = {
    mutationId: randomUUID(),
    rowId: account.id,
    baseUpdatedAt: account.updatedAt.getTime(),
    table: "accounts",
    op: "upsert",
    payload: {
      name: "First accepted account intent",
      initialBalance: account.initialBalance,
      currencyCode: account.currencyCode,
      status: account.status,
      type: account.type,
      profileId: account.profileId,
    },
  } satisfies Mutation;
  const secondMutation = {
    ...firstMutation,
    mutationId: randomUUID(),
    payload: { ...firstMutation.payload, name: "Second accepted account intent" },
  } satisfies Mutation;

  const accepted = await pushBatchThroughHttp<PushChangesResult>(page, [
    firstMutation,
    secondMutation,
  ]);

  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([firstMutation.mutationId, secondMutation.mutationId]);
  expect(accepted.body.conflicts).toHaveLength(2);
  expect(accepted.body.conflicts[0]).toMatchObject({
    mutationId: firstMutation.mutationId,
    classification: "intent-applied",
    canonicalRow: { name: firstMutation.payload.name },
    presentationContext: { entityLabel: firstMutation.payload.name },
  });
  expect(accepted.body.conflicts[1]).toMatchObject({
    mutationId: secondMutation.mutationId,
    classification: "intent-applied",
    canonicalRow: { name: secondMutation.payload.name },
    presentationContext: { entityLabel: secondMutation.payload.name },
  });
  expect(accepted.body.canonicalRows.accounts).toEqual([
    expect.objectContaining({ id: account.id, name: secondMutation.payload.name }),
  ]);
});
