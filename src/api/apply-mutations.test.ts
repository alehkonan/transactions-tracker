import { describe, expect, it } from "vitest";
import {
  createApplyMutations,
  type ApplyMutationOperation,
  type ApplyMutationOperationRunner,
} from "./apply-mutations.server";
import { fingerprintMutation } from "./mutation-receipts.server";
import type { Executor } from "~/database/get-db.server";
import type { Mutation } from "~/modules/sync/sync-types";

const userId = 42;
const profileId = "00000000-0000-7000-8000-000000000001";
const accountId = "00000000-0000-7000-8000-000000000002";

function createRecordingRunner(results: Partial<Record<ApplyMutationOperation, unknown[]>>): {
  operations: ApplyMutationOperation[];
  runOperation: ApplyMutationOperationRunner;
} {
  const operations: ApplyMutationOperation[] = [];
  const runOperation: ApplyMutationOperationRunner = async <Result>(
    operation: ApplyMutationOperation,
  ) => {
    operations.push(operation);
    const queued = results[operation];
    if (!queued || queued.length === 0) {
      throw new Error(`No recorded result for ${operation}.`);
    }
    return queued.shift() as Result;
  };
  return { operations, runOperation };
}

describe("createApplyMutations", () => {
  it("records the current query pressure for repeated stale account runs", async () => {
    const mutations = [1, 2, 3].map(
      (sequence) =>
        ({
          mutationId: `00000000-0000-7000-8000-00000000002${sequence}`,
          rowId: accountId,
          baseUpdatedAt: 1_700_000_000_000 + sequence,
          table: "accounts",
          op: "upsert",
          payload: {
            name: `Account ${sequence}`,
            initialBalance: `${sequence}.00`,
            currencyCode: "USD",
            status: "ACTIVE",
            type: "CURRENT",
            profileId,
          },
        }) satisfies Mutation,
    );
    const serverTimes = [0, 1, 2, 3].map((index) => new Date(`2026-09-18T00:00:0${index}.000Z`));
    const initialAccount = {
      id: accountId,
      ...mutations[0].payload,
      name: "Before",
      updatedAt: serverTimes[0],
      deletedAt: null,
    };
    const returnedAccounts = mutations.map((mutation, index) => ({
      id: accountId,
      ...mutation.payload,
      updatedAt: serverTimes[index + 1],
      deletedAt: null,
    }));
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [mutations.map((mutation) => ({ mutationId: mutation.mutationId }))],
      "receipt.read": [
        mutations.map((mutation, index) => ({
          mutationId: mutation.mutationId,
          intentFingerprint: fingerprintMutation(mutation),
          conflictOutcome: null,
          appliedAt: new Date(`2026-09-18T01:00:0${index}.000Z`),
        })),
      ],
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "conflict.read.accounts": [[initialAccount]],
      "mutation.upsert.accounts": returnedAccounts.map((account) => [account]),
      "receipt.persist-outcomes": [
        mutations.map((mutation) => ({ mutationId: mutation.mutationId })),
      ],
      "balance.recompute": [undefined],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, mutations);

    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "authorization.owned-profiles",
      "conflict.read.accounts",
      "mutation.upsert.accounts",
      "mutation.upsert.accounts",
      "mutation.upsert.accounts",
      "receipt.persist-outcomes",
      "balance.recompute",
    ]);
    expect(operations.length).toBeLessThanOrEqual(mutations.length + 9);
    expect(operations.filter((operation) => operation === "mutation.upsert.accounts")).toHaveLength(
      mutations.length,
    );
    expect(operations.filter((operation) => operation === "receipt.persist-outcomes")).toHaveLength(
      1,
    );
    expect(operations.join(",")).not.toContain("canonical.read.accounts");
    expect(
      operations.filter((operation) => operation === "authorization.owned-profiles"),
    ).toHaveLength(1);
    expect(result.conflicts.map((conflict) => conflict.mutationId)).toEqual(
      mutations.map((mutation) => mutation.mutationId),
    );
    expect(result.conflicts.map((conflict) => conflict.canonicalRow)).toEqual(
      returnedAccounts.map((account) => ({
        id: account.id,
        name: account.name,
        initialBalance: account.initialBalance,
        currencyCode: account.currencyCode,
        status: account.status,
        type: account.type,
        profileId: account.profileId,
        updatedAt: account.updatedAt.toISOString(),
        deletedAt: account.deletedAt,
      })),
    );
    expect(
      result.conflicts.every((conflict) => !("balance" in (conflict.canonicalRow ?? {}))),
    ).toBe(true);
    expect(result.profileIds).toEqual(new Set([profileId]));
  });

  it("freezes upsert, delete, and guarded-upsert outcomes from each ordered run", async () => {
    const upsertPayload = {
      name: "Changed",
      initialBalance: "10.00",
      currencyCode: "USD",
      status: "ACTIVE",
      type: "CURRENT",
      profileId,
    } as const;
    const mutations = [
      {
        mutationId: "00000000-0000-7000-8000-000000000071",
        rowId: accountId,
        baseUpdatedAt: 1,
        table: "accounts",
        op: "upsert",
        payload: upsertPayload,
      },
      {
        mutationId: "00000000-0000-7000-8000-000000000072",
        rowId: accountId,
        baseUpdatedAt: 2,
        table: "accounts",
        op: "delete",
      },
      {
        mutationId: "00000000-0000-7000-8000-000000000073",
        rowId: accountId,
        baseUpdatedAt: 3,
        table: "accounts",
        op: "upsert",
        payload: upsertPayload,
      },
    ] satisfies Mutation[];
    const initialUpdatedAt = new Date("2026-09-18T00:00:00.000Z");
    const upsertedAt = new Date("2026-09-18T00:00:01.000Z");
    const deletedAt = new Date("2026-09-18T00:00:02.000Z");
    const initialAccount = {
      id: accountId,
      name: "Before",
      initialBalance: "0.00",
      currencyCode: "USD" as const,
      status: "ACTIVE" as const,
      type: "CURRENT" as const,
      profileId,
      updatedAt: initialUpdatedAt,
      deletedAt: null,
    };
    const upsertedAccount = {
      id: accountId,
      ...upsertPayload,
      updatedAt: upsertedAt,
      deletedAt: null,
    };
    const tombstonedAccount = {
      ...upsertedAccount,
      updatedAt: deletedAt,
      deletedAt,
    };
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [mutations.map(({ mutationId }) => ({ mutationId }))],
      "receipt.read": [
        mutations.map((mutation, index) => ({
          mutationId: mutation.mutationId,
          intentFingerprint: fingerprintMutation(mutation),
          conflictOutcome: null,
          appliedAt: new Date(`2026-09-18T01:00:0${index}.000Z`),
        })),
      ],
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "conflict.read.accounts": [[initialAccount]],
      "mutation.upsert.accounts": [[upsertedAccount], []],
      "mutation.tombstone.accounts": [[tombstonedAccount]],
      "mutation.tombstone.transactions": [[]],
      "receipt.persist-outcomes": [mutations.map(({ mutationId }) => ({ mutationId }))],
      "balance.recompute": [undefined],
    });

    const result = await createApplyMutations(runOperation)({} as Executor, userId, mutations);

    expect(result.conflicts.map((conflict) => conflict.classification)).toEqual([
      "intent-applied",
      "intent-applied",
      "canonical-deleted",
    ]);
    expect(result.conflicts.map((conflict) => conflict.canonicalRow)).toEqual([
      {
        id: accountId,
        ...upsertPayload,
        updatedAt: upsertedAt.toISOString(),
        deletedAt: null,
      },
      {
        id: accountId,
        ...upsertPayload,
        updatedAt: deletedAt.toISOString(),
        deletedAt: deletedAt.toISOString(),
      },
      {
        id: accountId,
        ...upsertPayload,
        updatedAt: deletedAt.toISOString(),
        deletedAt: deletedAt.toISOString(),
      },
    ]);
    expect(operations.filter((operation) => operation === "conflict.read.accounts")).toHaveLength(
      1,
    );
    expect(operations.filter((operation) => operation === "receipt.persist-outcomes")).toHaveLength(
      1,
    );
  });

  it("uses the authorized pre-write row when a cross-profile guard rejects an upsert", async () => {
    const otherProfileId = "00000000-0000-7000-8000-000000000004";
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000081",
      rowId: accountId,
      baseUpdatedAt: 1,
      table: "accounts",
      op: "upsert",
      payload: {
        name: "Moved",
        initialBalance: "0.00",
        currencyCode: "USD",
        status: "ACTIVE",
        type: "CURRENT",
        profileId: otherProfileId,
      },
    } satisfies Mutation;
    const serverUpdatedAt = new Date("2026-09-18T00:00:00.000Z");
    const canonicalAccount = {
      id: accountId,
      name: "Main wallet",
      initialBalance: "0.00",
      currencyCode: "USD" as const,
      status: "ACTIVE" as const,
      type: "CURRENT" as const,
      profileId,
      updatedAt: serverUpdatedAt,
      deletedAt: null,
    };
    const { runOperation } = createRecordingRunner({
      "receipt.claim": [[{ mutationId: mutation.mutationId }]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:01.000Z"),
          },
        ],
      ],
      "authorization.owned-profiles": [
        [
          { id: profileId, name: "Main", deletedAt: null },
          { id: otherProfileId, name: "Other", deletedAt: null },
        ],
      ],
      "conflict.read.accounts": [[canonicalAccount]],
      "mutation.upsert.accounts": [[]],
      "receipt.persist-outcomes": [[{ mutationId: mutation.mutationId }]],
    });

    const result = await createApplyMutations(runOperation)({} as Executor, userId, [mutation]);

    expect(result.conflicts).toMatchObject([
      {
        classification: "canonical-diverged",
        presentationContext: { profileId, profileName: "Main", entityLabel: "Main wallet" },
        canonicalRow: {
          id: accountId,
          profileId,
          name: "Main wallet",
          updatedAt: serverUpdatedAt.toISOString(),
        },
      },
    ]);
    expect(result.profileIds).toEqual(new Set());
  });

  it("captures a category's resolved color id from the write result", async () => {
    const categoryId = "00000000-0000-7000-8000-000000000005";
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000091",
      rowId: categoryId,
      baseUpdatedAt: 1,
      table: "categories",
      op: "upsert",
      payload: { name: "Food", profileId, colorId: 7 },
    } satisfies Mutation;
    const serverUpdatedAt = new Date("2026-09-18T00:00:00.000Z");
    const writtenAt = new Date("2026-09-18T00:00:01.000Z");
    const { runOperation } = createRecordingRunner({
      "receipt.claim": [[{ mutationId: mutation.mutationId }]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:02.000Z"),
          },
        ],
      ],
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "conflict.read.categories": [
        [
          {
            id: categoryId,
            name: "Old food",
            profileId,
            colorId: 1,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "mutation.upsert.categories": [
        [
          {
            id: categoryId,
            name: "Food",
            profileId,
            colorId: 7,
            updatedAt: writtenAt,
            deletedAt: null,
          },
        ],
      ],
      "receipt.persist-outcomes": [[{ mutationId: mutation.mutationId }]],
      "balance.recompute": [undefined],
    });

    const result = await createApplyMutations(runOperation)({} as Executor, userId, [mutation]);

    expect(result.conflicts[0]?.canonicalRow).toMatchObject({
      id: categoryId,
      colorId: 7,
      updatedAt: writtenAt.toISOString(),
    });
  });

  it("fails the batch when the bulk outcome update misses an expected receipt", async () => {
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000101",
      rowId: profileId,
      baseUpdatedAt: 1,
      table: "profiles",
      op: "upsert",
      payload: { name: "Renamed" },
    } satisfies Mutation;
    const serverUpdatedAt = new Date("2026-09-18T00:00:00.000Z");
    const writtenAt = new Date("2026-09-18T00:00:01.000Z");
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [[{ mutationId: mutation.mutationId }]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:02.000Z"),
          },
        ],
      ],
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "conflict.read.profiles": [
        [
          {
            id: profileId,
            name: "Main",
            userId,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "mutation.upsert.profiles": [
        [
          {
            id: profileId,
            name: "Renamed",
            userId,
            updatedAt: writtenAt,
            deletedAt: null,
          },
        ],
      ],
      "receipt.persist-outcomes": [[]],
    });

    await expect(
      createApplyMutations(runOperation)({} as Executor, userId, [mutation]),
    ).rejects.toThrow("Not all acceptance outcomes were persisted.");
    expect(operations).not.toContain("balance.recompute");
  });

  it("does not cascade or recompute balances for a foreign profile delete", async () => {
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000031",
      rowId: profileId,
      baseUpdatedAt: null,
      table: "profiles",
      op: "delete",
    } satisfies Mutation;
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [[{ mutationId: mutation.mutationId }]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:00.000Z"),
          },
        ],
      ],
      "authorization.owned-profiles": [[]],
      "conflict.read.profiles": [[]],
      "mutation.tombstone.profiles": [[]],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, [mutation]);

    expect(result.profileIds).toEqual(new Set());
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "authorization.owned-profiles",
      "conflict.read.profiles",
      "mutation.tombstone.profiles",
    ]);
  });

  it("tracks every proven profile across a dependent batch in submitted order", async () => {
    const transactionId = "00000000-0000-7000-8000-000000000003";
    const mutations = [
      {
        mutationId: "00000000-0000-7000-8000-000000000041",
        rowId: profileId,
        baseUpdatedAt: null,
        table: "profiles",
        op: "upsert",
        payload: { name: "Main" },
      },
      {
        mutationId: "00000000-0000-7000-8000-000000000042",
        rowId: accountId,
        baseUpdatedAt: null,
        table: "accounts",
        op: "upsert",
        payload: {
          name: "Wallet",
          initialBalance: "0.00",
          currencyCode: "USD",
          status: "ACTIVE",
          type: "CURRENT",
          profileId,
        },
      },
      {
        mutationId: "00000000-0000-7000-8000-000000000043",
        rowId: transactionId,
        baseUpdatedAt: null,
        table: "transactions",
        op: "upsert",
        payload: {
          type: "EXPENSE",
          necessityLevel: "MEDIUM",
          amount: "12.50",
          comment: "Lunch",
          createdAt: new Date("2026-09-18T12:00:00.000Z"),
          accountId,
          categoryId: null,
          profileId,
        },
      },
    ] satisfies Mutation[];
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [mutations.map((mutation) => ({ mutationId: mutation.mutationId }))],
      "receipt.read": [
        mutations.map((mutation) => ({
          mutationId: mutation.mutationId,
          intentFingerprint: fingerprintMutation(mutation),
          conflictOutcome: null,
          appliedAt: new Date("2026-09-18T12:00:01.000Z"),
        })),
      ],
      "authorization.owned-profiles": [[]],
      "conflict.read.profiles": [[]],
      "mutation.upsert.profiles": [[{ id: profileId, name: "Main" }]],
      "conflict.read.accounts": [[]],
      "conflict.read.transactions": [[]],
      "mutation.upsert.accounts": [[{ id: accountId, profileId }]],
      "mutation.upsert.transactions": [[{ id: transactionId, profileId }]],
      "balance.recompute": [undefined],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, mutations);

    expect(result.applied).toEqual(mutations.map((mutation) => mutation.mutationId));
    expect(result.profileIds).toEqual(new Set([profileId]));
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "authorization.owned-profiles",
      "conflict.read.profiles",
      "mutation.upsert.profiles",
      "conflict.read.accounts",
      "mutation.upsert.accounts",
      "conflict.read.transactions",
      "mutation.upsert.transactions",
      "balance.recompute",
    ]);
  });

  it("uses a profile rename only for later acceptance presentation", async () => {
    const accountMutationId = "00000000-0000-7000-8000-000000000062";
    const mutations = [
      {
        mutationId: "00000000-0000-7000-8000-000000000061",
        rowId: profileId,
        baseUpdatedAt: 1,
        table: "profiles",
        op: "upsert",
        payload: { name: "Renamed" },
      },
      {
        mutationId: accountMutationId,
        rowId: accountId,
        baseUpdatedAt: 1,
        table: "accounts",
        op: "upsert",
        payload: {
          name: "Wallet",
          initialBalance: "0.00",
          currencyCode: "USD",
          status: "ACTIVE",
          type: "CURRENT",
          profileId,
        },
      },
    ] satisfies Mutation[];
    const serverUpdatedAt = new Date("2026-09-18T00:00:00.000Z");
    const { runOperation } = createRecordingRunner({
      "receipt.claim": [mutations.map(({ mutationId }) => ({ mutationId }))],
      "receipt.read": [
        mutations.map((mutation) => ({
          mutationId: mutation.mutationId,
          intentFingerprint: fingerprintMutation(mutation),
          conflictOutcome: null,
          appliedAt: new Date("2026-09-18T00:00:01.000Z"),
        })),
      ],
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "conflict.read.profiles": [
        [
          {
            id: profileId,
            name: "Main",
            userId,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "mutation.upsert.profiles": [
        [
          {
            id: profileId,
            name: "Renamed",
            userId,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "conflict.read.accounts": [
        [
          {
            id: accountId,
            name: "Before",
            initialBalance: "0.00",
            currencyCode: "USD",
            status: "ACTIVE",
            type: "CURRENT",
            profileId,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "mutation.upsert.accounts": [
        [
          {
            id: accountId,
            name: "Wallet",
            initialBalance: "0.00",
            currencyCode: "USD",
            status: "ACTIVE",
            type: "CURRENT",
            profileId,
            updatedAt: serverUpdatedAt,
            deletedAt: null,
          },
        ],
      ],
      "receipt.persist-outcomes": [mutations.map(({ mutationId }) => ({ mutationId }))],
      "balance.recompute": [undefined],
    });

    const result = await createApplyMutations(runOperation)({} as Executor, userId, mutations);

    expect(result.conflicts.map((conflict) => conflict.presentationContext.profileName)).toEqual([
      "Main",
      "Renamed",
    ]);
  });

  it("skips authorization context loads for an all-receipted replay", async () => {
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000051",
      rowId: accountId,
      baseUpdatedAt: null,
      table: "accounts",
      op: "delete",
    } satisfies Mutation;
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [[]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:00.000Z"),
          },
        ],
      ],
    });

    const result = await createApplyMutations(runOperation)({} as Executor, userId, [mutation]);

    expect(result.applied).toEqual([mutation.mutationId]);
    expect(operations).toEqual(["receipt.claim", "receipt.read"]);
  });

  it("does not schedule balance recomputation for a guarded foreign profile collision", async () => {
    const mutation = {
      mutationId: "00000000-0000-7000-8000-000000000011",
      rowId: profileId,
      baseUpdatedAt: null,
      table: "profiles",
      op: "upsert",
      payload: { name: "Foreign profile" },
    } satisfies Mutation;
    const { operations, runOperation } = createRecordingRunner({
      "receipt.claim": [[{ mutationId: mutation.mutationId }]],
      "receipt.read": [
        [
          {
            mutationId: mutation.mutationId,
            intentFingerprint: fingerprintMutation(mutation),
            conflictOutcome: null,
            appliedAt: new Date("2026-09-18T00:00:00.000Z"),
          },
        ],
      ],
      "authorization.owned-profiles": [[]],
      "conflict.read.profiles": [[]],
      "mutation.upsert.profiles": [[]],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, [mutation]);

    expect(result.profileIds).toEqual(new Set());
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "authorization.owned-profiles",
      "conflict.read.profiles",
      "mutation.upsert.profiles",
    ]);
  });
});
