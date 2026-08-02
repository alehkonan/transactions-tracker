import {
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  useReactTable,
  type ColumnDef,
  type PaginationState,
  type RowData,
} from "@tanstack/react-table";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";

type Props<TData extends RowData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
};

const defaultPagination = {
  pageIndex: 0,
  pageSize: 10,
} as const;

export function DataTable<TData extends RowData>({ columns, data }: Props<TData>) {
  const [pagination, setPagination] = useState<PaginationState>(defaultPagination);

  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: setPagination,
    state: {
      pagination,
    },
  });

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
        <div className="flex justify-between gap-1 p-2">
          <select
            name="page_number h-8"
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
