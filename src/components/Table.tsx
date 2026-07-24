import { type ReactNode } from "react";

export type Column<T> = {
  /** Stable identifier for the column, used as the React key. */
  key: string;
  /** Header cell content. */
  header: ReactNode;
  /** Renders the body cell for a given row. */
  cell: (row: T) => ReactNode;
};

type Props<T> = {
  data: T[];
  columns: Column<T>[];
  /** Derives a stable key for a row; defaults to the row index. */
  getRowKey?: (row: T, index: number) => string | number;
};

/**
 * Generic, horizontally scrollable data table. Columns describe how to render
 * each header and cell, so any row shape can be displayed.
 */
export function Table<T>({ data, columns, getRowKey }: Props<T>) {
  return (
    <div className="border-border overflow-x-auto rounded-xl border">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                className="border-border text-text-muted border-b px-3 py-2 font-semibold whitespace-nowrap"
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, index) => (
            // oxlint-disable-next-line react/no-array-index-key -- index is the default key; callers pass getRowKey when rows have ids
            <tr key={getRowKey?.(row, index) ?? index}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  className="border-border text-text border-b px-3 py-2 whitespace-nowrap"
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
