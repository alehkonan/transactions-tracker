import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  beginReplicaTransition: vi.fn(),
  cancelReplicaTransition: vi.fn(),
  captureReplicaContext: vi.fn(),
  completeReplicaSignIn: vi.fn(),
  pauseSyncAfterAuthFailure: vi.fn(),
  recoverInterruptedReplicaTransition: vi.fn(),
  resumeSyncAfterSignIn: vi.fn(),
}));

vi.mock("~/modules/sync/browser-operation-lock", () => ({
  runWithBrowserOperationLock: (work: () => Promise<unknown>) => work(),
}));
vi.mock("~/modules/sync/idb", () => ({
  assertCurrentReplicaContext: vi.fn(),
  beginReplicaTransition: mocks.beginReplicaTransition,
  cancelReplicaTransition: mocks.cancelReplicaTransition,
  captureReplicaContext: mocks.captureReplicaContext,
  completeReplicaSignIn: mocks.completeReplicaSignIn,
  readLocalSnapshot: vi.fn(),
  recoverInterruptedReplicaTransition: mocks.recoverInterruptedReplicaTransition,
  replaceLocalReplica: vi.fn(),
}));
vi.mock("~/modules/sync/sync-engine", () => ({
  announceReplicaTransition: vi.fn(),
  finishReplicaReplacement: vi.fn(),
  pauseSyncAfterAuthFailure: mocks.pauseSyncAfterAuthFailure,
  resumeSyncAfterSignIn: mocks.resumeSyncAfterSignIn,
}));
vi.mock("~/modules/sync/useSyncStore", () => ({
  useSyncStore: { getState: vi.fn(), setState: vi.fn() },
}));
vi.mock("~/utils/uuid-v7", () => ({ uuidV7: () => "transition-a" }));

import { completeSignIn, getSignInReturnPath } from "./complete-sign-in";

function location(search: string): Location {
  return { origin: "https://tracker.example", search } as Location;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recoverInterruptedReplicaTransition.mockResolvedValue(null);
  mocks.captureReplicaContext.mockResolvedValue({ replicaId: "replica-a", ownerUserId: 41 });
  mocks.beginReplicaTransition.mockResolvedValue(undefined);
  mocks.cancelReplicaTransition.mockResolvedValue(undefined);
  mocks.completeReplicaSignIn.mockResolvedValue(undefined);
});

describe("completeSignIn", () => {
  it("preserves local access and keeps sync paused when finalization fails", async () => {
    const failure = new Error("Authentication request failed.");

    await expect(completeSignIn("sign-in", async () => Promise.reject(failure))).rejects.toBe(
      failure,
    );

    expect(mocks.cancelReplicaTransition).toHaveBeenCalledWith(
      { replicaId: "replica-a", ownerUserId: 41 },
      "transition-a",
    );
    expect(mocks.pauseSyncAfterAuthFailure).toHaveBeenCalledWith({
      replicaId: "replica-a",
      ownerUserId: 41,
    });
    expect(mocks.completeReplicaSignIn).not.toHaveBeenCalled();
    expect(mocks.resumeSyncAfterSignIn).not.toHaveBeenCalled();
  });
});

describe("getSignInReturnPath", () => {
  it("keeps a same-origin UI path with its search and hash", () => {
    expect(
      getSignInReturnPath(location("?returnTo=%2Ftransactions%3Faccount%3Dchecking%23latest")),
    ).toBe("/transactions?account=checking#latest");
  });

  it.each([
    "https://evil.example/",
    "//evil.example/",
    "/login?returnTo=/settings",
    "javascript:x",
  ])("rejects unsafe destination %s", (returnTo) => {
    expect(getSignInReturnPath(location(`?returnTo=${encodeURIComponent(returnTo)}`))).toBe("/");
  });
});
