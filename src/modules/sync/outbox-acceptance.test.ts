import { describe, expect, it } from "vitest";
import { drainOutbox, takeOperationBatch } from "./outbox-acceptance";
import type { OperationMember } from "./outbox-acceptance";

type Entry = OperationMember & {
  seq: number;
  mutationId: string;
  value: string;
};

type Result = {
  applied: readonly string[];
  marker: string;
};

function createStorage(initial: Entry[]) {
  const entries = [...initial];
  const dropped: number[][] = [];

  return {
    entries,
    dropped,
    storage: {
      readBatch: async (limit: number) => entries.slice(0, limit),
      dropEntries: async (seqs: readonly number[]) => {
        dropped.push([...seqs]);
        for (const seq of seqs) {
          const index = entries.findIndex((entry) => entry.seq === seq);
          if (index >= 0) entries.splice(index, 1);
        }
      },
    },
  };
}

const entries: Entry[] = [
  { seq: 1, mutationId: "one", value: "a" },
  { seq: 2, mutationId: "two", value: "b" },
  { seq: 3, mutationId: "three", value: "c" },
];

describe("drainOutbox", () => {
  it("keeps a transfer together at the 500-row boundary and replays a lost response without duplicating either leg", async () => {
    const operation = { id: "transfer", mutationIds: ["outgoing", "incoming"] };
    const before = Array.from({ length: 499 }, (_, index) => ({
      seq: index + 1,
      mutationId: `expense-${index}`,
      value: "-1.00",
    }));
    const pair = [
      { seq: 500, mutationId: "outgoing", value: "-10.00", operation },
      { seq: 501, mutationId: "incoming", value: "10.00", operation },
    ];
    const testStorage = createStorage([...before, ...pair]);
    const batches: string[][] = [];
    const serverReceipts = new Map<string, string>();
    let loseResponse = true;
    const options = {
      storage: {
        ...testStorage.storage,
        readBatch: async (limit: number) =>
          takeOperationBatch(testStorage.entries.slice(0, limit), limit),
      },
      batchLimit: 500,
      toPayload: (entry: Entry) => entry,
      send: async (batch: readonly Entry[]) => {
        batches.push(batch.map((entry) => entry.mutationId));
        for (const entry of batch)
          if (!serverReceipts.has(entry.mutationId))
            serverReceipts.set(entry.mutationId, entry.value);
        if (batch.some((entry) => entry.operation) && loseResponse) {
          loseResponse = false;
          return {
            kind: "retryable" as const,
            error: new Error("Response lost after server commit"),
          };
        }
        return {
          kind: "accepted" as const,
          result: { applied: batch.map((entry) => entry.mutationId) },
        };
      },
    };
    expect(await drainOutbox(options)).toMatchObject({ kind: "retryable", accepted: 499 });
    expect(testStorage.entries).toEqual(pair);
    expect(await drainOutbox(options)).toEqual({ kind: "drained", accepted: 2 });
    expect(batches.map((batch) => batch.length)).toEqual([499, 2, 2]);
    expect(batches[1]).toEqual(["outgoing", "incoming"]);
    expect(batches[2]).toEqual(batches[1]);
    expect(serverReceipts.size).toBe(501);
    expect(testStorage.entries).toEqual([]);
  });

  it("retains both legs when only one is confirmed", async () => {
    const operation = { id: "transfer", mutationIds: ["outgoing", "incoming"] };
    const pair = [
      { seq: 1, mutationId: "outgoing", value: "-10.00", operation },
      { seq: 2, mutationId: "incoming", value: "10.00", operation },
    ];
    const testStorage = createStorage(pair);
    const outcome = await drainOutbox({
      storage: testStorage.storage,
      batchLimit: 500,
      toPayload: (entry) => entry,
      send: async () => ({ kind: "accepted", result: { applied: ["outgoing"] } }),
    });
    expect(outcome).toMatchObject({ kind: "retryable", accepted: 0 });
    expect(testStorage.entries).toEqual(pair);
    expect(testStorage.dropped).toEqual([]);
  });

  it("retains accepted intents when durable settlement fails and settles them on retry", async () => {
    const operation = { id: "transfer", mutationIds: ["outgoing", "incoming"] };
    const pair = [
      { seq: 1, mutationId: "outgoing", value: "-10.00", operation },
      { seq: 2, mutationId: "incoming", value: "10.00", operation },
    ];
    const testStorage = createStorage(pair);
    const failure = new Error("Storage transaction aborted");
    let failSettlement = true;
    const options = {
      storage: {
        ...testStorage.storage,
        settleEntries: async (seqs: readonly number[]) => {
          if (failSettlement) {
            failSettlement = false;
            throw failure;
          }
          await testStorage.storage.dropEntries(seqs);
        },
      },
      batchLimit: 500,
      toPayload: (entry: Entry) => entry,
      send: async () => ({
        kind: "accepted" as const,
        result: { applied: ["outgoing", "incoming"] },
      }),
    };
    await expect(drainOutbox(options)).rejects.toBe(failure);
    expect(testStorage.entries).toEqual(pair);
    expect(await drainOutbox(options)).toEqual({ kind: "drained", accepted: 2 });
    expect(testStorage.entries).toEqual([]);
  });

  it("retains an incomplete financial operation without sending a leg", async () => {
    const operation = { id: "transfer-create", mutationIds: ["outgoing", "incoming"] };
    const queued = [{ seq: 1, mutationId: "outgoing", value: "-10.00", operation }];
    const testStorage = createStorage(queued);
    let sent = false;
    const outcome = await drainOutbox({
      storage: testStorage.storage,
      batchLimit: 500,
      toPayload: (entry) => entry,
      send: async () => {
        sent = true;
        return { kind: "accepted", result: { applied: ["outgoing"] } };
      },
    });
    expect(outcome).toMatchObject({ kind: "retryable", accepted: 0 });
    expect(sent).toBe(false);
    expect(testStorage.entries).toEqual(queued);
  });

  it("drains full batches in sequence and runs under the coordination adapter", async () => {
    const testStorage = createStorage(entries);
    const payloads: string[][] = [];
    const accepted: string[] = [];

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: testStorage.storage,
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async (batch) => {
        payloads.push([...batch]);
        return { kind: "accepted", result: { applied: ["one", "two", "three"], marker: "ok" } };
      },
      onAccepted: async (result, batch) => {
        accepted.push(`${result.marker}:${batch.map((entry) => entry.mutationId).join(",")}`);
      },
      withExclusive: async (work) => work(),
    });

    expect(outcome).toEqual({ kind: "drained", accepted: 3 });
    expect(payloads).toEqual([["a", "b"], ["c"]]);
    expect(testStorage.dropped).toEqual([[1, 2], [3]]);
    expect(testStorage.entries).toEqual([]);
    expect(accepted).toEqual(["ok:one,two", "ok:three"]);
  });

  it("retains entries when the transport reports an unauthorized session", async () => {
    const testStorage = createStorage(entries);

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: testStorage.storage,
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async () => ({ kind: "unauthorized" }),
    });

    expect(outcome).toMatchObject({ kind: "unauthorized", accepted: 0 });
    expect(testStorage.dropped).toEqual([]);
    expect(testStorage.entries).toEqual(entries);
  });

  it("retains entries and surfaces a terminal protocol failure", async () => {
    const testStorage = createStorage(entries);
    const failure = new Error("Mutation identity mismatch.");

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: testStorage.storage,
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async () => ({ kind: "terminal", error: failure }),
    });

    expect(outcome).toEqual({ kind: "terminal", accepted: 0, error: failure });
    expect(testStorage.dropped).toEqual([]);
    expect(testStorage.entries).toEqual(entries);
  });

  it("drops explicit confirmations but stops after a partial batch", async () => {
    const testStorage = createStorage(entries);
    const accepted: string[] = [];

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: testStorage.storage,
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async () => ({ kind: "accepted", result: { applied: ["one"], marker: "partial" } }),
      onAccepted: async (_result, batch) => {
        accepted.push(...batch.map((entry) => entry.mutationId));
      },
    });

    expect(outcome).toMatchObject({ kind: "retryable", accepted: 1 });
    expect(testStorage.dropped).toEqual([[1]]);
    expect(testStorage.entries.map((entry) => entry.mutationId)).toEqual(["two", "three"]);
    expect(accepted).toEqual(["one"]);
  });

  it("settles accepted entries through the atomic storage adapter", async () => {
    const testStorage = createStorage([entries[0]]);
    const settlements: Array<{ seqs: number[]; marker: string }> = [];
    const accepted: string[] = [];

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: {
        ...testStorage.storage,
        settleEntries: async (seqs, result) => {
          settlements.push({ seqs: [...seqs], marker: result.marker });
          await testStorage.storage.dropEntries(seqs);
        },
      },
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async () => ({ kind: "accepted", result: { applied: ["one"], marker: "atomic" } }),
      onAccepted: async (_result, batch) => {
        accepted.push(...batch.map((entry) => entry.mutationId));
      },
    });

    expect(outcome).toEqual({ kind: "drained", accepted: 1 });
    expect(settlements).toEqual([{ seqs: [1], marker: "atomic" }]);
    expect(accepted).toEqual(["one"]);
    expect(testStorage.entries).toEqual([]);
  });

  it("rejects a storage adapter that violates sequence ordering", async () => {
    const testStorage = createStorage([
      { seq: 2, mutationId: "two", value: "b" },
      { seq: 1, mutationId: "one", value: "a" },
    ]);
    let sent = false;

    const outcome = await drainOutbox<Entry, string, Result>({
      storage: testStorage.storage,
      batchLimit: 2,
      toPayload: (entry) => entry.value,
      send: async () => {
        sent = true;
        return { kind: "accepted", result: { applied: [], marker: "invalid" } };
      },
    });

    expect(outcome).toMatchObject({ kind: "retryable", accepted: 0 });
    expect(sent).toBe(false);
    expect(testStorage.dropped).toEqual([]);
  });
});
