import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { assertCurrentReplicaContext, captureReplicaContext } from "~/modules/sync/idb";
import { commit, LocalCommitPersistedError } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";
import { parseCsv } from "~/utils/parse-csv";
import { buildImportPlan } from "./build-import-plan";
import { csvToImportRows, getMissingHeaders, type ImportRow } from "./utils";
import type { ImportFailure, ImportWarning } from "./build-import-plan";
import type { ReplicaContext } from "~/modules/sync/replica-identity";

type Step = "upload" | "review" | "processing";

type ImportReport = {
  createdCount: number;
  failedCount: number;
  failures: ImportFailure[];
  warnings: ImportWarning[];
  durationMs: number;
  createdTransactionIds: string[];
};

type State = {
  file?: File;
  rows?: ImportRow[];
  replicaContext?: ReplicaContext;
  profileId?: string | null;
  step: Step;
  isReading: boolean;
  uploadError?: string;
  removalError?: string;
  localRefreshError?: string;
  report?: ImportReport;
  isCancelling: boolean;
};

const initState: StateCreator<State> = () => ({
  step: "upload",
  isReading: false,
  isCancelling: false,
});

export const useTransactionsImport = create(devtools(initState));

let selectionVersion = 0;

function hasImportContext(
  expected: ReplicaContext,
  rows?: ImportRow[],
  report?: ImportReport,
): boolean {
  const current = useTransactionsImport.getState();
  return (
    current.replicaContext?.replicaId === expected.replicaId &&
    current.replicaContext.ownerUserId === expected.ownerUserId &&
    (rows === undefined || current.rows === rows) &&
    (report === undefined || current.report === report)
  );
}

export const actions = {
  reset: () => {
    selectionVersion += 1;
    useTransactionsImport.setState(useTransactionsImport.getInitialState(), true);
  },
  selectFile: async (file: File) => {
    if (useTransactionsImport.getState().step === "processing") return;
    const version = ++selectionVersion;
    const profileId = useSyncStore.getState().selectedProfileId;
    useTransactionsImport.setState({
      file,
      rows: undefined,
      replicaContext: undefined,
      profileId,
      isReading: true,
      uploadError: undefined,
    });

    try {
      const replicaContext = await captureReplicaContext();
      if (version !== selectionVersion) return;
      useTransactionsImport.setState({ replicaContext });
      const contents = await file.text();
      await assertCurrentReplicaContext(replicaContext);
      if (version !== selectionVersion) return;
      if (useSyncStore.getState().selectedProfileId !== profileId) {
        actions.reset();
        return;
      }
      const csv = parseCsv(contents);

      if (csv.rows.length === 0) {
        useTransactionsImport.setState({
          uploadError: "This file has no data rows to import.",
        });
        return;
      }

      const missingHeaders = getMissingHeaders(csv);
      if (missingHeaders.length > 0) {
        useTransactionsImport.setState({
          uploadError: `Missing required columns: ${missingHeaders.join(", ")}`,
        });
        return;
      }

      useTransactionsImport.setState({ rows: csvToImportRows(csv) });
    } catch (error) {
      if (version === selectionVersion) {
        useTransactionsImport.setState({
          uploadError: error instanceof Error ? error.message : "Could not read this file.",
        });
      }
    } finally {
      if (version === selectionVersion) useTransactionsImport.setState({ isReading: false });
    }
  },
  clearFile: () => {
    if (useTransactionsImport.getState().step === "processing") return;
    selectionVersion += 1;
    useTransactionsImport.setState({
      file: undefined,
      rows: undefined,
      replicaContext: undefined,
      profileId: undefined,
      isReading: false,
      uploadError: undefined,
    });
  },
  reviewFile: () => {
    const { step, rows, isReading } = useTransactionsImport.getState();
    if (step === "upload" && rows?.length && !isReading) {
      useTransactionsImport.setState({ step: "review" });
    }
  },
  editFile: () => {
    if (useTransactionsImport.getState().step === "review") {
      useTransactionsImport.setState({ step: "upload" });
    }
  },
  /**
   * Imports the parsed file into the working set.
   *
   * Local and synchronous, where this used to be a long-running server call: everything an import
   * has to match against — the existing accounts, categories and the palette — is already in the
   * store, so the rows land immediately and reach the server afterwards, a batch at a time, behind
   * the unsynced-changes indicator. Which also means it works with no connection at all.
   */
  startImport: async () => {
    const {
      rows,
      replicaContext,
      step,
      profileId: preparedProfileId,
    } = useTransactionsImport.getState();
    const profileId = useSyncStore.getState().selectedProfileId;
    if (step !== "review" || !rows?.length || !replicaContext || profileId == null) return;
    if (preparedProfileId !== profileId) {
      actions.reset();
      return;
    }

    useTransactionsImport.setState({ step: "processing", report: undefined });
    const startedAt = Date.now();
    let savedReport: ImportReport | undefined;
    let persisted = false;

    try {
      const { accounts, categories, colors } = useSyncStore.getState();
      const plan = buildImportPlan(rows, {
        profileId,
        accounts: accounts.filter((account) => account.profileId === profileId),
        categories: categories.filter((category) => category.profileId === profileId),
        colors,
      });
      savedReport = {
        createdCount: plan.createdTransactionIds.length,
        failedCount: plan.failures.length,
        failures: plan.failures,
        warnings: plan.warnings,
        durationMs: 0,
        createdTransactionIds: plan.createdTransactionIds,
      };

      await commit(plan.changes, replicaContext);
      persisted = true;
      await assertCurrentReplicaContext(replicaContext);
      if (!hasImportContext(replicaContext, rows)) return;

      useTransactionsImport.setState({
        report: {
          ...savedReport,
          durationMs: Date.now() - startedAt,
        },
      });
    } catch (error) {
      if (hasImportContext(replicaContext, rows)) {
        if ((persisted || error instanceof LocalCommitPersistedError) && savedReport) {
          useTransactionsImport.setState({
            report: { ...savedReport, durationMs: Date.now() - startedAt },
            localRefreshError:
              "The import was saved, but this page could not refresh. Reload to load your saved transactions before importing again.",
          });
          return;
        }
        useTransactionsImport.setState({
          step: "review",
          uploadError: error instanceof Error ? error.message : "Import failed.",
        });
      }
    }
  },
  discardImportedTransactions: async () => {
    const { report, replicaContext, isCancelling, localRefreshError } =
      useTransactionsImport.getState();
    if (!report || !replicaContext || isCancelling || localRefreshError) return;

    useTransactionsImport.setState({ isCancelling: true, removalError: undefined });
    let persisted = false;
    // The accounts and categories the import created stay, as they always have: they are what the
    // file said exists, and deleting them would take any pre-existing rows filed under them along.
    try {
      await deleteTransactions(report.createdTransactionIds, replicaContext);
      persisted = true;
      await assertCurrentReplicaContext(replicaContext);
      if (hasImportContext(replicaContext, undefined, report)) actions.reset();
    } catch (error) {
      if (hasImportContext(replicaContext, undefined, report)) {
        if (persisted || error instanceof LocalCommitPersistedError) {
          useTransactionsImport.setState({
            isCancelling: false,
            localRefreshError:
              "The removal was saved, but this page could not refresh. Reload to load your saved changes.",
          });
          return;
        }
        useTransactionsImport.setState({
          isCancelling: false,
          removalError:
            error instanceof Error ? error.message : "Could not remove imported transactions.",
        });
      }
    }
  },
};
