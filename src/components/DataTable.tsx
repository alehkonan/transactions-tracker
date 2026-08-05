import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
  type RowSelectionState,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import { Checkbox } from "./Checkbox";
import { Select } from "./Select";

type Props<TData extends RowData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  enableRowSelection?: boolean;
  onSelectionChange?: (selectedRows: TData[]) => void;
  /** Groups consecutive rows sharing a key; a bold divider is drawn where the key changes. */
  groupBy?: (data: TData) => string | number | undefined;
  /** Renders a full-width summary row after each `groupBy` group, given that group's rows. */
  renderGroupSummary?: (rows: TData[]) => ReactNode;
};

const defaultPagination = {
  pageIndex: 0,
  pageSize: 10,
} as const;

const pageSizeOptions = [10, 20, 50, 100] as const;

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
}: Props<TData>) {
  const [pagination, setPagination] = useState<PaginationState>(defaultPagination);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const pageSizeId = useId();
  const pageNumberId = useId();

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
    onPaginationChange: setPagination,
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
  let groupStart = 0;

  bodyRows.forEach((row, index) => {
    const isGroupBoundary =
      groupBy !== undefined &&
      index > 0 &&
      groupBy(row.original) !== groupBy(bodyRows[index - 1].original);

    if (isGroupBoundary && renderGroupSummary) {
      tableRows.push(
        <tr key={`summary-${bodyRows[groupStart].id}`}>
          <td colSpan={visibleColumnCount} className="bg-surface-muted px-3 py-1">
            {renderGroupSummary(bodyRows.slice(groupStart, index).map((r) => r.original))}
          </td>
        </tr>,
      );
      groupStart = index;
    }

    tableRows.push(
      <tr key={row.id}>
        {row.getVisibleCells().map((cell) => (
          <td
            key={cell.id}
            className={twJoin(
              "border-border truncate border-b px-3 py-1",
              isGroupBoundary && "border-t-text-muted/40 border-t-2",
            )}
          >
            {flexRender(cell.column.columnDef.cell, cell.getContext())}
          </td>
        ))}
      </tr>,
    );
  });

  if (renderGroupSummary && groupBy && bodyRows.length > 0) {
    tableRows.push(
      <tr key={`summary-${bodyRows[groupStart].id}-end`}>
        <td colSpan={visibleColumnCount} className="bg-surface-muted px-3 py-1">
          {renderGroupSummary(bodyRows.slice(groupStart).map((r) => r.original))}
        </td>
      </tr>,
    );
  }

  return (
    <div className="border-border bg-surface overflow-x-auto rounded-xl border">
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
                    className="border-border truncate px-3 py-1 not-last-of-type:border-r"
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
      {data.length ? (
        <div className="flex items-end justify-between gap-1 p-2">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={pageSizeId} className="text-text-muted text-xs">
                Page size
              </label>
              <Select
                id={pageSizeId}
                value={String(pagination.pageSize)}
                onValueChange={(v) => v && table.setPageSize(+v)}
                options={pageSizeOptions.map((pageSize) => String(pageSize))}
                className="h-auto p-1"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={pageNumberId} className="text-text-muted text-xs">
                Page number
              </label>
              <Select
                id={pageNumberId}
                value={String(pagination.pageIndex)}
                onValueChange={(v) => v && table.setPageIndex(+v)}
                options={table.getPageOptions().map((pageOption) => ({
                  value: String(pageOption),
                  label: String(pageOption + 1),
                }))}
                className="h-auto p-1"
              />
            </div>
          </div>
          <div className="flex gap-1.5">
            <button
              className="border-border size-8 place-items-center rounded-lg border not-disabled:hover:shadow disabled:bg-transparent"
              disabled={!table.getCanPreviousPage()}
              onClick={() => table.previousPage()}
            >
              <ChevronLeftIcon />
            </button>
            <button
              className="border-border size-8 place-items-center rounded-lg border not-disabled:hover:shadow disabled:bg-transparent"
              disabled={!table.getCanNextPage()}
              onClick={() => table.nextPage()}
            >
              <ChevronRightIcon />
            </button>
          </div>
        </div>
      ) : (
        <div className="grid place-items-center p-6">
          <p>No data</p>
        </div>
      )}
    </div>
  );
}
