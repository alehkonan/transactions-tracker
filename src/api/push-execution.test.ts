import { describe, expect, it } from "vitest";
import { createPushExecution } from "./push-execution.server";
import type { AppliedBatch } from "./apply-mutations.server";
import type { Mutation, PushChangesResult, SyncedRows } from "~/modules/sync/sync-types";

type FakeDatabase = { kind: "database" | "transaction" };

const mutation = {
  mutationId: "mutation-1",
  rowId: "row-1",
  baseUpdatedAt: null,
  table: "profiles",
  op: "delete",
} satisfies Mutation;

const emptyRows: SyncedRows = {
  profiles: [],
  accounts: [],
  categories: [],
  transactions: [],
};

function createTestExecution(options?: {
  appliedBatch?: AppliedBatch;
  canonicalRows?: SyncedRows;
  colors?: PushChangesResult["colors"];
  failDuringTransaction?: Error;
  failReadingCanonicalRows?: Error;
}) {
  const events: string[] = [];
  const database: FakeDatabase = { kind: "database" };
  const appliedBatch = options?.appliedBatch ?? {
    applied: [mutation.mutationId],
    conflicts: [],
    touched: {
      profiles: new Set([mutation.rowId]),
      accounts: new Set<string>(),
      categories: new Set<string>(),
      transactions: new Set<string>(),
    },
    profileIds: new Set<string>(),
  };

  const executePush = createPushExecution<FakeDatabase>({
    runTransaction: async (work) => {
      events.push("transaction");
      if (options?.failDuringTransaction) throw options.failDuringTransaction;
      return work({ kind: "transaction" });
    },
    runReadTransaction: async (work) => {
      events.push("read-transaction");
      return work(database);
    },
    applyMutations: async (transaction, userId, mutations) => {
      expect(transaction.kind).toBe("transaction");
      expect(userId).toBe(42);
      expect(mutations).toEqual([mutation]);
      events.push("apply");
      return appliedBatch;
    },
    readCanonicalRows: async (readDatabase, userId, touched) => {
      expect(readDatabase).toBe(database);
      expect(userId).toBe(42);
      expect(touched).toBe(appliedBatch.touched);
      events.push("canonical");
      if (options?.failReadingCanonicalRows) throw options.failReadingCanonicalRows;
      return options?.canonicalRows ?? emptyRows;
    },
    readColors: async (readDatabase) => {
      expect(readDatabase).toBe(database);
      events.push("colors");
      return options?.colors ?? [];
    },
  });

  return { executePush, events };
}

describe("createPushExecution", () => {
  it("returns an empty canonical set without opening a transaction", async () => {
    const { executePush, events } = createTestExecution();

    await expect(executePush(42, [])).resolves.toEqual({
      applied: [],
      canonicalRows: emptyRows,
      conflicts: [],
      colors: [],
    });
    expect(events).toEqual(["read-transaction", "colors"]);
  });

  it("applies mutations before reading the committed result", async () => {
    const { executePush, events } = createTestExecution({ colors: [{ id: 7, hex: "#123456" }] });

    await expect(executePush(42, [mutation])).resolves.toEqual({
      applied: [mutation.mutationId],
      canonicalRows: emptyRows,
      conflicts: [],
      colors: [{ id: 7, hex: "#123456" }],
    });
    expect(events).toEqual(["transaction", "apply", "read-transaction", "canonical", "colors"]);
  });

  it("acknowledges a previously receipted mutation without replaying its conflict", async () => {
    const { executePush } = createTestExecution({
      appliedBatch: {
        applied: [mutation.mutationId],
        conflicts: [],
        touched: {
          profiles: new Set([mutation.rowId]),
          accounts: new Set<string>(),
          categories: new Set<string>(),
          transactions: new Set<string>(),
        },
        profileIds: new Set<string>(),
      },
    });

    await expect(executePush(42, [mutation])).resolves.toMatchObject({
      applied: [mutation.mutationId],
      conflicts: [],
    });
  });

  it("uses only mutation ids confirmed by the write transaction", async () => {
    const { executePush } = createTestExecution({
      appliedBatch: {
        applied: [],
        conflicts: [],
        touched: {
          profiles: new Set<string>(),
          accounts: new Set<string>(),
          categories: new Set<string>(),
          transactions: new Set<string>(),
        },
        profileIds: new Set<string>(),
      },
    });

    await expect(executePush(42, [mutation])).resolves.toMatchObject({ applied: [] });
  });

  it("propagates transaction failures without fabricating a result", async () => {
    const failure = new Error("database unavailable");
    const { executePush, events } = createTestExecution({ failDuringTransaction: failure });

    await expect(executePush(42, [mutation])).rejects.toBe(failure);
    expect(events).toEqual(["transaction"]);
  });

  it("keeps committed mutations retryable when canonical reads fail", async () => {
    const failure = new Error("canonical read failed");
    const { executePush, events } = createTestExecution({ failReadingCanonicalRows: failure });

    await expect(executePush(42, [mutation])).rejects.toBe(failure);
    expect(events).toEqual(["transaction", "apply", "read-transaction", "canonical"]);
  });
});
