import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { parseCsv, type ParsedCsv } from "~/utils/parseCsv";

export type Bindings = Record<string, number | undefined>;

type State = {
  fileName?: string;
  csv?: ParsedCsv;
  accountBindings: Bindings;
  categoryBindings: Bindings;
};

const initState: StateCreator<State> = () => ({
  accountBindings: {},
  categoryBindings: {},
});

export const useTransactionsImport = create(devtools(initState));

export const actions = {
  reset: () => {
    useTransactionsImport.setState(useTransactionsImport.getInitialState(), true);
  },
  uploadAndParse: async (file: File) => {
    const text = await file.text();
    useTransactionsImport.setState({
      fileName: file.name,
      csv: parseCsv(text),
    });
  },
  setAccountBindings: (accountBindings: Bindings) => {
    useTransactionsImport.setState({ accountBindings });
  },
  setCategoryBindings: (categoryBindings: Bindings) => {
    useTransactionsImport.setState({ categoryBindings });
  },
};
