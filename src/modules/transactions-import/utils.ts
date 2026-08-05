import type { ParsedCsv } from "~/utils/parseCsv";

export const IMPORT_HEADERS = [
  "categoryName",
  "comment",
  "outcomeAccountName",
  "outcome",
  "outcomeCurrencyShortTitle",
  "incomeAccountName",
  "income",
  "incomeCurrencyShortTitle",
  "changedDate",
] as const;

export type ImportRow = Record<(typeof IMPORT_HEADERS)[number], string>;

export function getMissingHeaders(csv: ParsedCsv): string[] {
  return IMPORT_HEADERS.filter((header) => !csv.headers.includes(header));
}

export function csvToImportRows(csv: ParsedCsv): ImportRow[] {
  const indices = IMPORT_HEADERS.map((header) => csv.headers.indexOf(header));

  return csv.rows.map(
    (row) =>
      Object.fromEntries(
        IMPORT_HEADERS.map((header, i) => [header, row[indices[i]] ?? ""]),
      ) as ImportRow,
  );
}
