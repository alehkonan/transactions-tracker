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
      "authorization.owned-profiles": mutations.map(() => [{ id: profileId }]),
      "conflict.read.accounts": mutations.map((_, index) => [
        { id: accountId, updatedAt: serverTimes[index] },
      ]),
      "authorization.target-profiles": mutations.map(() => undefined),
      "mutation.upsert.accounts": mutations.map(() => [{ id: accountId }]),
      "canonical.read-owned-profiles": mutations.map(() => [{ id: profileId }]),
      "canonical.read.accounts": canonicalAccounts,
      "acceptance.profile-labels": mutations.map(() => [{ id: profileId, name: "Main" }]),
      "receipt.persist-outcomes": mutations.map(() => undefined),
      "balance.recompute": [undefined],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, mutations);

    const expectedRunOperations = mutations.flatMap(
      () =>
        [
          "authorization.owned-profiles",
          "conflict.read.accounts",
          "authorization.target-profiles",
          "mutation.upsert.accounts",
          "canonical.read-owned-profiles",
          "canonical.read.accounts",
          "acceptance.profile-labels",
          "receipt.persist-outcomes",
        ] satisfies ApplyMutationOperation[],
    );
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      ...expectedRunOperations,
      "balance.recompute",
    ]);
    expect(operations.length).toBeGreaterThan(mutations.length + 9);
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
      "conflict.read.profiles": [[]],
      "authorization.live-profiles": [[]],
      "mutation.tombstone.profiles": [[]],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, [mutation]);

    expect(result.profileIds).toEqual(new Set());
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "conflict.read.profiles",
      "authorization.live-profiles",
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
      "conflict.read.profiles": [[]],
      "mutation.upsert.profiles": [[{ id: profileId }]],
      "authorization.owned-profiles": [[{ id: profileId }], [{ id: profileId }]],
      "conflict.read.accounts": [[]],
      "conflict.read.transactions": [[]],
      "authorization.target-profiles": [undefined, undefined],
      "mutation.upsert.accounts": [[{ id: accountId }]],
      "authorization.transaction-accounts": [undefined],
      "mutation.upsert.transactions": [[{ id: transactionId }]],
      "balance.recompute": [undefined],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, mutations);

    expect(result.applied).toEqual(mutations.map((mutation) => mutation.mutationId));
    expect(result.profileIds).toEqual(new Set([profileId]));
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "conflict.read.profiles",
      "mutation.upsert.profiles",
      "authorization.owned-profiles",
      "conflict.read.accounts",
      "authorization.target-profiles",
      "mutation.upsert.accounts",
      "authorization.owned-profiles",
      "conflict.read.transactions",
      "authorization.target-profiles",
      "authorization.transaction-accounts",
      "mutation.upsert.transactions",
      "balance.recompute",
    ]);
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
      "conflict.read.profiles": [[]],
      "mutation.upsert.profiles": [[]],
    });
    const applyMutations = createApplyMutations(runOperation);

    const result = await applyMutations({} as Executor, userId, [mutation]);

    expect(result.profileIds).toEqual(new Set());
    expect(operations).toEqual([
      "receipt.claim",
      "receipt.read",
      "conflict.read.profiles",
      "mutation.upsert.profiles",
    ]);
  });
});
