import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SyncedAccount } from "./sync-types";

const mocks = vi.hoisted(() => ({
  assertCurrentReplicaContext: vi.fn(),
  writeLocalMutations: vi.fn(),
  refreshOutboxState: vi.fn(),
  applyLocalRows: vi.fn(),
  announceLocalWrite: vi.fn(),
  schedulePush: vi.fn(),
  accounts: [] as SyncedAccount[],
}));

vi.mock("./idb", () => ({
  assertCurrentReplicaContext: mocks.assertCurrentReplicaContext,
  captureReplicaContext: vi.fn(),
  writeLocalMutations: mocks.writeLocalMutations,
}));
vi.mock("./sync-engine", () => ({
  announceLocalWrite: mocks.announceLocalWrite,
  schedulePush: mocks.schedulePush,
}));
vi.mock("./useSyncStore", () => ({
  applyLocalRows: mocks.applyLocalRows,
  refreshOutboxState: mocks.refreshOutboxState,
  useSyncStore: {
    getState: () => ({ profiles: [], accounts: mocks.accounts, categories: [], transactions: [] }),
  },
}));
vi.mock("~/utils/uuid-v7", () => ({
  uuidV7: () => "019d0000-0000-7000-8000-000000000001",
}));

import { commit } from "./mutations";

describe("commit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.accounts.length = 0;
    mocks.assertCurrentReplicaContext.mockResolvedValue(undefined);
  });

  it("rejects a changed account currency before persisting or publishing the local intent", async () => {
    const account: SyncedAccount = {
      id: "account-a",
      profileId: "profile-a",
      name: "Wallet",
      currencyCode: "USD",
      initialBalance: "100.00",
      status: "ACTIVE",
      type: "SAVING",
      updatedAt: new Date("2026-01-01"),
      deletedAt: null,
    };
    mocks.accounts.push(account);

    await expect(
      commit(
        [
          {
            op: "upsert",
            table: "accounts",
            row: { ...account, currencyCode: "EUR" },
            payload: {
              profileId: "profile-a",
              name: "Wallet",
              currencyCode: "EUR",
              initialBalance: "100.00",
              status: "ACTIVE",
              type: "SAVING",
            },
          },
        ],
        { replicaId: "replica-a", ownerUserId: 41 },
      ),
    ).rejects.toThrow("An account's currency cannot change");

    expect(mocks.writeLocalMutations).not.toHaveBeenCalled();
    expect(mocks.applyLocalRows).not.toHaveBeenCalled();
    expect(account.currencyCode).toBe("USD");
  });

  it("does not publish or report a local change when its atomic IDB write fails", async () => {
    const storageError = new Error("IndexedDB commit failed");
    mocks.writeLocalMutations.mockRejectedValueOnce(storageError);

    await expect(
      commit(
        [
          {
            op: "upsert",
            table: "accounts",
            row: {
              id: "account-a",
              profileId: "profile-a",
              updatedAt: new Date("2026-01-01"),
              deletedAt: null,
            },
            payload: { profileId: "profile-a" },
          },
        ] as never,
        { replicaId: "replica-a", ownerUserId: 41 },
      ),
    ).rejects.toBe(storageError);

    expect(mocks.refreshOutboxState).not.toHaveBeenCalled();
    expect(mocks.applyLocalRows).not.toHaveBeenCalled();
    expect(mocks.announceLocalWrite).not.toHaveBeenCalled();
    expect(mocks.schedulePush).not.toHaveBeenCalled();
  });

  it("does not publish an A-form write after replica A is replaced", async () => {
    const stale = new Error("The local replica changed while the operation was in progress.");
    mocks.assertCurrentReplicaContext.mockRejectedValueOnce(stale);

    await expect(
      commit(
        [
          {
            op: "upsert",
            table: "accounts",
            row: {
              id: "account-a",
              profileId: "profile-a",
              updatedAt: new Date("2026-01-01"),
              deletedAt: null,
            },
            payload: { profileId: "profile-a" },
          },
        ] as never,
        { replicaId: "replica-a", ownerUserId: 41 },
      ),
    ).rejects.toBe(stale);

    expect(mocks.refreshOutboxState).not.toHaveBeenCalled();
    expect(mocks.applyLocalRows).not.toHaveBeenCalled();
    expect(mocks.announceLocalWrite).not.toHaveBeenCalled();
    expect(mocks.schedulePush).not.toHaveBeenCalled();
  });
});
