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
import { useEffect, useId, useMemo, useState } from "react";
import { Checkbox } from "./Checkbox";

type Props<TData extends RowData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  enableRowSelection?: boolean;
  onSelectionChange?: (selectedRows: TData[]) => void;
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
      onChange={table.getToggleAllPageRowsSelectedHandler()}
    />
  ),
  cell: ({ row }) => (
    <Checkbox checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
  ),
};

export function DataTable<TData extends RowData>({
  columns,
  data,
  enableRowSelection,
  onSelectionChange,
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
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} className="border-border truncate border-b px-3 py-1">
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {data.length ? (
        <div className="flex items-end justify-between gap-1 p-2">
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label htmlFor={pageSizeId} className="text-text-muted text-xs">
                Page size
              </label>
              <select
                id={pageSizeId}
                name="page_size"
                value={pagination.pageSize}
                onChange={(e) => table.setPageSize(+e.target.value)}
                className="bg-surface border-border rounded-lg border p-1 transition-shadow hover:shadow"
              >
                {pageSizeOptions.map((pageSize) => (
                  <option key={pageSize} value={pageSize}>
                    {pageSize}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor={pageNumberId} className="text-text-muted text-xs">
                Page number
              </label>
              <select
                id={pageNumberId}
                name="page_number"
                value={pagination.pageIndex}
                onChange={(e) => table.setPageIndex(+e.target.value)}
                className="bg-surface border-border rounded-lg border p-1 transition-shadow hover:shadow"
              >
                {table.getPageOptions().map((pageOption) => (
                  <option key={pageOption} value={pageOption}>
                    {pageOption + 1}
                  </option>
                ))}
              </select>
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
