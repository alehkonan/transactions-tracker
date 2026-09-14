import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "../fixtures/auth";
import { readReplicaOwnerUserId } from "../fixtures/indexed-db";
import type { Page } from "@playwright/test";

type Mutation = {
  mutationId: string;
  rowId: string;
  baseUpdatedAt: number | null;
  table: "profiles";
  op: "upsert" | "delete";
  payload?: { name: string };
};

type ProfileRow = {
  id: string;
  name: string;
  updatedAt: string;
  deletedAt: string | null;
};

type PushConflict = {
  mutationId: string;
  table: "profiles";
  rowId: string;
  classification: "intent-applied" | "canonical-deleted" | "canonical-diverged";
  baseUpdatedAt: number | null;
  conflictingServerUpdatedAt: number;
  acceptedAt: string;
  canonicalRow: ProfileRow | null;
};

type PushResult = {
  protocolVersion: number;
  ownerUserId: number;
  applied: string[];
  canonicalRows: { profiles: ProfileRow[] };
  conflicts: PushConflict[];
};

type ErrorResult = { code: string; error: string; mutationId?: string };

async function push<Body = PushResult>(
  page: Page,
  ownerUserId: number,
  mutations: Mutation[],
): Promise<{ status: number; body: Body }> {
  return page.evaluate(
    async ({ expectedOwnerUserId, submittedMutations }) => {
      const response = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          protocolVersion: 2,
          expectedOwnerUserId,
          mutations: submittedMutations,
        }),
      });
      return { status: response.status, body: (await response.json()) as Body };
    },
    { expectedOwnerUserId: ownerUserId, submittedMutations: mutations },
  );
}

function profileMutation(profileId: string, name: string, baseUpdatedAt: number | null): Mutation {
  return {
    mutationId: randomUUID(),
    rowId: profileId,
    baseUpdatedAt,
    table: "profiles",
    op: "upsert",
    payload: { name },
  };
}

function canonicalProfile(result: PushResult, profileId: string): ProfileRow {
  const profile = result.canonicalRows.profiles.find((row) => row.id === profileId);
  if (!profile) throw new Error(`Push response omitted canonical profile ${profileId}.`);
  return profile;
}

test("an identical stale-base retry replays its immutable acceptance outcome", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const profileId = randomUUID();

  const createdMutation = profileMutation(profileId, "Initial profile", null);
  const created = await push(page, ownerUserId, [createdMutation]);
  expect(created.status).toBe(200);
  const initial = canonicalProfile(created.body, profileId);

  const concurrentMutation = profileMutation(
    profileId,
    "Server version before acceptance",
    Date.parse(initial.updatedAt),
  );
  const concurrent = await push(page, ownerUserId, [concurrentMutation]);
  expect(concurrent.status).toBe(200);

  const staleMutation = profileMutation(
    profileId,
    "Accepted stale intent",
    Date.parse(initial.updatedAt),
  );
  const accepted = await push(page, ownerUserId, [staleMutation]);
  expect(accepted.status).toBe(200);
  expect(accepted.body.applied).toEqual([staleMutation.mutationId]);
  expect(accepted.body.conflicts).toEqual([
    expect.objectContaining({
      mutationId: staleMutation.mutationId,
      rowId: profileId,
      classification: "intent-applied",
      baseUpdatedAt: Date.parse(initial.updatedAt),
      canonicalRow: expect.objectContaining({ id: profileId, name: "Accepted stale intent" }),
      acceptedAt: expect.any(String),
    }),
  ]);
  const originalOutcome = accepted.body.conflicts[0];
  const acceptedCanonical = canonicalProfile(accepted.body, profileId);

  const laterMutation = profileMutation(
    profileId,
    "Later server version",
    Date.parse(acceptedCanonical.updatedAt),
  );
  const later = await push(page, ownerUserId, [laterMutation]);
  expect(later.status).toBe(200);

  const replayed = await push(page, ownerUserId, [staleMutation]);
  expect(replayed.status).toBe(200);
  expect(replayed.body.applied).toEqual([staleMutation.mutationId]);
  expect(replayed.body.conflicts).toEqual([originalOutcome]);
  expect(canonicalProfile(replayed.body, profileId).name).toBe("Later server version");
});

test("reusing an accepted mutation id rejects the entire HTTP batch", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const acceptedProfileId = randomUUID();
  const acceptedMutation = profileMutation(acceptedProfileId, "Original accepted intent", null);
  const accepted = await push(page, ownerUserId, [acceptedMutation]);
  expect(accepted.status).toBe(200);

  const uncommittedProfileId = randomUUID();
  const uncommittedMutation = profileMutation(uncommittedProfileId, "Must roll back", null);
  const mismatchedMutation: Mutation = {
    ...acceptedMutation,
    payload: { name: "Replacement intent" },
  };
  const rejected = await push<ErrorResult>(page, ownerUserId, [
    uncommittedMutation,
    mismatchedMutation,
  ]);

  expect(rejected).toEqual({
    status: 409,
    body: {
      code: "MUTATION_INTENT_MISMATCH",
      error: "A previously accepted mutation id was reused with different content.",
      mutationId: acceptedMutation.mutationId,
    },
  });

  const acceptedAfterRollback = await push(page, ownerUserId, [uncommittedMutation]);
  expect(acceptedAfterRollback.status).toBe(200);
  expect(acceptedAfterRollback.body.conflicts).toEqual([]);
  expect(canonicalProfile(acceptedAfterRollback.body, uncommittedProfileId).name).toBe(
    "Must roll back",
  );
});

test("a conflict-free receipt does not fabricate a conflict after later changes", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const profileId = randomUUID();
  const originalMutation = profileMutation(profileId, "Conflict-free accepted intent", null);
  const accepted = await push(page, ownerUserId, [originalMutation]);
  expect(accepted.status).toBe(200);
  expect(accepted.body.conflicts).toEqual([]);
  const original = canonicalProfile(accepted.body, profileId);

  const laterMutation = profileMutation(
    profileId,
    "Later server change",
    Date.parse(original.updatedAt),
  );
  const later = await push(page, ownerUserId, [laterMutation]);
  expect(later.status).toBe(200);

  const replayed = await push(page, ownerUserId, [originalMutation]);
  expect(replayed.status).toBe(200);
  expect(replayed.body.applied).toEqual([originalMutation.mutationId]);
  expect(replayed.body.conflicts).toEqual([]);
  expect(canonicalProfile(replayed.body, profileId).name).toBe("Later server change");
});

test("a stale mutation reports the actual canonical deletion and replays it unchanged", async ({
  authenticatedPage: page,
}) => {
  const ownerUserId = await readReplicaOwnerUserId(page);
  const profileId = randomUUID();
  const createdMutation = profileMutation(profileId, "Profile to delete", null);
  const created = await push(page, ownerUserId, [createdMutation]);
  expect(created.status).toBe(200);
  const initial = canonicalProfile(created.body, profileId);

  const deletion: Mutation = {
    mutationId: randomUUID(),
    rowId: profileId,
    baseUpdatedAt: Date.parse(initial.updatedAt),
    table: "profiles",
    op: "delete",
  };
  const deleted = await push(page, ownerUserId, [deletion]);
  expect(deleted.status).toBe(200);

  const staleMutation = profileMutation(
    profileId,
    "This intent cannot revive a tombstone",
    Date.parse(initial.updatedAt),
  );
  const accepted = await push(page, ownerUserId, [staleMutation]);
  expect(accepted.status).toBe(200);
  expect(accepted.body.conflicts).toEqual([
    expect.objectContaining({
      mutationId: staleMutation.mutationId,
      rowId: profileId,
      classification: "canonical-deleted",
      canonicalRow: expect.objectContaining({
        id: profileId,
        name: "Profile to delete",
        deletedAt: expect.any(String),
      }),
    }),
  ]);

  const replayed = await push(page, ownerUserId, [staleMutation]);
  expect(replayed.status).toBe(200);
  expect(replayed.body.conflicts).toEqual(accepted.body.conflicts);
});
