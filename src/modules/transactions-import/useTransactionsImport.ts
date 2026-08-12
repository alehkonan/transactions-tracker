import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { deleteTransactions } from "~/api/transaction.functions";
import { importTransactions, type ImportReport } from "~/api/transactions-import.functions";
import { syncNow } from "~/modules/sync/useSyncStore";
import { parseCsv } from "~/utils/parse-csv";
import { csvToImportRows, getMissingHeaders, type ImportRow } from "./utils";

type Step = "upload" | "processing";

type State = {
  file?: File;
  rows?: ImportRow[];
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

let abortController: AbortController | undefined;

export const actions = {
  reset: () => {
    abortController?.abort();
    useTransactionsImport.setState(useTransactionsImport.getInitialState(), true);
  },
  selectFile: async (file: File) => {
    useTransactionsImport.setState({ file, rows: undefined, uploadError: undefined });

    const csv = parseCsv(await file.text());

    if (csv.rows.length === 0) {
      useTransactionsImport.setState({ uploadError: "This file has no data rows to import." });
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
  },
  clearFile: () => {
    useTransactionsImport.setState({ file: undefined, rows: undefined, uploadError: undefined });
  },
  startImport: async () => {
    const { rows } = useTransactionsImport.getState();
    if (!rows) return;

    abortController = new AbortController();
    useTransactionsImport.setState({ step: "processing", report: undefined });

    try {
      const report = await importTransactions({ data: rows, signal: abortController.signal });
      useTransactionsImport.setState({ report });
      // The import writes straight to the database, so the store only learns about the new
      // accounts, categories and transactions by pulling them back.
      await syncNow();
    } catch (error) {
      if (abortController.signal.aborted) {
        useTransactionsImport.setState({ step: "upload" });
        return;
      }
      useTransactionsImport.setState({
        step: "upload",
        uploadError: error instanceof Error ? error.message : "Import failed.",
      });
    }
  },
  cancelProcessing: () => {
    abortController?.abort();
  },
  discardImportedTransactions: async () => {
    const { report } = useTransactionsImport.getState();
    if (!report) return;

    useTransactionsImport.setState({ isCancelling: true });
    if (report.createdTransactionIds.length > 0) {
      await deleteTransactions({ data: report.createdTransactionIds });
      await syncNow();
    }
    actions.reset();
  },
};
