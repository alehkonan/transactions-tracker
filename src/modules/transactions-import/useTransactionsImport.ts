import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { readSelectedProfileId } from "~/modules/profile/profile-cookie";
import { captureReplicaContext } from "~/modules/sync/idb";
import { commit } from "~/modules/sync/mutations";
import { useSyncStore } from "~/modules/sync/useSyncStore";
import { deleteTransactions } from "~/modules/transactions/transaction-mutations";
import { parseCsv } from "~/utils/parse-csv";
import { buildImportPlan } from "./build-import-plan";
import { csvToImportRows, getMissingHeaders, type ImportRow } from "./utils";
import type { ImportFailure, ImportWarning } from "./build-import-plan";
import type { ReplicaContext } from "~/modules/sync/replica-identity";

type Step = "upload" | "processing";

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
  step: Step;
  uploadError?: string;
  report?: ImportReport;
  isCancelling: boolean;
};

const initState: StateCreator<State> = () => ({
  step: "upload",
  isCancelling: false,
});

export const useTransactionsImport = create(devtools(initState));

export const actions = {
  reset: () => {
    useTransactionsImport.setState(useTransactionsImport.getInitialState(), true);
  },
  selectFile: async (file: File) => {
    const replicaContext = await captureReplicaContext();
    useTransactionsImport.setState({
      file,
      rows: undefined,
      replicaContext,
      uploadError: undefined,
    });

    const csv = parseCsv(await file.text());

    if (csv.rows.length === 0) {
      useTransactionsImport.setState({
        replicaContext: undefined,
        uploadError: "This file has no data rows to import.",
      });
      return;
    }

    const missingHeaders = getMissingHeaders(csv);
    if (missingHeaders.length > 0) {
      useTransactionsImport.setState({
        replicaContext: undefined,
        uploadError: `Missing required columns: ${missingHeaders.join(", ")}`,
      });
      return;
    }

    useTransactionsImport.setState({ rows: csvToImportRows(csv) });
  },
  clearFile: () => {
    useTransactionsImport.setState({
      file: undefined,
      rows: undefined,
      replicaContext: undefined,
      uploadError: undefined,
    });
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
    const { rows, replicaContext } = useTransactionsImport.getState();
    const profileId = readSelectedProfileId();
    if (!rows || !replicaContext || profileId == null) return;

    useTransactionsImport.setState({ step: "processing", report: undefined });
    const startedAt = Date.now();

    try {
      const { accounts, categories, colors } = useSyncStore.getState();
      const plan = buildImportPlan(rows, {
        profileId,
        accounts: accounts.filter((account) => account.profileId === profileId),
        categories: categories.filter((category) => category.profileId === profileId),
        colors,
      });

      await commit(plan.changes, replicaContext);

      useTransactionsImport.setState({
        report: {
          createdCount: plan.createdTransactionIds.length,
          failedCount: plan.failures.length,
          failures: plan.failures,
          warnings: plan.warnings,
          durationMs: Date.now() - startedAt,
          createdTransactionIds: plan.createdTransactionIds,
        },
      });
    } catch (error) {
      useTransactionsImport.setState({
        step: "upload",
        uploadError: error instanceof Error ? error.message : "Import failed.",
      });
    }
  },
  discardImportedTransactions: async () => {
    const { report, replicaContext } = useTransactionsImport.getState();
    if (!report || !replicaContext) return;

    useTransactionsImport.setState({ isCancelling: true });
    // The accounts and categories the import created stay, as they always have: they are what the
    // file said exists, and deleting them would take any pre-existing rows filed under them along.
    await deleteTransactions(report.createdTransactionIds, replicaContext);
    actions.reset();
  },
};
