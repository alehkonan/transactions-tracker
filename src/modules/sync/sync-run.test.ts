import { describe, expect, it } from "vitest";
import { runSync, type SyncRunDependencies } from "./sync-run";
import type { OutboxDrainOutcome } from "./outbox-acceptance";
import type { PullChangesResult, SyncCursors, SyncedRows, SyncedTable } from "./sync-types";

const emptyRows: SyncedRows = {
  profiles: [],
  accounts: [],
  categories: [],
  transactions: [],
};

function page(pending: SyncedTable[]): PullChangesResult {
  return {
    rows: emptyRows,
    nextCursors: {},
    pending,
    usdRates: null,
    colors: [],
  };
}

function dependencies(overrides: Partial<SyncRunDependencies> = {}): SyncRunDependencies {
  const defaultDependencies: SyncRunDependencies = {
    remote: { pull: async () => ({ kind: "accepted", result: page([]) }) },
    replica: {
      readCursors: async () => undefined,
      hasQueuedWrites: async () => false,
      clearCachedRows: async () => {},
      commitPulledPage: async () => {},
    },
    push: {
      drain: async (): Promise<OutboxDrainOutcome> => ({ kind: "drained", accepted: 0 }),
    },
  };

  return {
    ...defaultDependencies,
    ...overrides,
    remote: { ...defaultDependencies.remote, ...overrides.remote },
    replica: { ...defaultDependencies.replica, ...overrides.replica },
    push: { ...defaultDependencies.push, ...overrides.push },
  };
}

describe("runSync", () => {
  it("pushes queued writes before pulling and reports the accepted count", async () => {
    const events: string[] = [];
    const outcome = await runSync(
      "normal",
      dependencies({
        replica: {
          readCursors: async () => undefined,
          hasQueuedWrites: async () => true,
          clearCachedRows: async () => {},
          commitPulledPage: async () => {
            events.push("commit");
          },
        },
        push: {
          drain: async () => {
            events.push("push");
            return { kind: "drained", accepted: 2 };
          },
        },
        remote: {
          pull: async (_cursors, withCounts) => {
            events.push(`pull:${withCounts}`);
            return { kind: "accepted", result: page([]) };
          },
        },
      }),
    );

    expect(outcome).toEqual({ kind: "completed", changedRows: 0, pushed: 2 });
    expect(events).toEqual(["push", "pull:true", "commit"]);
  });

  it("commits each pull page and asks for counts only on the first page", async () => {
    const pulled: boolean[] = [];
    const readiness: boolean[] = [];
    let pageNumber = 0;

    const outcome = await runSync(
      "normal",
      dependencies({
        remote: {
          pull: async (_cursors, withCounts) => {
            pulled.push(withCounts);
            pageNumber++;
            return {
              kind: "accepted",
              result: page(pageNumber === 1 ? ["transactions"] : []),
            };
          },
        },
        onPage: ({ referenceTablesReady }) => {
          readiness.push(referenceTablesReady);
        },
      }),
    );

    expect(outcome).toEqual({ kind: "completed", changedRows: 0, pushed: 0 });
    expect(pulled).toEqual([true, false]);
    expect(readiness).toEqual([true, true]);
  });

  it("clears a stale cache before starting a normal pull", async () => {
    const events: string[] = [];
    const staleCursors: SyncCursors = {
      profiles: { updatedAt: "not-a-timestamp", id: null },
    };

    const outcome = await runSync(
      "normal",
      dependencies({
        replica: {
          readCursors: async () => staleCursors,
          hasQueuedWrites: async () => false,
          clearCachedRows: async () => {
            events.push("clear");
          },
          commitPulledPage: async () => {},
        },
        remote: {
          pull: async (cursors) => {
            events.push(cursors == null ? "pull-from-scratch" : "pull-delta");
            return { kind: "accepted", result: page([]) };
          },
        },
      }),
    );

    expect(outcome).toEqual({ kind: "completed", changedRows: 0, pushed: 0 });
    expect(events).toEqual(["clear", "pull-from-scratch"]);
  });

  it("blocks a resync while writes remain queued", async () => {
    let pulled = false;
    const outcome = await runSync(
      "resync",
      dependencies({
        replica: {
          readCursors: async () => undefined,
          hasQueuedWrites: async () => true,
          clearCachedRows: async () => {},
          commitPulledPage: async () => {},
        },
        remote: {
          pull: async () => {
            pulled = true;
            return { kind: "accepted", result: page([]) };
          },
        },
      }),
    );

    expect(outcome).toEqual({ kind: "blocked", reason: "queued-writes" });
    expect(pulled).toBe(false);
  });

  it("returns explicit unauthorized and convergence outcomes", async () => {
    const unauthorized = await runSync(
      "normal",
      dependencies({
        remote: { pull: async () => ({ kind: "unauthorized" }) },
      }),
    );
    const didNotConverge = await runSync(
      "normal",
      dependencies({
        remote: { pull: async () => ({ kind: "accepted", result: page(["transactions"]) }) },
        maxPages: 1,
      }),
    );

    expect(unauthorized).toEqual({ kind: "unauthorized", phase: "pull", pushed: 0 });
    expect(didNotConverge).toEqual({ kind: "didNotConverge", pages: 1, pushed: 0 });
  });
});
