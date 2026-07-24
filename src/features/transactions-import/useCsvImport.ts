import { type Dispatch, type SetStateAction, useState } from "react";
import { type ParsedCsv, parseCsv } from "~/utils/parseCsv";
import { type ColumnMapping } from "./CsvMapper";
import { transactionFields } from "./transactionFields";

export type CsvImport = {
  file: File | null;
  csv: ParsedCsv | null;
  mapping: ColumnMapping;
  /** Whether a CSV is loaded and every required field has a column mapped. */
  canUpload: boolean;
  /** Select (or clear) the file: parses its content and resets the mapping. */
  selectFile: (file: File | null) => Promise<void>;
  setMapping: Dispatch<SetStateAction<ColumnMapping>>;
  /** Clear the file, parsed CSV, and mapping. */
  reset: () => void;
};

/**
 * Owns the coupled state of the CSV import flow — the selected file, its parsed
 * contents, and the column mapping — keeping them in sync through a small set of
 * transitions.
 */
export function useCsvImport(): CsvImport {
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});

  async function selectFile(next: File | null) {
    setMapping({});
    setFile(next);
    setCsv(next ? parseCsv(await next.text()) : null);
  }

  function reset() {
    setFile(null);
    setCsv(null);
    setMapping({});
  }

  const canUpload =
    csv !== null && transactionFields.every((field) => !field.required || mapping[field.key]);

  return { file, csv, mapping, canUpload, selectFile, setMapping, reset };
}
