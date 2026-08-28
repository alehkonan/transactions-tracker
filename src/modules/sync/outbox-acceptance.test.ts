import { describe, expect, it } from "vitest";
import { drainOutbox } from "./outbox-acceptance";

type Entry = {
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
