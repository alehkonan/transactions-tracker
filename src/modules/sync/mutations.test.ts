import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  writeLocalMutations: vi.fn(),
  refreshOutboxState: vi.fn(),
  applyLocalRows: vi.fn(),
  announceLocalWrite: vi.fn(),
  schedulePush: vi.fn(),
}));

vi.mock("./idb", () => ({
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
    getState: () => ({ profiles: [], accounts: [], categories: [], transactions: [] }),
  },
}));
vi.mock("~/utils/uuid-v7", () => ({
  uuidV7: () => "019d0000-0000-7000-8000-000000000001",
}));

import { commit } from "./mutations";

describe("commit", () => {
  beforeEach(() => vi.clearAllMocks());

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
});
