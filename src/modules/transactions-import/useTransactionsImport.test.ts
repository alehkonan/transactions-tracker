import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCurrentReplicaContext: vi.fn(),
  captureReplicaContext: vi.fn(),
  parseCsv: vi.fn(),
  csvToImportRows: vi.fn(),
  getMissingHeaders: vi.fn(),
}));

vi.mock("~/modules/profile/profile-cookie", () => ({ readSelectedProfileId: vi.fn() }));
vi.mock("~/modules/sync/idb", () => ({
  assertCurrentReplicaContext: mocks.assertCurrentReplicaContext,
  captureReplicaContext: mocks.captureReplicaContext,
}));
vi.mock("~/modules/sync/mutations", () => ({ commit: vi.fn() }));
vi.mock("~/modules/sync/useSyncStore", () => ({ useSyncStore: { getState: vi.fn() } }));
vi.mock("~/modules/transactions/transaction-mutations", () => ({
  deleteTransactions: vi.fn(),
}));
vi.mock("~/utils/parse-csv", () => ({ parseCsv: mocks.parseCsv }));
vi.mock("./utils", () => ({
  csvToImportRows: mocks.csvToImportRows,
  getMissingHeaders: mocks.getMissingHeaders,
}));

import { actions, useTransactionsImport } from "./useTransactionsImport";

describe("transactions import lifecycle fencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actions.reset();
    mocks.captureReplicaContext.mockResolvedValue({ replicaId: "replica-a", ownerUserId: 41 });
    mocks.assertCurrentReplicaContext.mockResolvedValue(undefined);
    mocks.parseCsv.mockReturnValue({ rows: [{}] });
    mocks.getMissingHeaders.mockReturnValue([]);
    mocks.csvToImportRows.mockReturnValue([{ date: "2026-09-12" }]);
  });

  it("does not restore a stale file callback after import state is reset", async () => {
    let resolveText!: (contents: string) => void;
    const contents = new Promise<string>((resolve) => {
      resolveText = resolve;
    });
    const file = { text: () => contents } as File;

    const selection = actions.selectFile(file);
    await vi.waitFor(() => expect(useTransactionsImport.getState().file).toBe(file));
    actions.reset();
    resolveText("csv contents");
    await selection;

    const state = useTransactionsImport.getState();
    expect(state.file).toBeUndefined();
    expect(state.rows).toBeUndefined();
    expect(state.replicaContext).toBeUndefined();
    expect(state.step).toBe("upload");
  });
});
