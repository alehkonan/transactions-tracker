import { create, type StateCreator } from "zustand";
import { devtools } from "zustand/middleware";
import { parseCsv, type ParsedCsv } from "~/utils/parseCsv";

type State = {
  fileName?: string;
  csv?: ParsedCsv;
};

const initState: StateCreator<State> = () => ({});

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
};
