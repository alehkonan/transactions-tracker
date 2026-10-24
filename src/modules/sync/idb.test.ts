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

  it("protects allocations of queued legacy sources without hiding another device's money", () => {
    const rows = {
      accounts: [{ id: "remote-account", profileId: "profile-1" }],
      transactions: [{ id: "remote-transaction", profileId: "profile-1" }],
      spheres: [{ id: "profile-1", profileId: "profile-1" }],
      allocations: [
        { id: "opening", openingAccountId: "local-account", transactionId: null },
        { id: "expense", transactionId: "local-transaction", openingAccountId: null },
        {
          id: "remote",
          transactionId: "remote-transaction",
          openingAccountId: null,
          profileId: "profile-1",
        },
      ],
    } as Partial<SyncedRows>;
    const filtered = filterQueuedServerRows(
      rows,
      new Set(["profiles:profile-1", "accounts:local-account", "transactions:local-transaction"]),
    );
    expect(filtered.spheres).toEqual([]);
    expect(filtered.allocations?.map((row) => row.id)).toEqual(["remote"]);
    expect(filtered.accounts).toEqual(rows.accounts);
    expect(filtered.transactions).toEqual(rows.transactions);
  });
});
