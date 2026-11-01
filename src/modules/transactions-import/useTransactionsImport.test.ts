import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertCurrentReplicaContext: vi.fn(),
  captureReplicaContext: vi.fn(),
  parseCsv: vi.fn(),
  csvToImportRows: vi.fn(),
  getMissingHeaders: vi.fn(),
  getSyncState: vi.fn(),
  commit: vi.fn(),
  deleteTransactions: vi.fn(),
  PersistedError: class extends Error {},
}));

vi.mock("~/modules/sync/idb", () => ({
  assertCurrentReplicaContext: mocks.assertCurrentReplicaContext,
  captureReplicaContext: mocks.captureReplicaContext,
}));
vi.mock("~/modules/sync/mutations", () => ({
  commit: mocks.commit,
  LocalCommitPersistedError: mocks.PersistedError,
}));
vi.mock("~/modules/sync/useSyncStore", () => ({ useSyncStore: { getState: mocks.getSyncState } }));
vi.mock("~/modules/transactions/transaction-mutations", () => ({
  deleteTransactions: mocks.deleteTransactions,
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
    mocks.getSyncState.mockReturnValue({
      selectedProfileId: "profile-a",
      accounts: [],
      categories: [],
      colors: [],
    });
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

  it("ignores a file selection still capturing its replica when the draft is cleared", async () => {
    let resolveContext!: (context: { replicaId: string; ownerUserId: number }) => void;
    mocks.captureReplicaContext.mockReturnValue(
      new Promise((resolve) => {
        resolveContext = resolve;
      }),
    );
    const file = { text: vi.fn().mockResolvedValue("csv") } as unknown as File;
    const selection = actions.selectFile(file);
    actions.clearFile();
    resolveContext({ replicaId: "replica-a", ownerUserId: 41 });
    await selection;
    expect(file.text).not.toHaveBeenCalled();
    expect(useTransactionsImport.getState().file).toBeUndefined();
    expect(useTransactionsImport.getState().isReading).toBe(false);
  });

  it("shows file read errors and allows another selection", async () => {
    const broken = {
      text: vi.fn().mockRejectedValue(new Error("File is unreadable")),
    } as unknown as File;
    await actions.selectFile(broken);
    expect(useTransactionsImport.getState()).toMatchObject({
      isReading: false,
      uploadError: "File is unreadable",
    });
    await actions.selectFile({ text: async () => "valid csv" } as File);
    expect(useTransactionsImport.getState().rows).toHaveLength(1);
    expect(useTransactionsImport.getState().uploadError).toBeUndefined();
  });

  it("does not import a prepared file into a different profile", async () => {
    await actions.selectFile({ text: async () => "csv" } as File);
    actions.reviewFile();
    mocks.getSyncState.mockReturnValue({ selectedProfileId: "profile-b" });
    await actions.startImport();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(useTransactionsImport.getState().file).toBeUndefined();
  });

  it("does not submit again while an import is processing or after it completes", async () => {
    // Invalid source rows need no account fixture, but still exercise the real planning/commit seam.
    mocks.csvToImportRows.mockReturnValue([{ createdDate: "invalid" }]);
    let finishCommit!: () => void;
    mocks.commit.mockReturnValue(
      new Promise<void>((resolve) => {
        finishCommit = resolve;
      }),
    );
    await actions.selectFile({ text: async () => "csv" } as File);
    actions.reviewFile();
    const importing = actions.startImport();
    await actions.startImport();
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    finishCommit();
    await importing;
    await actions.startImport();
    expect(mocks.commit).toHaveBeenCalledTimes(1);
    expect(useTransactionsImport.getState().report?.failedCount).toBe(1);
  });

  it("retains the saved report when removal fails and permits retry", async () => {
    const report = {
      createdCount: 1,
      failedCount: 0,
      failures: [],
      warnings: [],
      durationMs: 1,
      createdTransactionIds: ["imported-transaction"],
    };
    useTransactionsImport.setState({
      step: "processing",
      report,
      replicaContext: { replicaId: "replica-a", ownerUserId: 41 },
    });
    mocks.deleteTransactions.mockRejectedValueOnce(new Error("Local storage unavailable"));
    await actions.discardImportedTransactions();
    expect(useTransactionsImport.getState()).toMatchObject({
      report,
      isCancelling: false,
      removalError: "Local storage unavailable",
    });
    mocks.deleteTransactions.mockResolvedValueOnce(undefined);
    await actions.discardImportedTransactions();
    expect(useTransactionsImport.getState().step).toBe("upload");
    expect(useTransactionsImport.getState().report).toBeUndefined();
  });

  it("keeps a completion report and prevents retry when the import was persisted before an error", async () => {
    mocks.csvToImportRows.mockReturnValue([{ createdDate: "invalid" }]);
    mocks.commit.mockRejectedValueOnce(new mocks.PersistedError("Refresh failed after saving"));
    await actions.selectFile({ text: async () => "csv" } as File);
    actions.reviewFile();
    await actions.startImport();
    expect(useTransactionsImport.getState().step).toBe("processing");
    expect(useTransactionsImport.getState().report).toBeDefined();
    expect(useTransactionsImport.getState().localRefreshError).toContain("was saved");
    await actions.startImport();
    expect(mocks.commit).toHaveBeenCalledTimes(1);
  });
});
