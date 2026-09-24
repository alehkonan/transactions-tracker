import { describe, expect, it } from "vitest";
import {
  createBatchAuthorization,
  type BatchAuthorizationOperation,
  type BatchAuthorizationOperationRunner,
} from "./batch-authorization.server";
import type { Executor } from "~/database/get-db.server";
import type { Mutation } from "~/modules/sync/sync-types";

const profileId = "00000000-0000-7000-8000-000000000001";
const accountId = "00000000-0000-7000-8000-000000000002";
const categoryId = "00000000-0000-7000-8000-000000000003";

async function expectForbidden(action: () => unknown): Promise<void> {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(Response);
  const response = thrown as Response;
  expect(response.status).toBe(403);
  expect(await response.text()).toBe("That record does not belong to the selected profile.");
}

function mutation<Value extends Mutation>(value: Value): Value {
  return value;
}

function createRecordingRunner(results: Partial<Record<BatchAuthorizationOperation, unknown[]>>) {
  const operations: BatchAuthorizationOperation[] = [];
  const runOperation: BatchAuthorizationOperationRunner = async <Result>(
    operation: BatchAuthorizationOperation,
  ) => {
    operations.push(operation);
    const queued = results[operation];
    if (!queued || queued.length === 0) throw new Error(`No recorded result for ${operation}.`);
    return queued.shift() as Result;
  };
  return { operations, runOperation };
}

const transaction = mutation({
  mutationId: "00000000-0000-7000-8000-000000000011",
  rowId: "00000000-0000-7000-8000-000000000012",
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
    categoryId,
    profileId,
  },
});

describe("batch authorization", () => {
  it("loads authorization once and evolves only from returned rows", async () => {
    const accountCreate = mutation({
      mutationId: "00000000-0000-7000-8000-000000000021",
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
    });
    const categoryCreate = mutation({
      mutationId: "00000000-0000-7000-8000-000000000022",
      rowId: categoryId,
      baseUpdatedAt: null,
      table: "categories",
      op: "upsert",
      payload: { name: "Food", colorId: null, profileId },
    });
    const profileRename = mutation({
      mutationId: "00000000-0000-7000-8000-000000000023",
      rowId: profileId,
      baseUpdatedAt: null,
      table: "profiles",
      op: "upsert",
      payload: { name: "Renamed" },
    });
    const accountDelete = mutation({
      mutationId: "00000000-0000-7000-8000-000000000024",
      rowId: accountId,
      baseUpdatedAt: null,
      table: "accounts",
      op: "delete",
    });
    const { operations, runOperation } = createRecordingRunner({
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "authorization.transaction-accounts": [[]],
      "authorization.transaction-categories": [[]],
    });

    const authorization = await createBatchAuthorization(
      {} as Executor,
      42,
      [accountCreate, categoryCreate, transaction],
      runOperation,
    );

    await expectForbidden(() => authorization.authorize([transaction]));
    authorization.observe([accountCreate], [{ id: accountId, profileId }]);
    authorization.observe([categoryCreate], [{ id: categoryId, profileId }]);
    expect(() => authorization.authorize([transaction])).not.toThrow();
    expect(authorization.profileName(profileId)).toBe("Main");

    authorization.observe([profileRename], [{ id: profileId, name: "Renamed" }]);
    expect(authorization.profileName(profileId)).toBe("Renamed");

    authorization.observe([accountDelete], [{ id: accountId }]);
    await expectForbidden(() => authorization.authorize([transaction]));
    expect(operations).toEqual([
      "authorization.owned-profiles",
      "authorization.transaction-accounts",
      "authorization.transaction-categories",
    ]);
  });

  it("retains tombstoned profile ownership while invalidating its live references", async () => {
    const profileDelete = mutation({
      mutationId: "00000000-0000-7000-8000-000000000031",
      rowId: profileId,
      baseUpdatedAt: null,
      table: "profiles",
      op: "delete",
    });
    const { runOperation } = createRecordingRunner({
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
      "authorization.transaction-accounts": [[{ id: accountId, profileId }]],
      "authorization.transaction-categories": [[{ id: categoryId, profileId }]],
    });
    const authorization = await createBatchAuthorization(
      {} as Executor,
      42,
      [transaction],
      runOperation,
    );

    expect(authorization.authorize([profileDelete]).liveTargetProfileIds).toEqual([profileId]);
    authorization.observe([profileDelete], [{ id: profileId }]);

    expect(authorization.ownedProfileIds()).toEqual([profileId]);
    expect(authorization.authorize([profileDelete]).liveTargetProfileIds).toEqual([]);
    await expectForbidden(() => authorization.authorize([transaction]));
  });

  it("allows null references without preload queries and ignores zero-row collisions", async () => {
    const nullableTransaction = mutation({
      ...transaction,
      mutationId: "00000000-0000-7000-8000-000000000041",
      payload: { ...transaction.payload, accountId: null, categoryId: null },
    });
    const collidingAccount = mutation({
      mutationId: "00000000-0000-7000-8000-000000000042",
      rowId: accountId,
      baseUpdatedAt: null,
      table: "accounts",
      op: "upsert",
      payload: {
        name: "Collision",
        initialBalance: "0.00",
        currencyCode: "USD",
        status: "ACTIVE",
        type: "CURRENT",
        profileId,
      },
    });
    const { operations, runOperation } = createRecordingRunner({
      "authorization.owned-profiles": [[{ id: profileId, name: "Main", deletedAt: null }]],
    });
    const authorization = await createBatchAuthorization(
      {} as Executor,
      42,
      [nullableTransaction, collidingAccount],
      runOperation,
    );

    expect(() => authorization.authorize([nullableTransaction])).not.toThrow();
    authorization.observe([collidingAccount], []);
    await expectForbidden(() => authorization.authorize([transaction]));
    expect(operations).toEqual(["authorization.owned-profiles"]);
  });
});
