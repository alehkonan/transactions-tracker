import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { parseCsv, type ParsedCsv } from "~/utils/parseCsv";

/**
 * Maps a raw CSV value (an account or category name) to the id of the
 * matching DB row, or `undefined` while it's still unresolved/missing.
 */
export type Bindings = Record<string, number | undefined>;

/**
 * Maps each mappable `transactions` column to the CSV header whose values
 * should populate it, chosen by the user on the "Map columns" step.
 */
export type ColumnMapping = {
  createdAt?: string;
  category?: string;
  necessityLevel?: string;
  incomeAccountId?: string;
  incomeAmount?: string;
  incomeCurrency?: string;
  outcomeAccountId?: string;
  outcomeAmount?: string;
  outcomeCurrency?: string;
};

export type Step = "upload" | "check" | "map";

type State = {
  fileName?: string;
  csv?: ParsedCsv;
  step: Step;
  accountBindings: Bindings;
  categoryBindings: Bindings;
  columnMapping: ColumnMapping;
  uploadError?: string;
};

const initState: StateCreator<State> = () => ({
  step: "upload",
  accountBindings: {},
  categoryBindings: {},
  columnMapping: {},
});

export const useTransactionsImport = create(devtools(initState));

export const actions = {
  reset: () => {
    useTransactionsImport.setState(useTransactionsImport.getInitialState(), true);
  },
  uploadAndParse: async (file: File) => {
    const text = await file.text();
    const csv = parseCsv(text);

    if (csv.rows.length === 0) {
      useTransactionsImport.setState({ uploadError: "This file has no data rows to import." });
      return;
    }

    useTransactionsImport.setState({
      fileName: file.name,
      csv,
      step: "check",
      uploadError: undefined,
    });
  },
  setAccountBindings: (accountBindings: Bindings) => {
    useTransactionsImport.setState({ accountBindings });
  },
  setCategoryBindings: (categoryBindings: Bindings) => {
    useTransactionsImport.setState({ categoryBindings });
  },
  proceedToMapping: () => {
    useTransactionsImport.setState({ step: "map" });
  },
  goToCheck: () => {
    useTransactionsImport.setState({ step: "check" });
  },
  setColumnMapping: (column: keyof ColumnMapping, header: string | undefined) => {
    useTransactionsImport.setState((state) => ({
      columnMapping: { ...state.columnMapping, [column]: header },
    }));
  },
};
