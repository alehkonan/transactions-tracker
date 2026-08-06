import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type RowData,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import { Checkbox } from "./Checkbox";

type Props<TData extends RowData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  enableRowSelection?: boolean;
  onSelectionChange?: (selectedRows: TData[]) => void;
  /** Groups consecutive rows sharing a key; a bold divider is drawn where the key changes. */
  groupBy?: (data: TData) => string | number | undefined;
  /** Renders a full-width summary row after each `groupBy` group, given that group's key. */
  renderGroupSummary?: (groupKey: string | number) => ReactNode;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
};

export const pageSizeOptions = [10, 20, 50, 100] as const;

const selectionColumn: ColumnDef<any, any> = {
  id: "select",
  size: 40,
  header: ({ table }) => (
    <Checkbox
      checked={table.getIsAllPageRowsSelected()}
      indeterminate={table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()}
      onCheckedChange={(checked) => table.toggleAllPageRowsSelected(checked)}
    />
  ),
  cell: ({ row }) => (
    <Checkbox
      checked={row.getIsSelected()}
      onCheckedChange={(checked) => row.toggleSelected(checked)}
    />
  ),
};

export function DataTable<TData extends RowData>({
  columns,
  data,
  enableRowSelection,
  onSelectionChange,
  groupBy,
  renderGroupSummary,
  pagination,
  onPaginationChange,
}: Props<TData>) {
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

  const tableColumns = useMemo(
    () => (enableRowSelection ? [selectionColumn as ColumnDef<TData, any>, ...columns] : columns),
    [columns, enableRowSelection],
  );

  const table = useReactTable({
    columns: tableColumns,
    data,
    enableRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange,
    onRowSelectionChange: setRowSelection,
    state: {
      pagination,
      rowSelection,
    },
  });

  // Selection only ever applies to the current page, and stale IDs from a
  // previous page/data set shouldn't stay selected once either changes.
  useEffect(() => {
    setRowSelection({});
  }, [data, pagination.pageIndex]);

  useEffect(() => {
    onSelectionChange?.(table.getSelectedRowModel().rows.map((row) => row.original));
  }, [rowSelection, table, onSelectionChange]);

  const bodyRows = table.getRowModel().rows;
  const visibleColumnCount = table.getVisibleLeafColumns().length;
  const tableRows: ReactNode[] = [];

  bodyRows.forEach((row, index) => {
    const previousGroupKey = index > 0 ? groupBy?.(bodyRows[index - 1].original) : undefined;
    const groupKey = groupBy?.(row.original);
    const isGroupBoundary = groupBy !== undefined && index > 0 && groupKey !== previousGroupKey;

    if (isGroupBoundary && renderGroupSummary && previousGroupKey !== undefined) {
      tableRows.push(
        <tr
          key={`summary-${bodyRows[index - 1].id}`}
          className={twJoin(tableRows.length > 0 && "border-border border-t")}
        >
          <td colSpan={visibleColumnCount} className="bg-surface-muted px-3 py-1">
            {renderGroupSummary(previousGroupKey)}
          </td>
        </tr>,
      );
    }

    tableRows.push(
      <tr key={row.id} className={twJoin(tableRows.length > 0 && "border-border border-t")}>
        {row.getVisibleCells().map((cell) => (
          <td
            key={cell.id}
            className={twJoin(
              "truncate px-3 py-1",
              isGroupBoundary && "border-t-text-muted/40 border-t-2",
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>,
    );
  });

  return (
    <div className="border-border bg-surface flex items-stretch overflow-hidden rounded-xl border">
      <button
        className="border-border not-disabled:hover:bg-surface-muted grid w-10 shrink-0 place-items-center border-r disabled:opacity-40"
        disabled={!table.getCanPreviousPage()}
        onClick={() => table.previousPage()}
        aria-label="Previous page"
      >
        <ChevronLeftIcon />
      </button>
      <div className="min-w-0 flex-1 overflow-x-auto">
        <table className="w-full table-fixed border-collapse tabular-nums">
          <colgroup>
            {table.getVisibleLeafColumns().map((column) => (
              <col key={column.id} style={{ width: column.getSize() }} />
            ))}
          </colgroup>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} className="border-border last-of-type:border-b">
                {headerGroup.headers.map((header) => {
                  return (
                    <th
                      key={header.id}
                      colSpan={header.colSpan}
                      className="border-border truncate px-3 py-1"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>{tableRows}</tbody>
        </table>
        {!data.length && (
          <div className="grid place-items-center p-6">
            <p>No data</p>
          </div>
        )}
      </div>
      <button
        className="border-border not-disabled:hover:bg-surface-muted grid w-10 shrink-0 place-items-center border-l disabled:opacity-40"
        disabled={!table.getCanNextPage()}
        onClick={() => table.nextPage()}
        aria-label="Next page"
      >
        <ChevronRightIcon />
      </button>
    </div>
  );
}
