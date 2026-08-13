import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type Row,
  type RowData,
  type RowSelectionState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { twJoin } from "tailwind-merge";
import { Checkbox } from "./Checkbox";

type Props<TData extends RowData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  enableRowSelection?: boolean;
  onSelectionChange?: (selectedRows: TData[]) => void;
  /** Clicking a row (outside the selection checkbox) invokes this instead of selecting it. */
  onRowClick?: (data: TData) => void;
  /** Groups consecutive rows sharing a key; a bold divider is drawn where the key changes. */
  groupBy?: (data: TData) => string | number | undefined;
  /**
   * Renders a full-width header row *before* each `groupBy` group, given that group's key.
   * Ahead of the group rather than after it: a total you read before you know which group ended
   * is a total you have to hold in your head until the next divider explains it.
   */
  renderGroupHeader?: (groupKey: string | number) => ReactNode;
};

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

const ROW_HEIGHT_ESTIMATE = 38;
const HEADER_ROW_HEIGHT_ESTIMATE = 30;

type BodyItem<TData> =
  | { kind: "row"; row: Row<TData>; isGroupStart: boolean }
  | { kind: "header"; groupKey: string | number };

// Firefox reports table-row heights incorrectly via getBoundingClientRect.
const measureElement =
  typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox")
    ? undefined
    : (element: Element) => element.getBoundingClientRect().height;

export function DataTable<TData extends RowData>({
  columns,
  data,
  enableRowSelection,
  onSelectionChange,
  onRowClick,
  groupBy,
  renderGroupHeader,
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
    onRowSelectionChange: setRowSelection,
    state: {
      rowSelection,
    },
  });

  useEffect(() => {
    setRowSelection({});
  }, [data]);

  useEffect(() => {
    onSelectionChange?.(table.getSelectedRowModel().rows.map((row) => row.original));
  }, [rowSelection, table, onSelectionChange]);

  const bodyRows = table.getRowModel().rows;
  const visibleColumns = table.getVisibleLeafColumns();

  const items = useMemo<BodyItem<TData>[]>(() => {
    if (!groupBy) return bodyRows.map((row) => ({ kind: "row", row, isGroupStart: false }));

    const list: BodyItem<TData>[] = [];
    bodyRows.forEach((row, index) => {
      const previousGroupKey = index > 0 ? groupBy(bodyRows[index - 1].original) : undefined;
      const groupKey = groupBy(row.original);
      const isGroupStart = index === 0 || groupKey !== previousGroupKey;

      if (isGroupStart && renderGroupHeader && groupKey !== undefined) {
        list.push({ kind: "header", groupKey });
      }
      // The header row is the divider once there is one, so the thick group-start border would
      // only draw a second line under it.
      list.push({ kind: "row", row, isGroupStart: isGroupStart && !renderGroupHeader });
    });

    return list;
  }, [bodyRows, groupBy, renderGroupHeader]);

  const containerRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) =>
      items[index].kind === "header" ? HEADER_ROW_HEIGHT_ESTIMATE : ROW_HEIGHT_ESTIMATE,
    measureElement,
    overscan: 10,
  });

  const columnVirtualizer = useVirtualizer({
    count: visibleColumns.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => visibleColumns[index]?.getSize() ?? 0,
    horizontal: true,
    overscan: 3,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualColumns = columnVirtualizer.getVirtualItems();

  let paddingLeft = 0;
  let paddingRight = 0;
  if (virtualColumns.length) {
    paddingLeft = virtualColumns[0]?.start ?? 0;
    paddingRight =
      columnVirtualizer.getTotalSize() - (virtualColumns[virtualColumns.length - 1]?.end ?? 0);
  }

  return (
    <div
      ref={containerRef}
      className={twJoin(
        "border-border bg-surface relative isolate overflow-auto rounded-xl border",
        data.length > 0 && "h-[600px]",
      )}
    >
      <table
        className="grid min-w-full tabular-nums"
        style={{ width: columnVirtualizer.getTotalSize() }}
      >
        <thead className="bg-surface border-border z-stack sticky top-0 grid border-b">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="flex w-full">
              {paddingLeft > 0 && (
                <th aria-hidden className="shrink-0" style={{ width: paddingLeft }} />
              )}
              {virtualColumns.map((virtualColumn) => {
                const header = headerGroup.headers[virtualColumn.index];
                return (
                  <th
                    key={header.id}
                    style={{ width: header.getSize() }}
                    className="text-text-muted min-w-0 shrink-0 truncate px-3 py-1 text-left font-semibold"
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                );
              })}
              {paddingRight > 0 && (
                <th aria-hidden className="shrink-0" style={{ width: paddingRight }} />
              )}
            </tr>
          ))}
        </thead>
        <tbody className="relative grid" style={{ height: rowVirtualizer.getTotalSize() }}>
          {virtualRows.map((virtualRow) => {
            const item = items[virtualRow.index];

            if (item.kind === "header") {
              return (
                <tr
                  key={`header-${item.groupKey}`}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  className={twJoin(
                    "bg-surface-muted absolute flex w-full",
                    virtualRow.index > 0 && "border-t-text-muted/40 border-t-2",
                  )}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <td className="px-3 py-1" style={{ width: columnVirtualizer.getTotalSize() }}>
                    {renderGroupHeader?.(item.groupKey)}
                  </td>
                </tr>
              );
            }

            const row = item.row;
            const visibleCells = row.getVisibleCells();

            return (
              <tr
                key={row.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                className={twJoin(
                  "absolute flex w-full",
                  onRowClick && "hover:bg-surface-muted cursor-pointer",
                  virtualRow.index > 0 &&
                    (item.isGroupStart
                      ? "border-t-text-muted/40 border-t-2"
                      : "border-border border-t"),
                )}
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {paddingLeft > 0 && (
                  <td aria-hidden className="shrink-0" style={{ width: paddingLeft }} />
                )}
                {virtualColumns.map((virtualColumn) => {
                  const cell = visibleCells[virtualColumn.index];
                  return (
                    <td
                      key={cell.id}
                      style={{ width: cell.column.getSize() }}
                      className="min-w-0 shrink-0 truncate px-3 py-2 sm:py-1"
                      onClick={cell.column.id === "select" ? (e) => e.stopPropagation() : undefined}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
                {paddingRight > 0 && (
                  <td aria-hidden className="shrink-0" style={{ width: paddingRight }} />
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!data.length && (
        <div className="grid place-items-center p-6">
          <p>No data</p>
        </div>
      )}
    </div>
  );
}
