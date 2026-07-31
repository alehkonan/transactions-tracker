import type { ParsedCsv } from "~/utils/parseCsv";

export function getUniqueColumnValues(csv: ParsedCsv, selectedHeaders: string[]) {
  const indices = selectedHeaders
    .map((header) => csv.headers.indexOf(header))
    .filter((index) => index !== -1);

  const values = new Set<string>();
  for (const row of csv.rows) {
    for (const index of indices) {
      const value = row[index];
      if (value) values.add(value);
    }
  }
  return [...values];
}
