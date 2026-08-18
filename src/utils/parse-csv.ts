export type ParsedCsv = {
  headers: string[];
  rows: string[][];
};

const DELIMITERS = [",", ";", "\t"];

/** Guess the delimiter from the header line, picking whichever occurs most. */
function detectDelimiter(input: string) {
  const firstLine = input.split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = 0;
  for (const delimiter of DELIMITERS) {
    const count = firstLine.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }
  return best;
}

/**
 * Parse CSV text into headers and rows.
 *
 * Minimal RFC-4180-ish parser: handles quoted fields, escaped quotes (`""`),
 * delimiters and newlines inside quotes, and both LF and CRLF line endings. A
 * leading BOM is stripped and a trailing newline does not produce an empty row.
 * The delimiter is auto-detected from the header line (comma, semicolon, or tab)
 * unless one is given explicitly.
 *
 * @param text - Raw CSV content; the first line is treated as the header row.
 * @param delimiter - Field delimiter; defaults to the auto-detected one.
 * @returns The header cells and the remaining data rows.
 */
export function parseCsv(text: string, delimiter?: string): ParsedCsv {
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
  const separator = delimiter ?? detectDelimiter(input);

  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === separator) {
      record.push(field);
      field = "";
    } else if (char === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [headers = [], ...rows] = records;
  return { headers, rows };
}
