import { describe, expect, it } from "vitest";
import { filterQueuedServerRows } from "./idb";
import type { SyncedRows } from "./sync-types";

describe("filterQueuedServerRows", () => {
  it("preserves queued local rows while retaining unrelated server rows", () => {
    const rows = {
      profiles: [{ id: "profile-1" }, { id: "profile-2" }],
      transactions: [{ id: "transaction-1" }],
    } as Partial<SyncedRows>;

    const filtered = filterQueuedServerRows(rows, new Set(["profiles:profile-1"]));

    expect(filtered.profiles).toEqual([{ id: "profile-2" }]);
    expect(filtered.transactions).toEqual([{ id: "transaction-1" }]);
  });

  it("filters tombstones for queued rows too", () => {
    const rows = {
      accounts: [{ id: "account-1", deletedAt: new Date() }],
    } as Partial<SyncedRows>;

    const filtered = filterQueuedServerRows(rows, new Set(["accounts:account-1"]));

    expect(filtered.accounts).toEqual([]);
  });
});
