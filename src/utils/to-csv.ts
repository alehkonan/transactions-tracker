/** Quotes a field if it contains the delimiter, a quote, or a newline; doubles embedded quotes. */
function escapeCsvField(value: string, delimiter: string): string {
  if (!value.includes(delimiter) && !value.includes('"') && !/[\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

/** Serializes headers and rows into RFC-4180-ish CSV text (comma-delimited, CRLF line endings). */
export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  const delimiter = ",";
  const lines = [headers, ...rows].map((line) =>
    line.map((cell) => escapeCsvField(String(cell ?? ""), delimiter)).join(delimiter),
  );
  return lines.join("\r\n");
}
