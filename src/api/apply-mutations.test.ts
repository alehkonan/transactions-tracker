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
    const serverTimes = mutations.map((_, index) => new Date(`2026-09-18T00:00:0${index}.000Z`));
    const canonicalAccounts = mutations.map((mutation, index) => [
      {
        id: accountId,
        ...mutation.payload,
        updatedAt: serverTimes[index],
        deletedAt: null,
      },
    ]);
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
      "conflict.read.accounts": mutations.map((_, index) => [
        { id: accountId, updatedAt: serverTimes[index] },
      ]),
      "mutation.upsert.accounts": mutations.map(() => [{ id: accountId, profileId }]),
      "canonical.read.accounts": canonicalAccounts,
      "receipt.persist-outcomes": mutations.map(() => undefined),
      "balance.recompute": [undefined],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, mutations);

    const expectedRunOperations = mutations.flatMap(
      () =>
        [
          "conflict.read.accounts",
          "mutation.upsert.accounts",
          "canonical.read.accounts",
          "receipt.persist-outcomes",
        ] satisfies ApplyMutationOperation[],
    );
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "authorization.owned-profiles",
      ...expectedRunOperations,
      "balance.recompute",
    ]);
    expect(
      operations.filter((operation) => operation === "authorization.owned-profiles"),
    ).toHaveLength(1);
    expect(result.conflicts.map((conflict) => conflict.mutationId)).toEqual(
      mutations.map((mutation) => mutation.mutationId),
    );
    expect(result.profileIds).toEqual(new Set([profileId]));
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
      "conflict.read.profiles": [[{ id: profileId, updatedAt: serverUpdatedAt }]],
      "mutation.upsert.profiles": [[{ id: profileId, name: "Renamed" }]],
      "canonical.read.profiles": [
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
      "conflict.read.accounts": [[{ id: accountId, updatedAt: serverUpdatedAt }]],
      "mutation.upsert.accounts": [[{ id: accountId, profileId }]],
      "canonical.read.accounts": [
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
      "receipt.persist-outcomes": [undefined, undefined],
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
